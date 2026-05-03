'use client';

import { useEffect, useState } from 'react';

type Props = {
  value: number;
  durationMs?: number;
};

export default function AnimatedCounter({ value, durationMs = 900 }: Props) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    let frame = 0;
    const steps = 30;
    const increment = value / steps;
    const interval = window.setInterval(() => {
      frame += 1;
      if (frame >= steps) {
        setDisplay(value);
        window.clearInterval(interval);
      } else {
        setDisplay(Math.round(increment * frame));
      }
    }, durationMs / steps);

    return () => window.clearInterval(interval);
  }, [value, durationMs]);

  return <>{display.toLocaleString()}</>;
}
