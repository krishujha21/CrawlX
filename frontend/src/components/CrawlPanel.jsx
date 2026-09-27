import React, { useState, useEffect } from 'react';
import { startCrawl, getJobStatus } from '../api/client';
import CrawlLog from './CrawlLog';

export default function CrawlPanel({ onCrawlComplete }) {
  const [url, setUrl]         = useState('');
  const [maxPages, setMaxPages] = useState(50);
  const [status, setStatus]   = useState('idle'); // idle | crawling | done | error
  const [errorMsg, setErrorMsg] = useState('');
  const [jobId, setJobId]     = useState(null);
  const [stats, setStats]     = useState(null);

  // ── Poll job status (fallback / source of truth for the job state) ─────────
  useEffect(() => {
    let interval;
    if (status === 'crawling' && jobId) {
      interval = setInterval(async () => {
        try {
          const res = await getJobStatus(jobId);
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
          console.error(err);
          setStatus('error');
          setErrorMsg('Error checking job status');
          clearInterval(interval);
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
    try {
      const res = await startCrawl(url, maxPages);
      setJobId(res.job_id);
    } catch (err) {
      console.error(err);
      setStatus('error');
      setErrorMsg('Failed to start crawl');
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
        <p className="text-gray-400 text-center mb-8">Web Scraper &amp; Search Engine</p>

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
              <label className="block text-sm font-medium text-gray-400 mb-2">Seed URL</label>
              <input
                type="url"
                required
                className="w-full px-4 py-3 bg-gray-950 border border-gray-700 rounded-lg text-white font-mono focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-colors"
                placeholder="https://example.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">Max Pages</label>
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
              className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-3 px-4 rounded-lg transition-colors"
            >
              Start Crawling
            </button>
          </form>
        )}

        {/* ── CRAWLING state ────────────────────────────────────────────────── */}
        {status === 'crawling' && (
          <>
            <div className="flex flex-col items-center py-6 space-y-3">
              <div className="w-10 h-10 border-4 border-gray-700 border-t-cyan-500 rounded-full animate-spin" />
              <p className="text-gray-300 animate-pulse">Crawling in progress…</p>
              <p className="text-xs text-gray-600 font-mono">job: {jobId}</p>
            </div>

            {/* Live log panel */}
            <CrawlLog
              active={status === 'crawling'}
              seedUrl={url}
              maxPages={maxPages}
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
