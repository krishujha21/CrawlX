"""
indexer.py — Inverted index builder + TF-IDF computation for CrawlX.

All math implemented from scratch (no sklearn / search libraries).

── Terminology ──────────────────────────────────────────────────────────────
  TF  (term frequency)  : count(term, doc) / total_terms_in_doc
  IDF (inv. doc. freq.) : log( (N + 1) / (df + 1) ) + 1   [smoothed]
  TF-IDF                : TF × IDF

── MongoDB Collections ──────────────────────────────────────────────────────
  pages  : one doc per crawled page  { url, title, body, fetched_at, ... }
  index  : one doc per token         { token, postings: [{url, tf}], idf }
  meta   : singleton stats document  { _id: "stats", total_docs, total_tokens }
"""
from __future__ import annotations

import logging
import math
import re
from collections import Counter
from typing import Dict, List, Tuple

from pymongo.database import Database

logger = logging.getLogger(__name__)


# ── Stopwords ──────────────────────────────────────────────────────────────────

STOPWORDS: frozenset[str] = frozenset({
    "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
    "being", "have", "has", "had", "do", "does", "did", "will", "would",
    "shall", "should", "may", "might", "must", "can", "could", "not", "no",
    "nor", "so", "yet", "both", "either", "neither", "each", "few", "more",
    "most", "other", "some", "such", "than", "too", "very", "just", "about",
    "above", "after", "before", "between", "into", "through", "during",
    "that", "this", "these", "those", "it", "its", "if", "as", "up", "out",
    "i", "me", "my", "we", "our", "you", "your", "he", "him", "his", "she",
    "her", "they", "them", "their", "what", "which", "who", "whom", "when",
    "where", "why", "how", "all", "any", "only", "own", "same", "then",
    "here", "there", "also", "even", "back", "s", "t", "re", "ll", "ve",
})

_TOKEN_RE = re.compile(r"[a-z0-9]+(?:'[a-z]+)?")


# ── Tokenization ───────────────────────────────────────────────────────────────

def tokenize(text: str) -> List[str]:
    """Lowercase, extract alphanumeric tokens, remove stopwords."""
    return [
        tok for tok in _TOKEN_RE.findall(text.lower())
        if tok not in STOPWORDS and len(tok) > 1
    ]


# ── TF / IDF math ─────────────────────────────────────────────────────────────

def compute_tf(tokens: List[str]) -> Dict[str, float]:
    """
    Term frequency = count(term) / total_tokens_in_document.
    Returns {term: tf_score}.
    """
    if not tokens:
        return {}
    total = len(tokens)
    counts = Counter(tokens)
    return {term: count / total for term, count in counts.items()}


def compute_idf(doc_freq: Dict[str, int], total_docs: int) -> Dict[str, float]:
    """
    Smoothed IDF = log( (N + 1) / (df + 1) ) + 1
    where N = total documents, df = docs containing the term.
    """
    idf: Dict[str, float] = {}
    for term, df in doc_freq.items():
        idf[term] = math.log((total_docs + 1) / (df + 1)) + 1.0
    return idf


# ── Core indexing pipeline ─────────────────────────────────────────────────────

def build_and_store_index(pages: List[Dict], db: Database) -> Tuple[int, int]:
    """
    Given a list of page dicts (from crawler), build an inverted index
    and persist pages + index to MongoDB.

    Returns (pages_indexed, unique_tokens).

    Steps:
      1. Upsert each page into `pages` collection.
      2. Tokenize each page body and compute per-document TF.
      3. Accumulate document frequency (df) for IDF computation.
      4. Compute IDF across full corpus.
      5. Upsert each token entry into `index` collection.
      6. Update `meta` stats singleton.
    """
    if not pages:
        logger.warning("build_and_store_index called with empty pages list.")
        return 0, 0

    pages_col = db["pages"]
    index_col = db["index"]
    meta_col  = db["meta"]

    # ── Step 1 & 2: Store pages, compute TF per doc ───────────────────────────
    # Keyed by url for fast lookup during index building
    doc_tf: Dict[str, Dict[str, float]] = {}   # {url: {term: tf}}
    doc_freq: Dict[str, int] = {}              # {term: number_of_docs_containing_term}

    for page in pages:
        url   = page["url"]
        title = page.get("title", "")
        body  = page.get("body", "")

        # Combine title (weighted 3×) + body for richer signal
        combined_text = (title + " ") * 3 + body
        tokens = tokenize(combined_text)

        tf = compute_tf(tokens)
        doc_tf[url] = tf

        # Document frequency: count how many docs contain each term
        for term in tf:
            doc_freq[term] = doc_freq.get(term, 0) + 1

        # Upsert page into MongoDB (keyed on url)
        pages_col.update_one(
            {"url": url},
            {"$set": {
                "url":        url,
                "title":      title,
                "body":       body,
                "fetched_at": page.get("fetched_at"),
                "status_code": page.get("status_code"),
                "token_count": len(tokens),
            }},
            upsert=True,
        )

    total_docs = pages_col.count_documents({})

    # ── Step 3: Compute IDF ───────────────────────────────────────────────────
    idf_map = compute_idf(doc_freq, total_docs)

    # ── Step 4: Build inverted index & upsert ────────────────────────────────
    # Structure: { token → postings: [{url, tf}], idf }
    # Group postings by token across all docs
    inverted: Dict[str, List[Dict]] = {}

    for url, tf_scores in doc_tf.items():
        for term, tf_val in tf_scores.items():
            if term not in inverted:
                inverted[term] = []
            inverted[term].append({"url": url, "tf": round(tf_val, 8)})

    # Persist each token entry
    for term, postings in inverted.items():
        idf_val = idf_map.get(term, 1.0)
        index_col.update_one(
            {"token": term},
            {"$set": {
                "token":    term,
                "postings": postings,
                "idf":      round(idf_val, 8),
                "df":       doc_freq.get(term, 0),
            }},
            upsert=True,
        )

    unique_tokens = len(inverted)

    # ── Step 5: Update meta stats ─────────────────────────────────────────────
    total_words_in_index = index_col.count_documents({})
    meta_col.update_one(
        {"_id": "stats"},
        {"$set": {
            "total_docs":   total_docs,
            "total_tokens": total_words_in_index,
            "index_size":   total_words_in_index,
        }},
        upsert=True,
    )

    logger.info(
        "Indexing complete — pages: %d, unique tokens this batch: %d, "
        "total index size: %d",
        len(pages), unique_tokens, total_words_in_index,
    )
    return len(pages), unique_tokens
