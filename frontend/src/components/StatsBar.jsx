import React, { useEffect, useState } from 'react';
import { getStats } from '../api/client';

export default function StatsBar({ refreshTrigger }) {
  const [stats, setStats] = useState({ total_pages: 0, total_words: 0, index_size: 0 });

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const data = await getStats();
        setStats(data);
      } catch (err) {
        console.error('Failed to load stats', err);
      }
    };
    fetchStats();
  }, [refreshTrigger]);

  return (
    <div className="w-full bg-gray-900 border-b border-gray-800 py-3 px-6 flex flex-wrap justify-between items-center text-sm">
      <div className="flex items-center space-x-6">
        <div className="flex flex-col">
          <span className="text-gray-500 uppercase text-xs font-bold tracking-wider">Pages Indexed</span>
          <span className="text-gray-100 font-mono text-base">{stats.total_pages.toLocaleString()}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-gray-500 uppercase text-xs font-bold tracking-wider">Total Words</span>
          <span className="text-gray-100 font-mono text-base">{stats.total_words.toLocaleString()}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-gray-500 uppercase text-xs font-bold tracking-wider">Index Size</span>
          <span className="text-gray-100 font-mono text-base">{stats.index_size.toLocaleString()}</span>
        </div>
      </div>
      <div className="hidden sm:block">
        <span className="text-cyan-500 font-bold text-lg tracking-widest">CRAWLX</span>
      </div>
    </div>
  );
}
