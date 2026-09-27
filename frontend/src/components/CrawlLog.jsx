import React, { useEffect, useRef, useState } from 'react';

export function getWsUrl() {
  const envWs = import.meta.env.VITE_WS_URL;
  if (envWs && envWs.trim()) {
    let url = envWs.trim();
    url = url.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://');
    if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
      const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
      url = (isHttps ? 'wss://' : 'ws://') + url;
    }
    url = url.replace(/\/+$/, '');
    if (!url.endsWith('/ws/crawl-log')) {
      url = url.replace(/\/ws$/, '') + '/ws/crawl-log';
    }
    return url;
  }

  const envApi = import.meta.env.VITE_API_URL;
  if (envApi && envApi.trim()) {
    let url = envApi.trim();
    url = url.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://');
    url = url.replace(/\/+$/, '');
    if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
      const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
      url = (isHttps ? 'wss://' : 'ws://') + url;
    }
    return url + '/ws/crawl-log';
  }

  const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
  return (isHttps ? 'wss://crawlx-e0tw.onrender.com' : 'ws://localhost:8000') + '/ws/crawl-log';
}

/**
 * CrawlLog — terminal-style panel that streams live BFS crawl events.
 * Features:
 *   - Auto URL scheme translation (http/https -> ws/wss)
 *   - Automatic 15s keep-alive ping for cloud proxy timeouts (Render/Cloudflare)
 *   - Resilient auto-reconnect on disconnects
 *   - Seamless HTTP polling synchronization fallback
 */
