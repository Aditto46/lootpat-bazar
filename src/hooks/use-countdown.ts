import { useEffect, useState } from "react";

export type Countdown = {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  ended: boolean;
};

function remaining(targetMs: number): Countdown {
  const diff = Math.max(0, targetMs - Date.now());
  return {
    days: Math.floor(diff / 86_400_000),
    hours: Math.floor((diff / 3_600_000) % 24),
    minutes: Math.floor((diff / 60_000) % 60),
    seconds: Math.floor((diff / 1_000) % 60),
    ended: diff <= 0,
  };
}

export function useCountdown(isoTarget: string): Countdown {
  const targetMs = new Date(isoTarget).getTime();
  const [countdown, setCountdown] = useState<Countdown>(() => remaining(targetMs));

  useEffect(() => {
    setCountdown(remaining(targetMs));
    const timer = window.setInterval(() => {
      setCountdown((current) => {
        if (current.ended) {
          window.clearInterval(timer);
          return current;
        }
        return remaining(targetMs);
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [targetMs]);

  return countdown;
}
