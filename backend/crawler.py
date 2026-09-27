"""
crawler.py — BFS web crawler for CrawlX.

Strategy:
  - Start from a seed URL.
  - Use a queue (collections.deque) and a visited set for BFS.
  - Stay strictly within the same domain as the seed URL (netloc match).
  - Skip mailto:, javascript:, tel:, data: schemes and non-HTML responses.
  - Extract: page title, full body text (stripped), all valid href links.
  - Respect max_pages limit (default 50, configurable).
  - Returns a list of dicts ready to be stored / indexed.
"""
from __future__ import annotations

import logging
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Callable, Dict, List, Optional, Set
from urllib.parse import urljoin, urlparse, urldefrag

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────────

SKIP_SCHEMES = {"mailto", "javascript", "tel", "data", "ftp", "file"}
HTML_CONTENT_TYPES = {"text/html", "application/xhtml+xml"}
REQUEST_TIMEOUT = 10          # seconds per request
CRAWL_DELAY = 0.3             # polite delay between requests (seconds)
MAX_BODY_CHARS = 50_000       # truncate body text stored per page

HEADERS = {
    "User-Agent": (
        "CrawlX/1.0 (+https://github.com/crawlx; educational web crawler)"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}


# ── Helpers ────────────────────────────────────────────────────────────────────

def _normalize_url(url: str) -> str:
    """Remove URL fragment and trailing slash for consistent deduplication."""
    url, _ = urldefrag(url)
    return url.rstrip("/")


def _same_domain(url: str, seed_netloc: str) -> bool:
    """Return True when *url* belongs to the same effective domain."""
    try:
        parsed = urlparse(url)
        netloc = parsed.netloc.lstrip("www.")
        seed = seed_netloc.lstrip("www.")
        return netloc == seed or netloc.endswith("." + seed)
    except Exception:
        return False


def _is_valid_url(url: str) -> bool:
    """Quick sanity check — must have scheme + netloc."""
    try:
        parsed = urlparse(url)
        return parsed.scheme in {"http", "https"} and bool(parsed.netloc)
    except Exception:
        return False


def _extract_links(soup: BeautifulSoup, base_url: str) -> List[str]:
    """Extract and resolve all href links from the parsed HTML."""
    links: List[str] = []
    for tag in soup.find_all("a", href=True):
        href: str = tag["href"].strip()

        # Skip empty or scheme-only fragments
        if not href or href.startswith("#"):
            continue

        # Skip unwanted schemes before joining
        scheme = href.split(":")[0].lower()
        if scheme in SKIP_SCHEMES:
            continue

        absolute = _normalize_url(urljoin(base_url, href))
        if _is_valid_url(absolute):
            links.append(absolute)

    return links


def _fetch_page(url: str, session: requests.Session) -> Optional[Dict]:
    """
    Fetch a single URL and return a dict with raw data, or None on failure.

    Returned dict:
        {
            "url": str,
            "title": str,
            "body": str,          # stripped plain text
            "links": List[str],   # absolute URLs found on the page
            "status_code": int,
            "fetched_at": float,  # Unix timestamp
        }
    """
    try:
        response = session.get(url, timeout=REQUEST_TIMEOUT, headers=HEADERS, allow_redirects=True)

        # Only index HTML content
        content_type = response.headers.get("Content-Type", "").split(";")[0].strip().lower()
        if content_type not in HTML_CONTENT_TYPES:
            logger.debug("Skipping non-HTML URL: %s (content-type: %s)", url, content_type)
            return None

        if response.status_code not in range(200, 300):
            logger.debug("Non-2xx response %s for %s", response.status_code, url)
            return None

        soup = BeautifulSoup(response.text, "html.parser")

        # ── Title ─────────────────────────────────────────────────────────────
        title_tag = soup.find("title")
        title = title_tag.get_text(strip=True) if title_tag else url

        # ── Body text (remove scripts / styles) ───────────────────────────────
        for tag in soup(["script", "style", "noscript", "head", "nav", "footer"]):
            tag.decompose()

        body_text = soup.get_text(separator=" ", strip=True)
        # Collapse whitespace
        body_text = " ".join(body_text.split())
        body_text = body_text[:MAX_BODY_CHARS]

        # ── Links ──────────────────────────────────────────────────────────────
        links = _extract_links(soup, url)

        return {
            "url": url,
            "title": title,
            "body": body_text,
            "links": links,
            "status_code": response.status_code,
            "fetched_at": time.time(),
        }

    except requests.exceptions.TooManyRedirects:
        logger.warning("Too many redirects for %s", url)
    except requests.exceptions.Timeout:
        logger.warning("Timeout fetching %s", url)
    except requests.exceptions.ConnectionError as exc:
        logger.warning("Connection error for %s: %s", url, exc)
    except Exception as exc:
        logger.exception("Unexpected error fetching %s: %s", url, exc)

    return None


# ── Public API ─────────────────────────────────────────────────────────────────

def crawl(
    seed_url: str,
    max_pages: int = 50,
    broadcast_fn: Optional[Callable[[dict], None]] = None,
    cancel_check: Optional[Callable[[], bool]] = None,
) -> List[Dict]:
    """
    BFS-crawl starting from *seed_url*, limited to *max_pages* HTML pages
    within the same domain.
    """
    seed_url = _normalize_url(seed_url)
    if not _is_valid_url(seed_url):
        raise ValueError(f"Invalid seed URL: {seed_url!r}")

    seed_netloc = urlparse(seed_url).netloc

    queue: deque[str] = deque([seed_url])
    visited: Set[str] = {seed_url}
    pages: List[Dict] = []

    session = requests.Session()
    session.max_redirects = 5

    logger.info("Starting concurrent BFS crawl from %s (max_pages=%d)", seed_url, max_pages)

    # Use a small thread pool for high-throughput concurrent fetching
    max_workers = 5

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        while queue and len(pages) < max_pages:
            if cancel_check and cancel_check():
                logger.info("Crawl aborted by user request.")
                break

            # Pop a batch of URLs to fetch concurrently
            batch_size = min(max_workers, max_pages - len(pages), len(queue))
            current_batch = [queue.popleft() for _ in range(batch_size)]

            # Submit concurrent fetch requests
            future_to_url = {
                executor.submit(_fetch_page, url, session): url
                for url in current_batch
            }

            for future in as_completed(future_to_url):
                if cancel_check and cancel_check():
                    logger.info("Crawl aborted during batch.")
                    break

                if len(pages) >= max_pages:
                    break

                url = future_to_url[future]
                try:
                    page = future.result()
                except Exception as exc:
                    logger.debug("Fetch failed for %s: %s", url, exc)
                    page = None

                if page is None:
                    continue

                pages.append(page)

                # ── Broadcast real-time event ─────────────────────────────────
                if broadcast_fn is not None:
                    try:
                        broadcast_fn({
                            "event":      "crawled",
                            "url":        page["url"],
                            "title":      page.get("title", ""),
                            "page_count": len(pages),
                            "total":      max_pages,
                        })
                    except Exception as exc:
                        logger.debug("broadcast_fn error (ignored): %s", exc)

                # Enqueue discovered links that are in the same domain and not yet seen
                for link in page.get("links", []):
                    if link not in visited and _same_domain(link, seed_netloc):
                        visited.add(link)
                        queue.append(link)

            # Polite delay between batches
            if queue and len(pages) < max_pages:
                if cancel_check and cancel_check():
                    break
                time.sleep(CRAWL_DELAY)

    logger.info("Concurrent crawl finished. Pages collected: %d", len(pages))
    session.close()
    return pages