export default function CrawlLog({
  active,
  seedUrl,
  maxPages,
  polledLogs = [],
  onDone,
  onProgress,
}) {
  const [lines, setLines]       = useState([]);
  const [footer, setFooter]     = useState(null); // { text, ok } | null
  const [wsStatus, setWsStatus] = useState('disconnected'); // 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
  const bottomRef               = useRef(null);
  const wsRef                   = useRef(null);
  const unmountedRef            = useRef(false);

  // ── Sync with polled logs (dual-channel fallback) ─────────────────────────
  useEffect(() => {
    if (!polledLogs || polledLogs.length === 0) return;
    setLines((prev) => {
      const existingUrls = new Set(
        prev.filter((l) => l.type === 'page').map((l) => l.url)
      );
      const newItems = [];
      for (const log of polledLogs) {
        if (log.url && !existingUrls.has(log.url)) {
          existingUrls.add(log.url);
          newItems.push({
            id: `poll-${log.page_count || Math.random()}-${log.url}`,
            type: 'page',
            count: log.page_count || existingUrls.size,
            total: log.total ?? maxPages,
            title: log.title || '(no title)',
            url: log.url,
          });
        }
      }
      return newItems.length > 0 ? [...prev, ...newItems] : prev;
    });
  }, [polledLogs, maxPages]);

  // ── WebSocket lifecycle with reconnect & ping heartbeat ──────────────────
  useEffect(() => {
    unmountedRef.current = false;
    if (!active) {
      setWsStatus('disconnected');
      return;
    }

    setLines([{
      id: Date.now(),
      type: 'header',
      text: `Crawling: ${seedUrl || 'job'}  (max ${maxPages} pages)`,
    }]);
    setFooter(null);

    let reconnectTimer = null;
    let pingInterval = null;

    function connect() {
      if (unmountedRef.current || !active) return;

      const wsUrl = getWsUrl();
      setWsStatus('connecting');
      console.log('[CrawlLog] Connecting to WebSocket:', wsUrl);

      let ws;
      try {
        ws = new WebSocket(wsUrl);
      } catch (err) {
        console.warn('[CrawlLog] Failed to instantiate WebSocket, falling back to sync:', err);
        setWsStatus('reconnecting');
        reconnectTimer = setTimeout(connect, 3000);
        return;
      }

      wsRef.current = ws;

      // Keep-alive heartbeat every 15s to keep Render/Cloudflare tunnels open
      pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send('ping');
          } catch (_) {}
        }
      }, 15000);

      ws.onopen = () => {
        if (unmountedRef.current) return;
        setWsStatus('connected');
        console.log('[CrawlLog] WebSocket connected');
      };

      ws.onmessage = (evt) => {
        let msg;
        try {
          msg = JSON.parse(evt.data);
        } catch {
          return;
        }

        switch (msg.event) {
          case 'connected':
            setWsStatus('connected');
            break;

          case 'started':
            setLines((prev) => {
              if (prev.some((l) => l.type === 'header')) return prev;
              return [{
                id: Date.now(),
                type: 'header',
                text: `Crawling: ${msg.seed_url}  (max ${msg.max_pages} pages)`,
              }, ...prev];
            });
            break;

          case 'crawled':
            if (onProgress) {
              onProgress({ count: msg.page_count, total: msg.total ?? maxPages });
            }
            setLines((prev) => {
              // Deduplicate by URL
              if (prev.some((l) => l.url === msg.url)) return prev;
              return [...prev, {
                id: Date.now() + Math.random(),
                type: 'page',
                count: msg.page_count,
                total: msg.total ?? maxPages,
                title: msg.title || '(no title)',
                url: msg.url,
              }];
            });
            break;

          case 'done':
            setFooter({
              ok: true,
              text: `✓ Done — ${msg.total_pages} pages, ${(msg.total_words || 0).toLocaleString()} words indexed`,
            });
            setWsStatus('disconnected');
            if (onDone) onDone(msg);
            break;

          case 'stopped':
            setFooter({
              ok: true,
              text: `Crawl stopped by user (${msg.total_pages || 0} pages collected).`,
            });
            setWsStatus('disconnected');
            break;

          case 'error':
            setFooter({ ok: false, text: `✗ Error: ${msg.message}` });
            setWsStatus('disconnected');
            break;

          default:
            break;
        }
      };

      ws.onerror = (err) => {
        console.warn('[CrawlLog] WebSocket error, continuing with polling sync fallback');
      };

      ws.onclose = () => {
        clearInterval(pingInterval);
        if (unmountedRef.current || !active) {
          setWsStatus('disconnected');
          return;
        }
        setWsStatus('reconnecting');
        console.log('[CrawlLog] WebSocket closed, auto-reconnecting in 3s...');
        reconnectTimer = setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      unmountedRef.current = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pingInterval) clearInterval(pingInterval);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [active, seedUrl, maxPages]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-scroll to bottom on every new line ───────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines, footer]);

  if (!active && lines.length === 0) return null;

  return (
    <div className="mt-6 rounded-lg border border-gray-700 bg-gray-950 overflow-hidden shadow-xl">
      {/* Header bar */}
      <div className="flex items-center gap-2 px-4 py-2 bg-gray-800 border-b border-gray-700">
        <span className="w-3 h-3 rounded-full bg-red-500/70" />
        <span className="w-3 h-3 rounded-full bg-yellow-500/70" />
        <span className="w-3 h-3 rounded-full bg-green-500/70" />
        <span className="ml-2 text-xs text-gray-400 font-mono">crawl-log</span>

        {active && !footer && (
          <span className="ml-auto flex items-center gap-1.5 text-xs font-mono">
            {wsStatus === 'connected' ? (
              <>
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shadow-sm shadow-cyan-400" />
                <span className="text-cyan-400 font-semibold">LIVE</span>
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                <span className="text-amber-400 font-semibold">SYNCING</span>
              </>
            )}
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
          const totalVal = line.total || maxPages;
          const counter = String(line.count).padStart(String(totalVal).length, '0');
          return (
            <div key={line.id} className="flex gap-2 items-baseline leading-snug">
              {/* Counter badge */}
              <span className="shrink-0 text-gray-500 text-xs">
                [{counter}/{totalVal}]
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
                className="text-cyan-400 hover:text-cyan-300 truncate flex-1 hover:underline"
                title={line.url}
              >
                {line.url}
              </a>
            </div>
          );
        })}

        {/* Footer: done or error */}
        {footer && (
          <div
            className={`mt-3 pt-3 border-t border-gray-800 font-bold ${
              footer.ok ? 'text-green-400' : 'text-red-400'
            }`}
          >
            {footer.text}
          </div>
        )}

        {/* Scroll anchor */}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
