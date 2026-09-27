import React, { useState, useEffect } from 'react';
import { startCrawl, getJobStatus, stopCrawl } from '../api/client';
import CrawlLog from './CrawlLog';

const PRESETS = [
  { name: 'Books to Scrape', url: 'https://books.toscrape.com', pages: 25 },
  { name: 'Quotes to Scrape', url: 'https://quotes.toscrape.com', pages: 15 },
  { name: 'Python 3 Docs', url: 'https://docs.python.org/3/', pages: 30 },
  { name: 'Wikipedia Crawler', url: 'https://en.wikipedia.org/wiki/Web_crawler', pages: 20 },
];

export default function CrawlPanel({ onCrawlComplete }) {
  const [url, setUrl]           = useState('');
  const [maxPages, setMaxPages] = useState(50);
  const [status, setStatus]     = useState('idle'); // idle | crawling | done | error
  const [errorMsg, setErrorMsg] = useState('');
  const [jobId, setJobId]       = useState(null);
  const [stats, setStats]       = useState(null);
  const [progress, setProgress] = useState({ count: 0, total: 0 });

  // ── Poll job status (fallback / source of truth for the job state) ─────────
  useEffect(() => {
    let interval;
    let failCount = 0;
    if (status === 'crawling' && jobId) {
      interval = setInterval(async () => {
        try {
          const res = await getJobStatus(jobId);
          failCount = 0;
          if (res.status === 'done') {
            setStats({ pages_crawled: res.pages_crawled, pages_indexed: res.pages_indexed });
            // Let CrawlLog's onDone handle the transition; this is a safety net
            // in case the WS connection was never established.
            setStatus('done');
            clearInterval(interval);
          } else if (res.status === 'failed') {
            setStatus('error');
            setErrorMsg(res.error || 'Crawl failed');
            clearInterval(interval);
          }
        } catch (err) {
          failCount++;
          console.warn(`Polling job attempt ${failCount}/6 failed:`, err);
          if (failCount >= 6) {
            setStatus('error');
            setErrorMsg('Lost connection to backend server.');
            clearInterval(interval);
          }
        }
      }, 2000);
    }
    return () => clearInterval(interval);
  }, [status, jobId, onCrawlComplete]);

  // Transition to search mode 2.5 s after reaching 'done'
  useEffect(() => {
    if (status === 'done') {
      const t = setTimeout(onCrawlComplete, 2500);
      return () => clearTimeout(t);
    }
  }, [status, onCrawlComplete]);

  const handleCrawl = async (e) => {
    e.preventDefault();
    if (!url) return;
    setStatus('crawling');
    setErrorMsg('');
    setStats(null);
    setProgress({ count: 0, total: maxPages });
    try {
      const res = await startCrawl(url, maxPages);
      setJobId(res.job_id);
    } catch (err) {
      console.error(err);
      setStatus('error');
      setErrorMsg('Failed to start crawl');
    }
  };

  const handleStopCrawl = () => {
    const currentJobId = jobId;
    // Immediately return back to the form page
    setStatus('idle');
    setJobId(null);
    setErrorMsg('');
    setProgress({ count: 0, total: 0 });
    if (currentJobId) {
      stopCrawl(currentJobId).catch(() => {});
    }
  };

  // Called by CrawlLog when the WS "done" event arrives
  const handleWsDone = (msg) => {
    setStats({ pages_crawled: msg.total_pages, pages_indexed: msg.total_pages });
    setStatus('done');
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-4">
      <div className="max-w-2xl w-full bg-gray-900 rounded-xl shadow-2xl p-8 border border-gray-800">
        <h1 className="text-4xl font-bold text-center mb-2">
          <span className="text-cyan-500">Crawl</span>X
        </h1>
        <p className="text-gray-400 text-center mb-8">High Performance Web Crawler &amp; Search Engine</p>

        {/* ── Error banner ─────────────────────────────────────────────────── */}
        {status === 'error' && (
          <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded mb-6">
            <span className="font-bold">Error: </span>{errorMsg}
            <button
              onClick={() => setStatus('idle')}
              className="ml-4 underline text-sm"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* ── FORM (idle / error) ───────────────────────────────────────────── */}
        {(status === 'idle' || status === 'error') && (
          <form onSubmit={handleCrawl} className="space-y-6">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-400">Seed URL</label>
                <span className="text-xs text-gray-500">Must be http/https</span>
              </div>
              <input
                type="url"
                required
                className="w-full px-4 py-3 bg-gray-950 border border-gray-700 rounded-lg text-white font-mono focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-colors"
                placeholder="https://example.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />

              {/* Quick Presets */}
              <div className="mt-3 flex flex-wrap gap-2 items-center">
                <span className="text-xs text-gray-500 font-medium">Quick presets:</span>
                {PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() => {
                      setUrl(preset.url);
                      setMaxPages(preset.pages);
                    }}
                    className="text-xs px-2.5 py-1 bg-gray-800/80 hover:bg-cyan-950/60 text-gray-300 hover:text-cyan-300 rounded border border-gray-700/60 hover:border-cyan-500/50 transition-all cursor-pointer"
                  >
                    {preset.name} <span className="text-gray-500">({preset.pages}p)</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-400">Max Pages</label>
                <span className="text-xs text-cyan-400 font-mono font-semibold">{maxPages} pages</span>
              </div>
              <input
                type="number"
                min="1"
                max="500"
                className="w-full px-4 py-3 bg-gray-950 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-colors"
                value={maxPages}
                onChange={(e) => setMaxPages(parseInt(e.target.value, 10))}
              />
            </div>
            <button
              type="submit"
              className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-3.5 px-4 rounded-lg transition-colors cursor-pointer shadow-lg shadow-cyan-900/20 active:scale-[0.99]"
            >
              Start Crawling
            </button>
          </form>
        )}

        {/* ── CRAWLING state ────────────────────────────────────────────────── */}
        {status === 'crawling' && (
          <>
            <div className="flex flex-col items-center py-6 space-y-4">
              <div className="w-10 h-10 border-4 border-gray-700 border-t-cyan-500 rounded-full animate-spin" />
              <div className="text-center">
                <p className="text-gray-300 font-medium animate-pulse">Concurrent crawling in progress…</p>
                {jobId && <p className="text-xs text-gray-500 font-mono mt-1">job: {jobId}</p>}
              </div>

              {/* Live Progress Bar */}
              {progress.total > 0 && (
                <div className="w-full max-w-md bg-gray-950/80 p-3.5 rounded-lg border border-gray-800 space-y-2">
                  <div className="flex justify-between text-xs font-mono text-gray-400">
                    <span>Progress: {progress.count} / {progress.total} pages</span>
                    <span className="text-cyan-400 font-bold">
                      {Math.round((progress.count / progress.total) * 100)}%
                    </span>
                  </div>
                  <div className="w-full bg-gray-800/80 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-cyan-500 to-blue-500 h-2 rounded-full transition-all duration-300 shadow-sm shadow-cyan-500/50"
                      style={{ width: `${Math.min(100, Math.round((progress.count / progress.total) * 100))}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Stop Crawling button */}
              <button
                type="button"
                onClick={handleStopCrawl}
                className="flex items-center gap-2 px-5 py-2.5 bg-red-950/70 hover:bg-red-900/90 text-red-300 hover:text-white border border-red-700/60 hover:border-red-500 rounded-lg text-sm font-semibold transition-all duration-150 shadow-lg shadow-red-950/40 active:scale-95 cursor-pointer"
              >
                <svg className="w-4 h-4 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                  <rect x="5" y="5" width="10" height="10" rx="1.5" />
                </svg>
                Stop Crawling
              </button>
            </div>

            {/* Live log panel */}
            <CrawlLog
              active={status === 'crawling'}
              seedUrl={url}
              maxPages={maxPages}
              onProgress={(p) => setProgress(p)}
              onDone={handleWsDone}
            />
          </>
        )}

        {/* ── DONE state ────────────────────────────────────────────────────── */}
        {status === 'done' && (
          <div className="flex flex-col items-center justify-center py-10 space-y-4">
            <div className="w-16 h-16 bg-green-900/50 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-xl font-bold text-white">Crawl Complete!</p>
            {stats && (
              <p className="text-gray-400 text-center">
                Indexed{' '}
                <span className="text-cyan-400 font-bold">{stats.pages_indexed}</span> pages.
                <br />
                Redirecting to search…
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
