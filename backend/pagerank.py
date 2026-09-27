"""
pagerank.py — From-scratch iterative PageRank for CrawlX.

Algorithm:
  - Standard iterative PageRank (Brin & Page, 1998).
  - Damping factor d = 0.85; convergence or 50 iterations.
  - Dangling nodes (pages with no outgoing links) distribute their rank
    uniformly across all nodes (dangling-node correction).
  - Scores are normalised so they sum to 1.0 before storage.

MongoDB:
  - Collection "pagerank": { url: str, score: float }
  - Upserted after every crawl; old scores overwritten.
"""
from __future__ import annotations

import logging
import math
from typing import Dict, List

from pymongo import UpdateOne
from pymongo.database import Database

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

DAMPING     = 0.85
MAX_ITER    = 50
CONVERGENCE = 1e-6   # stop early if max score delta < this


# ── Core algorithm ────────────────────────────────────────────────────────────

def compute_pagerank(
    graph: Dict[str, List[str]],
    damping: float = DAMPING,
    max_iter: int = MAX_ITER,
    convergence: float = CONVERGENCE,
) -> Dict[str, float]:
    """
    Compute PageRank from scratch.

    Parameters
    ----------
    graph : { url → [outgoing_urls] }
        Only URLs that are keys are treated as nodes.
        Outgoing links pointing outside the node set are silently dropped.

    Returns
    -------
    { url → pagerank_score }   (scores sum to 1.0)
    """
    nodes = list(graph.keys())
    n = len(nodes)
    if n == 0:
        return {}
    if n == 1:
        return {nodes[0]: 1.0}

    node_set = set(nodes)

    # Build filtered adjacency: only keep intra-graph links
    out_links: Dict[str, List[str]] = {
        url: [v for v in targets if v in node_set]
        for url, targets in graph.items()
    }

    # In-link index: who links TO this url?
    in_links: Dict[str, List[str]] = {url: [] for url in nodes}
    for src, targets in out_links.items():
        for dst in set(targets):          # deduplicate
            in_links[dst].append(src)

    # Initial uniform distribution
    rank: Dict[str, float] = {url: 1.0 / n for url in nodes}

    base = (1.0 - damping) / n

    for iteration in range(max_iter):
        new_rank: Dict[str, float] = {}

        # Dangling-node mass: pages with no outgoing links spread rank uniformly
        dangling_sum = sum(rank[url] for url in nodes if not out_links[url])
        dangling_share = damping * dangling_sum / n

        for url in nodes:
            # Sum of (rank[src] / out_degree[src]) for every src that links here
            inbound = sum(
                rank[src] / len(out_links[src])
                for src in in_links[url]
                if out_links[src]      # skip dangling sources (handled above)
            )
            new_rank[url] = base + dangling_share + damping * inbound

        # Check convergence: max absolute change across all nodes
        delta = max(abs(new_rank[url] - rank[url]) for url in nodes)
        rank = new_rank

        logger.debug("PageRank iter %d — max delta: %.2e", iteration + 1, delta)
        if delta < convergence:
            logger.info("PageRank converged after %d iterations.", iteration + 1)
            break
    else:
        logger.info("PageRank reached max iterations (%d).", max_iter)

    # Normalise so scores sum to 1.0
    total = sum(rank.values())
    if total > 0:
        rank = {url: s / total for url, s in rank.items()}

    return rank


# ── MongoDB integration ───────────────────────────────────────────────────────

def build_link_graph(pages: List[Dict]) -> Dict[str, List[str]]:
    """
    Build the link graph from crawled page dicts.
    Only URLs that were actually crawled become nodes.
    """
    crawled_urls = {p["url"] for p in pages}
    graph: Dict[str, List[str]] = {}
    for page in pages:
        url = page["url"]
        # Keep only links that are within the crawled set
        graph[url] = [link for link in page.get("links", []) if link in crawled_urls]
    return graph


def run_and_store_pagerank(pages: List[Dict], db: Database) -> Dict[str, float]:
    """
    Build the link graph from *pages*, run PageRank, upsert scores to MongoDB.

    Returns the score dict { url → score }.
    """
    if not pages:
        logger.warning("run_and_store_pagerank called with empty pages list.")
        return {}

    graph = build_link_graph(pages)
    logger.info("Running PageRank on %d nodes…", len(graph))

    scores = compute_pagerank(graph)

    pr_col = db["pagerank"]
    pr_ops = [
        UpdateOne(
            {"url": url},
            {"$set": {"url": url, "score": round(score, 10)}},
            upsert=True,
        )
        for url, score in scores.items()
    ]
    if pr_ops:
        pr_col.bulk_write(pr_ops, ordered=False)

    logger.info("PageRank stored for %d pages.", len(scores))
    return scores
