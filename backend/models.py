"""
models.py — Pydantic request/response models for CrawlX API.
"""
from typing import List, Optional
from pydantic import BaseModel, Field, model_validator


# ─────────────────────────── Request Models ──────────────────────────────────

class CrawlRequest(BaseModel):
    url: Optional[str] = Field(None, description="Seed URL to start crawling from")
    seed_url: Optional[str] = Field(None, description="Alternative field for seed URL")
    max_pages: int = Field(default=50, ge=1, le=500, description="Maximum pages to crawl")

    @model_validator(mode="before")
    @classmethod
    def resolve_url(cls, data):
        if isinstance(data, dict):
            u = data.get("url") or data.get("seed_url")
            if not u:
                raise ValueError("Field 'url' or 'seed_url' is required.")
            data["url"] = u
        return data


# ─────────────────────────── Response Models ─────────────────────────────────

class CrawlResponse(BaseModel):
    job_id: str = Field(..., description="Unique identifier for this crawl job")
    status: str = Field(default="started", description="Job status: started | running | done | failed")
    seed_url: str
    max_pages: int
    message: str = "Crawl job accepted and running in background."


class SearchResult(BaseModel):
    title: str
    url: str
    snippet: str
    score: float              # raw TF-IDF score
    pagerank_score: float = 0.0
    final_score: float = 0.0  # 0.7 * tfidf + 0.3 * pagerank


class SearchResponse(BaseModel):
    query: str
    total_results: int
    results: List[SearchResult]


class StatsResponse(BaseModel):
    total_pages: int = Field(..., description="Number of crawled pages stored in MongoDB")
    total_words: int = Field(..., description="Total unique tokens across all indexed documents")
    index_size: int = Field(..., description="Number of entries in the inverted index")


class JobStatusResponse(BaseModel):
    job_id: str
    status: str                        # started | running | done | failed
    seed_url: str
    max_pages: int
    pages_crawled: Optional[int] = None
    pages_indexed: Optional[int] = None
    error: Optional[str] = None
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    logs: Optional[List[dict]] = None


class ErrorResponse(BaseModel):
    detail: str
