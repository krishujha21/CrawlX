import React, { useEffect, useRef, useState } from 'react';

function getWsUrl() {
  const envWs = import.meta.env.VITE_WS_URL;
  if (envWs && envWs.trim()) {
    return envWs.trim().replace(/\/+$/, '') + '/ws/crawl-log';
  }
  const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
  return (isHttps ? 'wss://crawlx-e0tw.onrender.com' : 'ws://localhost:8000') + '/ws/crawl-log';
}

/**
 * CrawlLog — dark terminal-style panel that streams live BFS crawl events
 * from the backend WebSocket at /ws/crawl-log.
 *
 * Props:
 *   active     {boolean}  — mount/connect when true, disconnect when false
 *   seedUrl    {string}   — displayed in the header line
 *   maxPages   {number}   — used to format [n/total] counters
 *   onDone     {function} — called when the backend emits { event: "done" }
 *   onProgress {function} — called on each page crawl with { count, total }
 */
export default function CrawlLog({ active, seedUrl, maxPages, onDone, onProgress }) {
  const [lines, setLines]   = useState([]);
  const [footer, setFooter] = useState(null);   // { text, ok } | null
  const bottomRef           = useRef(null);
  const wsRef               = useRef(null);

  // ── Connect / disconnect based on `active` prop ───────────────────────────
  useEffect(() => {
    if (!active) return;

    setLines([]);
    setFooter(null);

    const wsUrl = getWsUrl();
    console.log('[CrawlLog] Connecting to WebSocket:', wsUrl);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[CrawlLog] WebSocket connected');
    };

    ws.onmessage = (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch { return; }

      switch (msg.event) {
        case 'started':
          setLines([{
            id:   Date.now(),
            type: 'header',
            text: `Crawling: ${msg.seed_url}  (max ${msg.max_pages} pages)`,
          }]);
          break;

        case 'crawled':
          if (onProgress) {
            onProgress({ count: msg.page_count, total: msg.total ?? maxPages });
          }
          setLines(prev => [...prev, {
            id:       Date.now() + Math.random(),
            type:     'page',
            count:    msg.page_count,
            total:    msg.total ?? maxPages,
            title:    msg.title || '(no title)',
            url:      msg.url,
          }]);
          break;

        case 'done':
          setFooter({
            ok:   true,
            text: `✓ Done — ${msg.total_pages} pages, ${msg.total_words.toLocaleString()} words indexed`,
          });
          ws.close();
          if (onDone) onDone(msg);
          break;

        case 'error':
          setFooter({ ok: false, text: `✗ Error: ${msg.message}` });
          ws.close();
          break;

        default:
          break;
      }
    };

    ws.onerror = () => {
      setFooter({ ok: false, text: '✗ WebSocket connection error' });
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-scroll to bottom on every new line ───────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines, footer]);

  if (!active && lines.length === 0) return null;

  return (
    <div className="mt-6 rounded-lg border border-gray-700 bg-gray-950 overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center gap-2 px-4 py-2 bg-gray-800 border-b border-gray-700">
        <span className="w-3 h-3 rounded-full bg-red-500/70" />
        <span className="w-3 h-3 rounded-full bg-yellow-500/70" />
        <span className="w-3 h-3 rounded-full bg-green-500/70" />
        <span className="ml-2 text-xs text-gray-400 font-mono">crawl-log</span>
        {active && !footer && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-cyan-400 font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
            LIVE
          </span>
        )}
      </div>

      {/* Scrollable log body */}
      <div className="h-64 overflow-y-auto p-4 space-y-1 font-mono text-sm">
        {lines.map((line) => {
          if (line.type === 'header') {
            return (
              <div key={line.id} className="text-cyan-400 font-bold mb-2">
                $ {line.text}
              </div>
            );
          }

          // page line
          const counter = String(line.count).padStart(String(line.total).length, '0');
          return (
            <div key={line.id} className="flex gap-2 items-baseline leading-snug">
              {/* Counter badge */}
              <span className="shrink-0 text-gray-600">
                [{counter}/{line.total}]
              </span>
              {/* Checkmark */}
              <span className="shrink-0 text-green-400">✓</span>
              {/* Title */}
              <span className="text-gray-200 truncate max-w-[40%]" title={line.title}>
                {line.title}
              </span>
              {/* Separator */}
              <span className="text-gray-600 shrink-0">—</span>
              {/* URL */}
              <a
                href={line.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-500 hover:text-cyan-300 truncate flex-1 hover:underline"
                title={line.url}
              >
                {line.url}
              </a>
            </div>
          );
        })}

        {/* Footer: done or error */}
        {footer && (
          <div className={`mt-3 pt-3 border-t border-gray-800 font-bold ${
            footer.ok ? 'text-green-400' : 'text-red-400'
          }`}>
            {footer.text}
          </div>
        )}

        {/* Scroll anchor */}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
