import { useState, useEffect } from 'react';

export function Clock() {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <span className="text-slate-500 font-mono text-[10px]">
      {currentTime.toLocaleTimeString('en-US', { hour12: false })}
    </span>
  );
}
