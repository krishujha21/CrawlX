import React, { useEffect, useState } from 'react';
import { getStats, resetDatabase } from '../api/client';

export default function StatsBar({ refreshTrigger }) {
  const [stats, setStats] = useState({ total_pages: 0, total_words: 0, index_size: 0 });
  const [isResetting, setIsResetting] = useState(false);

  const fetchStats = async () => {
    try {
      const data = await getStats();
      setStats(data);
    } catch (err) {
      console.error('Failed to load stats', err);
    }
  };

  useEffect(() => {
    fetchStats();
  }, [refreshTrigger]);

  const handleReset = async () => {
    if (!window.confirm('Are you sure you want to clear all indexed pages and search data from MongoDB?')) {
      return;
    }
    setIsResetting(true);
    try {
      await resetDatabase();
      setStats({ total_pages: 0, total_words: 0, index_size: 0 });
    } catch (err) {
      alert('Failed to reset database: ' + (err.message || 'Server error'));
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="w-full bg-gray-900 border-b border-gray-800 py-2.5 px-6 flex flex-wrap justify-between items-center text-sm gap-4">
      <div className="flex items-center space-x-6">
        <div className="flex flex-col">
          <span className="text-gray-500 uppercase text-[10px] font-bold tracking-wider">
            Total Pages in DB
          </span>
          <span className="text-gray-100 font-mono text-base font-semibold">
            {stats.total_pages.toLocaleString()}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-gray-500 uppercase text-[10px] font-bold tracking-wider">
            Total Words
          </span>
          <span className="text-gray-100 font-mono text-base font-semibold">
            {stats.total_words.toLocaleString()}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-gray-500 uppercase text-[10px] font-bold tracking-wider">
            Index Vocab
          </span>
          <span className="text-gray-100 font-mono text-base font-semibold">
            {stats.index_size.toLocaleString()}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        {stats.total_pages > 0 && (
          <button
            type="button"
            onClick={handleReset}
            disabled={isResetting}
            title="Wipe database and reset page count to 0"
            className="text-xs px-2.5 py-1 bg-red-950/40 hover:bg-red-900/60 text-red-400 hover:text-red-300 border border-red-800/40 hover:border-red-600 rounded transition-colors cursor-pointer disabled:opacity-50"
          >
            {isResetting ? 'Clearing…' : 'Clear Index'}
          </button>
        )}
        <span className="text-cyan-500 font-bold text-lg tracking-widest hidden sm:inline">
          CRAWLX
        </span>
      </div>
    </div>
  );
}
