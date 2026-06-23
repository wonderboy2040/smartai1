import { useEffect, useRef, useState } from 'react';

// Flashes green/red for ~0.6s whenever the price ticks up/down — gives the
// portfolio a live trading-terminal feel. Pure presentational; pass the latest
// live price in `value`.
export function LivePrice({
  value,
  prefix = '',
  suffix = '',
  decimals = 2,
  className = '',
}: {
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  className?: string;
}) {
  const prev = useRef(value);
  const [dir, setDir] = useState<'up' | 'down' | ''>('');

  useEffect(() => {
    if (value > prev.current) setDir('up');
    else if (value < prev.current) setDir('down');
    prev.current = value;
    if (dir) {
      const t = setTimeout(() => setDir(''), 600);
      return () => clearTimeout(t);
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const text = Number.isFinite(value)
    ? value.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : '--';

  return (
    <span className={`live-price ${dir ? `flash-${dir}` : ''} ${className}`}>
      {prefix}{text}{suffix}
    </span>
  );
}
