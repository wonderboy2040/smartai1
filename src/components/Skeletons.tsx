import React from 'react';

export const PortfolioSkeleton: React.FC = () => (
  <div className="space-y-4 animate-pulse">
    {[1, 2, 3, 4, 5].map(i => (
      <div key={i} className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
        <div className="flex items-center justify-between mb-3">
          <div className="h-6 bg-slate-700/50 rounded w-24" />
          <div className="h-6 bg-slate-700/50 rounded w-16" />
        </div>
        <div className="space-y-2">
          <div className="h-4 bg-slate-700/50 rounded w-full" />
          <div className="h-4 bg-slate-700/50 rounded w-3/4" />
        </div>
      </div>
    ))}
  </div>
);

export const MarketSkeleton: React.FC = () => (
  <div className="space-y-4 animate-pulse">
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
          <div className="h-4 bg-slate-700/50 rounded w-20 mb-2" />
          <div className="h-8 bg-slate-700/50 rounded w-full mb-2" />
          <div className="h-3 bg-slate-700/50 rounded w-16" />
        </div>
      ))}
    </div>
  </div>
);

export const ChartSkeleton: React.FC = () => (
  <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50 animate-pulse">
    <div className="h-6 bg-slate-700/50 rounded w-32 mb-4" />
    <div className="h-[300px] bg-slate-700/30 rounded-lg flex items-end justify-around px-4 pb-4 gap-2">
      {[40, 60, 45, 80, 55, 70, 50, 85, 65, 75].map((height, i) => (
        <div
          key={i}
          className="bg-slate-700/50 rounded-t"
          style={{ height: `${height}%`, width: '8%' }}
        />
      ))}
    </div>
  </div>
);

export const CardSkeleton: React.FC = () => (
  <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50 animate-pulse">
    <div className="h-6 bg-slate-700/50 rounded w-40 mb-4" />
    <div className="space-y-3">
      <div className="h-4 bg-slate-700/50 rounded w-full" />
      <div className="h-4 bg-slate-700/50 rounded w-5/6" />
      <div className="h-4 bg-slate-700/50 rounded w-4/6" />
    </div>
  </div>
);

export const TableSkeleton: React.FC<{ rows?: number }> = ({ rows = 5 }) => (
  <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden animate-pulse">
    <div className="border-b border-slate-700/50 p-4">
      <div className="grid grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-4 bg-slate-700/50 rounded" />
        ))}
      </div>
    </div>
    <div className="divide-y divide-slate-700/50">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="p-4">
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(j => (
              <div key={j} className="h-4 bg-slate-700/50 rounded" />
            ))}
          </div>
        </div>
      ))}
    </div>
  </div>
);

export const ListSkeleton: React.FC<{ items?: number }> = ({ items = 3 }) => (
  <div className="space-y-3 animate-pulse">
    {Array.from({ length: items }).map((_, i) => (
      <div key={i} className="flex items-center gap-4 bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
        <div className="w-12 h-12 bg-slate-700/50 rounded-full flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-slate-700/50 rounded w-3/4" />
          <div className="h-3 bg-slate-700/50 rounded w-1/2" />
        </div>
        <div className="h-8 bg-slate-700/50 rounded w-20" />
      </div>
    ))}
  </div>
);

export const StatsSkeleton: React.FC = () => (
  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse">
    {[1, 2, 3, 4].map(i => (
      <div key={i} className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50">
        <div className="h-4 bg-slate-700/50 rounded w-24 mb-3" />
        <div className="h-10 bg-slate-700/50 rounded w-full mb-2" />
        <div className="h-3 bg-slate-700/50 rounded w-20" />
      </div>
    ))}
  </div>
);

export const SpinnerSkeleton: React.FC = () => (
  <div className="flex items-center justify-center p-8">
    <div className="relative w-16 h-16">
      <div className="absolute inset-0 border-4 border-slate-700/30 rounded-full" />
      <div className="absolute inset-0 border-4 border-cyan-500 rounded-full border-t-transparent animate-spin" />
    </div>
  </div>
);

export const FullPageSkeleton: React.FC = () => (
  <div className="min-h-screen bg-slate-950 p-4 space-y-6 animate-pulse">
    <div className="h-16 bg-slate-800/50 rounded-xl border border-slate-700/50" />
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <ChartSkeleton />
        <TableSkeleton />
      </div>
      <div className="space-y-6">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    </div>
  </div>
);
