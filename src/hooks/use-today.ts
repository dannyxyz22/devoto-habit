import { useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';

export function useTodayISO() {
  const [todayISO, setTodayISO] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const clear = () => {
      try { if (timeoutRef.current != null) clearTimeout(timeoutRef.current); } catch {}
      timeoutRef.current = null;
    };
    const check = () => {
      try {
    const nowISO = format(new Date(), 'yyyy-MM-dd');
        if (nowISO !== todayISO) setTodayISO(nowISO);
      } catch {}
    };
    const msUntilNextMidnight = () => {
      const now = new Date();
      const next = new Date(now);
      next.setHours(24, 0, 0, 0);
      return Math.max(100, next.getTime() - now.getTime());
    };
    const schedule = () => {
      clear();
      try { timeoutRef.current = window.setTimeout(() => { check(); schedule(); }, msUntilNextMidnight()); } catch {}
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
      schedule();
    };
    try { document.addEventListener('visibilitychange', onVisible); } catch {}
    try { window.addEventListener('focus', onVisible as any); } catch {}
    // Initial check and schedule to next midnight
    check();
    schedule();
    return () => {
      try { document.removeEventListener('visibilitychange', onVisible); } catch {}
      try { window.removeEventListener('focus', onVisible as any); } catch {}
      clear();
    };
  }, [todayISO]);

  return todayISO;
}
