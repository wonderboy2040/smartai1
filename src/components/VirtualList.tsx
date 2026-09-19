// ============================================================
// Virtual Scrolling List Component — Wealth AI v18
// ------------------------------------------------------------
// High-performance virtualized windowing component.
// Renders only the visible rows in the viewport + overscan buffer.
// Enables buttery 60fps scrolling with 100+ portfolio items / transactions.
// ============================================================

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';

export interface VirtualListProps<T> {
  items: T[];
  itemHeight: number;
  height: number | string;
  renderItem: (item: T, index: number) => React.ReactNode;
  keyExtractor?: (item: T, index: number) => string;
  overscan?: number;
  emptyComponent?: React.ReactNode;
  className?: string;
}

export function VirtualList<T>({
  items,
  itemHeight,
  height,
  renderItem,
  keyExtractor,
  overscan = 4,
  emptyComponent,
  className = ''
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState<number>(
    typeof height === 'number' ? height : 500
  );

  // ResizeObserver to track container height dynamically
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    if (typeof height === 'number') {
      setContainerHeight(height);
      return;
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.height > 0) {
          setContainerHeight(entry.contentRect.height);
        }
      }
    });

    observer.observe(el);
    setContainerHeight(el.clientHeight || 500);

    return () => observer.disconnect();
  }, [height]);

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const totalHeight = items.length * itemHeight;

  const { visibleItems } = useMemo(() => {
    if (items.length === 0) {
      return { startIndex: 0, endIndex: 0, visibleItems: [] };
    }

    const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const visibleCount = Math.ceil(containerHeight / itemHeight);
    const end = Math.min(items.length, start + visibleCount + overscan * 2);

    const slice = items.slice(start, end).map((item, idx) => ({
      item,
      index: start + idx,
      top: (start + idx) * itemHeight
    }));

    return {
      startIndex: start,
      endIndex: end,
      visibleItems: slice
    };
  }, [items, scrollTop, itemHeight, containerHeight, overscan]);

  if (items.length === 0 && emptyComponent) {
    return <>{emptyComponent}</>;
  }

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      className={`overflow-y-auto relative scrollbar-thin scrollbar-thumb-cyan-500/20 ${className}`}
      style={{
        height: typeof height === 'number' ? `${height}px` : height,
        willChange: 'transform',
        contain: 'strict'
      }}
    >
      <div
        style={{
          height: `${totalHeight}px`,
          position: 'relative',
          width: '100%'
        }}
      >
        {visibleItems.map(({ item, index, top }) => {
          const key = keyExtractor ? keyExtractor(item, index) : index;
          return (
            <div
              key={key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${itemHeight}px`,
                transform: `translateY(${top}px)`,
                willChange: 'transform'
              }}
            >
              {renderItem(item, index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
