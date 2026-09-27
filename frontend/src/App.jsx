import React, { useState, useCallback } from 'react';
import CrawlPanel from './components/CrawlPanel';
import SearchBar from './components/SearchBar';
import ResultCard from './components/ResultCard';
import StatsBar from './components/StatsBar';
import { search as apiSearch } from './api/client';

function App() {
  const [mode, setMode] = useState('crawl'); // 'crawl' or 'search'
  const [results, setResults] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [statsTrigger, setStatsTrigger] = useState(0);
  const [queryTime, setQueryTime]       = useState(null);

  const handleCrawlComplete = useCallback(() => {
    setStatsTrigger(prev => prev + 1); // Refresh stats
    setMode('search');
  }, []);

  const handleSearch = async (query) => {
    setIsSearching(true);
    setSearchError('');
    setSearchQuery(query);
    const start = performance.now();
    try {
      const data = await apiSearch(query);
      const elapsed = Math.round(performance.now() - start);
      setQueryTime(elapsed);
      setResults(data.results || []);
    } catch (err) {
      console.error('Search failed', err);
      setSearchError('Search failed to execute. Ensure backend is running.');
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <StatsBar refreshTrigger={statsTrigger} />
      
      <main className="flex-grow">
        {mode === 'crawl' ? (
          <CrawlPanel onCrawlComplete={handleCrawlComplete} />
        ) : (
          <div className="max-w-4xl mx-auto p-4 py-8">
            <div className="mb-8 flex items-center gap-4">
              <button 
                onClick={() => setMode('crawl')}
                className="shrink-0 p-3 bg-gray-900 border border-gray-700 rounded-lg text-gray-400 hover:text-cyan-400 hover:border-cyan-500 transition-colors"
                title="Go back to Crawl mode"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
              </button>
              <div className="flex-grow">
                 <SearchBar onSearch={handleSearch} loading={isSearching} />
              </div>
            </div>

            {searchError && (
              <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded mb-6 text-center">
                {searchError}
              </div>
            )}

            {!isSearching && searchQuery && results.length === 0 && !searchError && (
              <div className="text-center py-12 text-gray-500">
                <p className="text-xl">No results found for "<span className="text-gray-300">{searchQuery}</span>"</p>
                <p className="mt-2">Try a different query or crawl more pages.</p>
              </div>
            )}

            {!isSearching && results.length > 0 && (
              <div className="flex justify-between items-center text-xs font-mono text-gray-500 mb-3 px-1">
                <span>Showing top {results.length} ranked results</span>
                {queryTime !== null && (
                  <span>
                    Query executed in <span className="text-cyan-400 font-semibold">{queryTime}ms</span>
                  </span>
                )}
              </div>
            )}

            <div className="space-y-4">
              {results.map((result, idx) => (
                <ResultCard key={idx} result={result} />
              ))}
            </div>
            
            {!searchQuery && results.length === 0 && (
              <div className="text-center py-20 opacity-50">
                <svg className="w-16 h-16 mx-auto text-gray-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                <p className="text-xl text-gray-400 font-medium">Enter a query to search the index</p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
