"""
main.py — FastAPI application entry point for CrawlX.

Endpoints:
  POST /crawl          — Accepts seed URL + max_pages, runs BFS crawl in background.
  GET  /search?q=      — Returns top 10 TF-IDF + PageRank ranked results.
  GET  /stats          — Returns corpus statistics from MongoDB.
  GET  /job/{job_id}   — Returns status of a background crawl job.
  GET  /health         — Simple liveness probe.
  WS   /ws/crawl-log  — Real-time crawl event stream.
"""
from __future__ import annotations

import logging
import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict

from fastapi import BackgroundTasks, FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from pymongo import MongoClient
from pymongo.errors import ConnectionFailure

from crawler import crawl
from indexer import build_and_store_index
from pagerank import run_and_store_pagerank
from models import (
    CrawlRequest,
    CrawlResponse,
    JobStatusResponse,
    SearchResponse,
    SearchResult,
    StatsResponse,
)
from search import search as run_search

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger(__name__)

# ── Configuration ─────────────────────────────────────────────────────────────

MONGO_URI       = os.getenv("MONGO_URI", "mongodb://localhost:27017")
DB_NAME         = os.getenv("MONGO_DB", "crawlx")
ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "*").split(",") if o.strip()]
ENVIRONMENT     = os.getenv("ENVIRONMENT", "development")

_client: MongoClient | None = None


def get_db():
    """Return the MongoDB database handle; lazily creates the client."""
    global _client
    if _client is None:
        _client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
        logger.info("MongoDB client created → %s / %s", MONGO_URI, DB_NAME)
    return _client[DB_NAME]


# ── In-memory job registry ────────────────────────────────────────────────────
# For a production system swap this with a Redis/DB-backed store.
# Key: job_id (str) → job status dict

_jobs: Dict[str, dict] = {}
_job_cancel_flags: Dict[str, bool] = {}


def _save_job_to_db(job: dict) -> None:
    """Persist job state to MongoDB for durability across restarts/scaling."""
    try:
        db = get_db()
        db["jobs"].update_one(
            {"job_id": job["job_id"]},
            {"$set": job},
            upsert=True,
        )
    except Exception as exc:
        logger.debug("Failed to persist job %s: %s", job.get("job_id"), exc)


def _get_job(job_id: str) -> dict | None:
    """Lookup job from memory first, then fallback to MongoDB."""
    if job_id in _jobs:
        return _jobs[job_id]
    try:
        db = get_db()
        doc = db["jobs"].find_one({"job_id": job_id}, {"_id": 0})
        if doc:
            _jobs[job_id] = doc
            return doc
    except Exception as exc:
        logger.debug("Failed to query job %s from db: %s", job_id, exc)
    return None


# ── WebSocket Connection Manager ──────────────────────────────────────────────

class ConnectionManager:
    """Manages a pool of active WebSocket connections for live crawl events."""

    def __init__(self) -> None:
        self._connections: list[WebSocket] = []

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._connections.append(ws)
        logger.info("WS client connected — total: %d", len(self._connections))

    def disconnect(self, ws: WebSocket) -> None:
        self._connections = [c for c in self._connections if c is not ws]
        logger.info("WS client disconnected — total: %d", len(self._connections))

    async def broadcast(self, data: dict) -> None:
        """Send *data* as JSON to every connected client; drop broken sockets."""
        dead: list[WebSocket] = []
        for ws in list(self._connections):
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


