import { useState, useEffect, useRef } from 'react';

export function Clock() {
  const [currentTime, setCurrentTime] = useState(new Date());
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    const start = () => {
      if (intervalRef.current) return;
      setCurrentTime(new Date()); // immediate sync on resume
      intervalRef.current = window.setInterval(() => setCurrentTime(new Date()), 1000);
    };
    const stop = () => {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    };
    const onVisibility = () => { document.hidden ? stop() : start(); };

    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, []);

  return (
    <span className="text-slate-500 font-mono text-[10px]">
      {currentTime.toLocaleTimeString('en-US', { hour12: false })}
    </span>
  );
}
