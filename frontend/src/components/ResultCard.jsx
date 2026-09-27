import React from 'react';

export default function ResultCard({ result }) {
  const tfidf    = (result.score        ?? 0).toFixed(4);
  const pr       = (result.pagerank_score ?? 0).toFixed(4);
  const final    = (result.final_score   ?? result.score ?? 0).toFixed(4);

  return (
    <div className="bg-gray-900 rounded-lg p-5 border border-gray-800 hover:border-cyan-500/50 transition-colors duration-200">
      {/* Title row */}
      <div className="flex justify-between items-start mb-2 gap-4">
        <a
          href={result.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-xl font-bold text-white hover:text-cyan-400 truncate"
        >
          {result.title}
        </a>
      </div>

      {/* URL */}
      <a
        href={result.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block text-cyan-500 font-mono text-sm mb-3 truncate hover:underline"
      >
        {result.url}
      </a>

      {/* Snippet */}
      <p className="text-gray-400 text-sm leading-relaxed mb-4">
        {result.snippet}
      </p>

      {/* Score badges */}
      <div className="flex flex-wrap gap-2">
        {/* TF-IDF — blue */}
        <span className="inline-flex items-center gap-1 bg-blue-900/60 text-blue-300 text-xs font-mono px-2.5 py-1 rounded-full border border-blue-700/50">
          <span className="text-blue-500">TF-IDF</span>
          <span className="text-blue-200">{tfidf}</span>
        </span>

        {/* PageRank — purple */}
        <span className="inline-flex items-center gap-1 bg-purple-900/60 text-purple-300 text-xs font-mono px-2.5 py-1 rounded-full border border-purple-700/50">
          <span className="text-purple-400">PageRank</span>
          <span className="text-purple-200">{pr}</span>
        </span>

        {/* Final score — cyan, most prominent */}
        <span className="inline-flex items-center gap-1 bg-cyan-900/60 text-cyan-300 text-xs font-mono px-2.5 py-1 rounded-full border border-cyan-600/60 font-semibold">
          <span className="text-cyan-400">Score</span>
          <span className="text-cyan-100">{final}</span>
        </span>
      </div>
    </div>
  );
}
