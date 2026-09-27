"""
search.py — Query processor and TF-IDF + PageRank ranker for CrawlX.

All scoring is implemented from scratch.

── Ranking algorithm ─────────────────────────────────────────────────────────
  For each query token:
    1. Look up its postings list + IDF from the `index` collection.
    2. For each document in the postings: accumulate score += TF × IDF.

  Blend with PageRank:
    final_score = 0.7 × tfidf_score + 0.3 × pagerank_score

  Sort by final_score descending. Return top 10.

── Snippet generation ────────────────────────────────────────────────────────
  Find the first occurrence of any query token in the body text.
  Return the surrounding ±100 chars (truncated at 200 chars total).
"""
from __future__ import annotations

import logging
from typing import Dict, List, Tuple

from pymongo.database import Database

from indexer import tokenize  # reuse same tokenizer / stopwords

logger = logging.getLogger(__name__)

SNIPPET_WINDOW = 200   # characters around the matched term

# Blend weights — must sum to 1.0
TFIDF_WEIGHT    = 0.7
PAGERANK_WEIGHT = 0.3


# ── Snippet helper ─────────────────────────────────────────────────────────────

def _make_snippet(body: str, query_tokens: List[str], window: int = SNIPPET_WINDOW) -> str:
    """
    Return a ~200-char excerpt from *body* centred on the first occurrence
    of any query token. Falls back to the first 200 chars of the body.
    """
    body_lower = body.lower()

    for token in query_tokens:
        pos = body_lower.find(token)
        if pos != -1:
            half  = window // 2
            start = max(0, pos - half)
            end   = min(len(body), pos + half)

            # Adjust window to always fill `window` chars if possible
            if end - start < window:
                if start == 0:
                    end = min(len(body), window)
                else:
                    start = max(0, end - window)

            snippet = body[start:end].strip()
            if start > 0:
                snippet = "…" + snippet
            if end < len(body):
                snippet = snippet + "…"
            return snippet

    # Fallback: first 200 chars
    return body[:window] + ("…" if len(body) > window else "")


# ── PageRank lookup helper ─────────────────────────────────────────────────────

def _fetch_pagerank_scores(urls: List[str], db: Database) -> Dict[str, float]:
    """
    Batch-fetch PageRank scores for *urls* from MongoDB.
    Returns {url: score}. Missing URLs get score 0.0.
    """
    pr_col = db["pagerank"]
    docs = pr_col.find({"url": {"$in": urls}}, {"_id": 0, "url": 1, "score": 1})
    return {doc["url"]: doc["score"] for doc in docs}


# ── Public search API ──────────────────────────────────────────────────────────

def search(query: str, db: Database, top_k: int = 10) -> List[Dict]:
    """
    Process *query*, score all matching documents using TF-IDF blended with
    PageRank, and return the top *top_k* results.

    Each result dict:
        {
            "title":          str,
            "url":            str,
            "snippet":        str,
            "score":          float,   # raw TF-IDF
            "pagerank_score": float,
            "final_score":    float,   # 0.7*tfidf + 0.3*pagerank
        }
    """
    if not query or not query.strip():
        return []

    # ── 1. Tokenize query ─────────────────────────────────────────────────────
    query_tokens = tokenize(query)
    if not query_tokens:
        logger.info("Query '%s' produced no tokens after stopword removal.", query)
        return []

    logger.info("Query tokens: %s", query_tokens)

    index_col = db["index"]
    pages_col = db["pages"]

    # ── 2. Accumulate TF-IDF scores per URL (batch query) ──────────────────
    tfidf_scores: Dict[str, float] = {}
    unique_tokens = list(set(query_tokens))

    # Fetch all matching token index documents in a SINGLE query
    token_docs = list(index_col.find({"token": {"$in": unique_tokens}}))
    for entry in token_docs:
        idf: float = entry.get("idf", 1.0)
        postings: List[Dict] = entry.get("postings", [])

        for posting in postings:
            url   = posting["url"]
            tf    = posting.get("tf", 0.0)
            tfidf_scores[url] = tfidf_scores.get(url, 0.0) + tf * idf

    if not tfidf_scores:
        logger.info("No documents matched query: %s", query)
        return []

    # ── 3. Fetch PageRank scores for candidate URLs ───────────────────────────
    candidate_urls = list(tfidf_scores.keys())
    pr_scores = _fetch_pagerank_scores(candidate_urls, db)

    # Normalise TF-IDF scores to [0, 1] range so blending is meaningful
    max_tfidf = max(tfidf_scores.values()) or 1.0

    # ── 4. Blend and build final score map ────────────────────────────────────
    final_scores: Dict[str, Tuple[float, float, float]] = {}
    # { url → (tfidf_norm, pr_score, final) }

    for url, raw_tfidf in tfidf_scores.items():
        tfidf_norm = raw_tfidf / max_tfidf
        pr         = pr_scores.get(url, 0.0)
        final      = TFIDF_WEIGHT * tfidf_norm + PAGERANK_WEIGHT * pr
        final_scores[url] = (raw_tfidf, pr, final)

    # ── 5. Sort by final_score descending, take top_k ─────────────────────────
    ranked = sorted(
        final_scores.items(),
        key=lambda item: item[1][2],   # sort by final score
        reverse=True,
    )[:top_k]

    # ── 6. Batch-fetch page metadata for top_k results ───────────────────────
    top_urls = [url for url, _ in ranked]
    pages_cursor = pages_col.find(
        {"url": {"$in": top_urls}},
        {"_id": 0, "title": 1, "body": 1, "url": 1},
    )
    pages_map = {p["url"]: p for p in pages_cursor}

    results: List[Dict] = []
    for url, (raw_tfidf, pr, final) in ranked:
        page = pages_map.get(url) or {"url": url, "title": url, "body": ""}
        snippet = _make_snippet(page.get("body", ""), query_tokens)

        results.append({
            "title":          page.get("title", url),
            "url":            url,
            "snippet":        snippet,
            "score":          round(raw_tfidf, 6),
            "pagerank_score": round(pr, 8),
            "final_score":    round(final, 6),
        })

    logger.info(
        "Search '%s' → %d results (TF-IDF weight=%.1f, PR weight=%.1f)",
        query, len(results), TFIDF_WEIGHT, PAGERANK_WEIGHT,
    )
    return results
