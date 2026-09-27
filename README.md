# CrawlX 🕷️⚡

A full-stack, distributed-ready web crawler and search engine built from scratch. Features an asynchronous BFS web crawler, custom TF-IDF inverted indexer (no `scikit-learn`), custom iterative PageRank implementation (no `networkx`), real-time WebSocket crawl stream, and a modern reactive UI.

[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg?style=flat&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg?style=flat&logo=react&logoColor=black)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF.svg?style=flat&logo=vite&logoColor=white)](https://vitejs.dev)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-v4-38B2AC.svg?style=flat&logo=tailwind-css&logoColor=white)](https://tailwindcss.com)
[![MongoDB](https://img.shields.io/badge/MongoDB-7.0-47A248.svg?style=flat&logo=mongodb&logoColor=white)](https://www.mongodb.com)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED.svg?style=flat&logo=docker&logoColor=white)](https://www.docker.com)

---

## 🌟 Key Highlights

- **BFS Web Crawler**: Robust breadth-first crawl queue with URL deduplication, depth tracking, canonical normalization, politeness delays, and domain filtering.
- **Pure Python TF-IDF Index**: Inverted index built from first principles (no `sklearn`), calculating Term Frequency (TF) and Inverse Document Frequency (IDF) over processed page corpora.
- **Scratch PageRank Engine**: Google PageRank algorithm computed via iterative power iteration ($d = 0.85$, 50 iterations), handling sink nodes and convergence metrics.
- **Blended Ranking Model**: Computes query relevance scores using:
  $$\text{Score} = 0.7 \times \text{TF-IDF} + 0.3 \times \text{PageRank}$$
- **Real-Time WebSocket Streaming**: `WS /ws/crawl-log` broadcasts live crawl telemetry (`started`, `crawled`, `done`) directly to connected clients.
- **Modern Terminal Dashboard**: Dark cyberpunk UI with live terminal logs, auto-scrolling status, query execution stats, and granular ranking breakdown badges (TF-IDF, PageRank, Blended Score).
- **Production Containerization**: Multi-stage Docker builds, Nginx reverse proxy with WebSocket upgrade support, and orchestrated via `docker-compose`.

---

## 🏗️ Architecture

```
                       ┌─────────────────────────────────────────┐
                       │          React + Vite Frontend          │
                       │   (Tailwind v4, Live Crawl Terminal)    │
                       └─────────────┬───────────────────────────┘
                                     │
                             HTTP / WebSocket
                                     │
                       ┌─────────────▼───────────────────────────┐
                       │           FastAPI Backend               │
                       │  • REST Endpoints (/crawl, /search)     │
                       │  • WebSocket Endpoint (/ws/crawl-log)   │
                       └───────┬──────────────┬───────────┬──────┘
                               │              │           │
                 ┌─────────────▼────┐   ┌─────▼─────┐   ┌─▼─────────────┐
                 │    BFS Crawler   │   │  TF-IDF   │   │   PageRank    │
                 │ (bs4, requests)  │   │  Indexer  │   │  (Iterative)  │
                 └─────────────┬────┘   └─────┬─────┘   └─┬─────────────┘
                               │              │           │
                               └──────────────┼───────────┘
                                              │
                                   ┌──────────▼──────────┐
                                   │    MongoDB Store    │
                                   │ (pages, index, rank)│
                                   └─────────────────────┘
```

---

## 🚀 Quickstart

### Option 1: Docker Compose (Recommended)

Run the entire stack with a single command:

```bash
docker-compose up --build
```

- **Frontend**: [http://localhost:3000](http://localhost:3000)
- **Backend API**: [http://localhost:8000](http://localhost:8000)
- **API Docs (Swagger)**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **MongoDB**: `localhost:27017`

### Option 2: Local Development

#### 1. Start MongoDB
Ensure MongoDB is running locally on port 27017 or use Docker:
```bash
docker run -d -p 27017:27017 --name crawlx-mongo mongo:7.0
```

#### 2. Backend Setup
```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
uvicorn main:app --reload --port 8000
```

#### 3. Frontend Setup
```bash
cd frontend
npm install
npm run dev
```
Visit [http://localhost:5173](http://localhost:5173) in your browser.

---

## 📡 API Reference

### Crawling
- **`POST /crawl`**
  - Starts an async crawl job in the background.
  - Body:
    ```json
    {
      "seed_url": "https://example.com",
      "max_pages": 15,
      "max_depth": 2
    }
    ```
- **`GET /job/{job_id}`**
  - Polls job progress, status, and page counts.

### WebSockets
- **`WS /ws/crawl-log`**
  - Subscribes to real-time events during crawls:
    ```json
    { "event": "started", "seed_url": "https://example.com", "max_pages": 15 }
    { "event": "crawled", "url": "...", "title": "...", "depth": 1, "page_count": 3, "total": 15 }
    { "event": "done", "total_pages": 15, "total_words": 8420 }
    ```

### Search & Analytics
- **`GET /search?q={query}&limit=10`**
  - Returns ranked documents with TF-IDF, PageRank, and final scores.
- **`GET /stats`**
  - Returns total indexed pages, unique terms, and database stats.

---

## 🧮 Algorithms

### Inverted Index & TF-IDF
Term Frequency-Inverse Document Frequency is calculated without third-party ML packages:
$$\text{TF}(t, d) = \frac{\text{count}(t \text{ in } d)}{\text{total words in } d}$$
$$\text{IDF}(t, D) = \log\left(\frac{|D|}{1 + |\{d \in D : t \in d\}|}\right)$$
$$\text{TF-IDF}(t, d, D) = \text{TF}(t, d) \times \text{IDF}(t, D)$$

### Iterative PageRank
Calculated over the directed graph $G = (V, E)$ extracted from crawled hyperlinks:
$$\text{PR}(u) = \frac{1 - d}{|V|} + d \sum_{v \in \text{In}(u)} \frac{\text{PR}(v)}{\text{Out}(v)}$$
Damping factor $d = 0.85$, with uniform probability distribution redistribution for dead ends / sink pages.

---

## 📂 Project Structure

```
CrawlX/
├── backend/
│   ├── crawler.py          # BFS crawler with queue and HTML parser
│   ├── indexer.py          # Inverted index builder & tokenizer
│   ├── pagerank.py         # Iterative PageRank engine
│   ├── search.py           # Ranking engine & query scorer
│   ├── models.py           # Pydantic data schemas
│   ├── main.py             # FastAPI server & WebSocket manager
│   ├── Dockerfile          # Backend container spec
│   └── requirements.txt    # Python dependencies
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── CrawlLog.jsx    # Live WebSocket terminal viewer
│   │   │   ├── CrawlPanel.jsx  # Crawl configuration & controls
│   │   │   ├── ResultCard.jsx  # Search result with scoring badges
│   │   │   ├── SearchBar.jsx   # Interactive search input
│   │   │   └── StatsBar.jsx    # System metrics bar
│   │   ├── api/client.js       # Axios HTTP & WS helpers
│   │   ├── App.jsx             # Main application layout
│   │   └── index.css           # Tailwind v4 styles & theme
│   ├── nginx.conf          # Reverse proxy + WS upgrade
│   └── Dockerfile          # Multi-stage production build
├── docker-compose.yml      # Orchestration definition
├── .gitignore              # Git ignore rules
└── README.md               # Documentation
```

---

## 🛡️ License

MIT License. Built with ❤️ for educational and search engine architecture research.