manager = ConnectionManager()


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle."""
    # ── Startup ───────────────────────────────────────────────────────────────
    try:
        db = get_db()
        db.command("ping")
        logger.info("✅ MongoDB connection OK.")
        db["pages"].create_index("url", unique=True, background=True)
        db["index"].create_index("token", unique=True, background=True)
        db["pagerank"].create_index("url", unique=True, background=True)
        db["jobs"].create_index("job_id", unique=True, background=True)
        logger.info("✅ MongoDB collection indexes ensured.")
    except ConnectionFailure as exc:
        logger.error("❌ MongoDB connection failed at startup: %s", exc)

    yield  # ── App is running ─────────────────────────────────────────────────

    # ── Shutdown ──────────────────────────────────────────────────────────────
    global _client
    if _client:
        _client.close()
        logger.info("MongoDB client closed.")


# ── FastAPI App ───────────────────────────────────────────────────────────────

is_prod = ENVIRONMENT == "production"

app = FastAPI(
    title="CrawlX API",
    description=(
        "A from-scratch web scraper and mini search engine. "
        "Crawls pages with BFS, builds an inverted TF-IDF index, "
        "and serves ranked search results."
    ),
    version="1.0.0",
    docs_url=None if is_prod else "/docs",
    redoc_url=None if is_prod else "/redoc",
    lifespan=lifespan,
)

# ── Middleware ────────────────────────────────────────────────────────────────
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Background task ───────────────────────────────────────────────────────────

def _run_crawl_job(job_id: str, seed_url: str, max_pages: int) -> None:
    """
    Background task: crawl → index → PageRank → update job status.
    Streams live events to connected WebSocket clients via asyncio.
    All errors are caught and stored in the job registry.
    """
    import asyncio

    job = _jobs[job_id]
    job["status"] = "running"
    job["started_at"] = datetime.now(timezone.utc).isoformat()
    _save_job_to_db(job)
    logger.info("[job:%s] Crawl started — %s (max=%d)", job_id, seed_url, max_pages)

    # Broadcast helper: schedules a coroutine from the sync background thread.
    # manager.broadcast is async, so we use run_coroutine_threadsafe with the
    # running event loop.
    def _broadcast(event: dict) -> None:
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.run_coroutine_threadsafe(manager.broadcast(event), loop)
        except Exception as exc:
            logger.debug("WS broadcast skipped: %s", exc)

    try:
        # ── Emit: started ─────────────────────────────────────────────────────
        _broadcast({"event": "started", "seed_url": seed_url, "max_pages": max_pages})

        # ── 1. Crawl ──────────────────────────────────────────────────────────
        pages = crawl(
            seed_url,
            max_pages=max_pages,
            broadcast_fn=_broadcast,
            cancel_check=lambda: _job_cancel_flags.get(job_id, False),
        )
        job["pages_crawled"] = len(pages)
        _save_job_to_db(job)
        logger.info("[job:%s] Crawled %d pages.", job_id, len(pages))

        if _job_cancel_flags.get(job_id, False):
            job["status"] = "stopped"
            _save_job_to_db(job)
            logger.info("[job:%s] Job stopped by user.", job_id)
            _broadcast({
                "event":       "stopped",
                "total_pages": len(pages),
            })
            return

        # ── 2. Index ──────────────────────────────────────────────────────────
        db = get_db()
        pages_indexed, total_tokens = build_and_store_index(pages, db)
        job["pages_indexed"] = pages_indexed
        _save_job_to_db(job)
        logger.info("[job:%s] Indexed %d pages.", job_id, pages_indexed)

        # ── 3. PageRank ───────────────────────────────────────────────────────
        run_and_store_pagerank(pages, db)
        logger.info("[job:%s] PageRank computed and stored.", job_id)

        job["status"] = "done"
        _save_job_to_db(job)

        # ── Emit: done ────────────────────────────────────────────────────────
        _broadcast({
            "event":       "done",
            "total_pages": pages_indexed,
            "total_words": total_tokens,
        })

    except Exception as exc:
        logger.exception("[job:%s] Crawl job failed: %s", job_id, exc)
        job["status"] = "failed"
        job["error"] = str(exc)
        _save_job_to_db(job)
        _broadcast({"event": "error", "message": str(exc)})

    finally:
        job["finished_at"] = datetime.now(timezone.utc).isoformat()
        _save_job_to_db(job)


# ── Serve frontend static build (production only) ────────────────────────────

STATIC_DIR = Path(__file__).resolve().parent / "static"
if STATIC_DIR.is_dir():
    from fastapi.responses import FileResponse

    @app.get("/", include_in_schema=False)
    async def serve_root():
        return FileResponse(STATIC_DIR / "index.html")

    # Mount static assets AFTER API routes so /api/* wins
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")


# ─────────────────────────────── Routes ──────────────────────────────────────

@app.get("/health", tags=["System"])
async def health_check():
    """Liveness probe — always returns 200 if the server is running."""
    return {"status": "ok", "service": "CrawlX API"}


# ── WS /ws/crawl-log ─────────────────────────────────────────────────────────

@app.websocket("/ws/crawl-log")
async def crawl_log_ws(websocket: WebSocket):
    """
    Real-time crawl event stream.

    Emitted events (JSON):
      { event: "started",  seed_url, max_pages }
      { event: "crawled",  url, title, page_count, total }
      { event: "done",     total_pages, total_words }
      { event: "error",    message }
    """
    await manager.connect(websocket)
    try:
        # Keep the connection open; we just receive pings / close frames.
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)


# ── POST /crawl ───────────────────────────────────────────────────────────────

@app.post(
    "/crawl",
    response_model=CrawlResponse,
    status_code=202,
    tags=["Crawler"],
    summary="Start a BFS crawl job",
    description=(
        "Accepts a seed URL and an optional max_pages limit. "
        "The crawl runs in the background; the endpoint returns immediately "
        "with a job_id you can poll at GET /job/{job_id}."
    ),
)
async def start_crawl(request: CrawlRequest, background_tasks: BackgroundTasks):
    """Kick off a background crawl + indexing job."""
    job_id = str(uuid.uuid4())

    _jobs[job_id] = {
        "job_id":        job_id,
        "status":        "started",
        "seed_url":      request.url,
        "max_pages":     request.max_pages,
        "pages_crawled": None,
        "pages_indexed": None,
        "error":         None,
        "started_at":    None,
        "finished_at":   None,
    }
    _save_job_to_db(_jobs[job_id])

    background_tasks.add_task(_run_crawl_job, job_id, request.url, request.max_pages)

    return CrawlResponse(
        job_id=job_id,
        status="started",
        seed_url=request.url,
        max_pages=request.max_pages,
    )


# ── GET /job/{job_id} ─────────────────────────────────────────────────────────

@app.get(
    "/job/{job_id}",
    response_model=JobStatusResponse,
    tags=["Crawler"],
    summary="Poll crawl job status",
)
async def get_job_status(job_id: str):
    """Return the current status of a crawl job by its job_id."""
    job = _get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found.")
    return JobStatusResponse(**job)


# ── POST /job/{job_id}/stop ──────────────────────────────────────────────────

@app.post(
    "/job/{job_id}/stop",
    tags=["Crawler"],
    summary="Stop a running crawl job",
)
async def stop_crawl_job(job_id: str):
    """Signal a running crawl job to stop immediately."""
    job = _get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found.")
    _job_cancel_flags[job_id] = True
    job["status"] = "stopping"
    _save_job_to_db(job)
    logger.info("[job:%s] Stop requested by client.", job_id)
    return {"status": "stopping", "job_id": job_id}


# ── GET /search ───────────────────────────────────────────────────────────────

@app.get(
    "/search",
    response_model=SearchResponse,
    tags=["Search"],
    summary="Full-text TF-IDF search",
    description=(
        "Search the indexed corpus. Returns up to 10 results ranked by "
        "TF-IDF score. Each result includes title, URL, a contextual snippet, "
        "and the numeric relevance score."
    ),
)
async def search_endpoint(
    q: str = Query(..., min_length=1, description="Search query string"),
):
    """Perform a TF-IDF ranked search over indexed pages."""
    try:
        db = get_db()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Database unavailable: {exc}")

    raw_results = run_search(q, db, top_k=10)

    results = [
        SearchResult(
            title=r["title"],
            url=r["url"],
            snippet=r["snippet"],
            score=r["score"],
            pagerank_score=r.get("pagerank_score", 0.0),
            final_score=r.get("final_score", r["score"]),
        )
        for r in raw_results
    ]

    return SearchResponse(
        query=q,
        total_results=len(results),
        results=results,
    )


# ── GET /stats ────────────────────────────────────────────────────────────────

@app.get(
    "/stats",
    response_model=StatsResponse,
    tags=["System"],
    summary="Corpus statistics",
    description="Returns the total number of indexed pages, unique tokens, and index entries.",
)
async def stats_endpoint():
    """Return aggregate statistics about the indexed corpus."""
    try:
        db = get_db()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Database unavailable: {exc}")

    total_pages = db["pages"].count_documents({})
    index_size  = db["index"].count_documents({})

    # total_words: sum of token_count across all pages (stored during indexing)
    pipeline = [{"$group": {"_id": None, "total": {"$sum": "$token_count"}}}]
    agg = list(db["pages"].aggregate(pipeline))
    total_words = agg[0]["total"] if agg else 0

    return StatsResponse(
        total_pages=total_pages,
        total_words=total_words,
        index_size=index_size,
    )
