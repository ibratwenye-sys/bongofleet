import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

export const IDLE_WARNING_MS = 29 * 60 * 1000;
export const IDLE_LOGOUT_MS = 30 * 60 * 1000;

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown'] as const;
const POLL_INTERVAL_MS = 1000;

export function useIdleTimer({
  onWarn,
  onTimeout,
}: {
  onWarn: () => void;
  onTimeout: () => void;
}): { reset: () => void } {
  const lastActivityRef = useRef(Date.now());
  const warnedRef = useRef(false);
  const timedOutRef = useRef(false);
  const location = useLocation();

  function reset() {
    lastActivityRef.current = Date.now();
    warnedRef.current = false;
  }

  useEffect(() => {
    const handleActivity = () => reset();
    ACTIVITY_EVENTS.forEach((event) =>
      window.addEventListener(event, handleActivity, { passive: true }),
    );
    return () => {
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, handleActivity));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  useEffect(() => {
    const interval = setInterval(() => {
      const idleFor = Date.now() - lastActivityRef.current;

      if (idleFor >= IDLE_LOGOUT_MS) {
        if (!timedOutRef.current) {
          timedOutRef.current = true;
          onTimeout();
        }
        return;
      }

      if (idleFor >= IDLE_WARNING_MS && !warnedRef.current) {
        warnedRef.current = true;
        onWarn();
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { reset };
}
