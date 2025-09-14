import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { BackLink } from "@/components/app/BackLink";
import { Button } from "@/components/ui/button";
import { SEO } from "@/components/app/SEO";
import ePub, { Rendition } from "epubjs";
import { BOOKS } from "@/lib/books";
import { resolveEpubSource } from "@/lib/utils";
import { getDailyBaseline, setDailyBaseline, setProgress, getReadingPlan } from "@/lib/storage";
import { updateDailyProgressWidget } from "@/main";
import { WidgetUpdater, canUseNative } from "@/lib/widgetUpdater";
import { format } from "date-fns";
import { computeDaysRemaining, computeDailyProgressPercent } from "@/lib/reading";

const EpubReader = () => {
  const { epubId = "" } = useParams();
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const container = viewerRef.current;
    if (!container || !epubId) return;
    const getVar = (name: string, fallback: string) => {
      try {
        const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return v ? `hsl(${v})` : fallback;
      } catch { return fallback; }
    };
    const isDarkMode = () => {
      try {
        return document.documentElement.classList.contains('dark') || window.matchMedia?.('(prefers-color-scheme: dark)')?.matches;
      } catch { return false; }
    };
    const applyEpubTheme = () => {
      try {
        const rend = renditionRef.current as any;
        if (!rend) return;
        const themes = rend.themes;
        const bgLight = getVar('--background', '#ffffff');
        const fgLight = getVar('--foreground', '#111111');
        const linkLight = getVar('--primary', '#1d4ed8');
        const bgDark = getVar('--background', '#0b0b0b');
        const fgDark = getVar('--foreground', '#f5f5f5');
        const linkDark = getVar('--primary', '#60a5fa');
        themes.register('light', {
          'html, body': { background: bgLight + ' !important', color: fgLight + ' !important' },
          'a, a:visited': { color: linkLight + ' !important' },
          'p, div, span, li': { color: fgLight + ' !important' },
        });
        themes.register('dark', {
          'html, body': { background: bgDark + ' !important', color: fgDark + ' !important' },
          'a, a:visited': { color: linkDark + ' !important' },
          'p, div, span, li': { color: fgDark + ' !important' },
          'img': { filter: 'none' },
        });
        const dark = isDarkMode();
        themes.select(dark ? 'dark' : 'light');
        // Match container bg too
        try { container.style.background = (dark ? bgDark : bgLight); } catch {}
      } catch {}
    };
    try { localStorage.setItem('lastBookId', epubId); } catch {}
    const meta = BOOKS.find(b => b.id === epubId);
    const src = meta?.sourceUrl || `/epubs/${epubId}.epub`;
    const url = resolveEpubSource(src);

    let cancelled = false;
    const load = async () => {
      try {
        let ab: ArrayBuffer | null = null;
        // Try Cache Storage first
        try {
          if ('caches' in window) {
            const cache = await caches.open('epub-cache-v1');
            const cached = await cache.match(url);
            if (cached && cached.ok) {
              ab = await cached.arrayBuffer();
            }
          }
        } catch {}
        // If not cached, fetch and cache it
        if (!ab) {
          const resp = await fetch(url);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          // Clone and store in cache (best-effort)
          try {
            if ('caches' in window) {
              const cache = await caches.open('epub-cache-v1');
              await cache.put(url, resp.clone());
            }
          } catch {}
          ab = await resp.arrayBuffer();
        }
        if (cancelled) return;
        const book = ePub(ab);
  const rendition = book.renderTo(container, { width: "100%", height: "100%", spread: "none" });
        renditionRef.current = rendition;
  // Apply theme initially and on each render
  applyEpubTheme();
  rendition.on('rendered', () => applyEpubTheme());
    book.ready
  .then(async () => {
    // Listener de mudança de posição
    rendition.on("relocated", (location: any) => {
      try {
  // Compute today's local date on each relocation to catch system date changes
  const todayISO = format(new Date(), 'yyyy-MM-dd');
        const cfi = location?.start?.cfi;
        if (cfi) {
          try { localStorage.setItem(`epubLoc:${epubId}`, cfi); } catch {}
        }

        let percent = 0;

        // Tenta pelas locations (se já existirem)
        try {
          if (book.locations.length) {
            const p = book.locations.percentageFromCfi(cfi);
            if (typeof p === "number" && !isNaN(p)) {
              percent = Math.round(p * 100);
            }
          }
        } catch {}

        // Fallback: usa displayed.percentage até que locations fiquem prontas
        if (!percent) {
          const p2 = location?.start?.displayed?.percentage;
          if (typeof p2 === "number" && !isNaN(p2)) {
            percent = Math.round(p2 * 100);
          }
        }

        setProgress(epubId, { partIndex: 0, chapterIndex: 0, percent });

        // Ensure today's baseline exists (based on percent) and compute daily goal percent
        const base = getDailyBaseline(epubId, todayISO);
        const baselinePercent = base ? base.percent : percent;
        if (base) {
          try { console.log('[Baseline] existente', { scope: 'EpubReader', bookId: epubId, todayISO, base }); } catch {}
        } else {
          if ((percent ?? 0) > 0) {
            setDailyBaseline(epubId, todayISO, { words: 0, percent: baselinePercent });
            try { console.log('[Baseline] persistida', { scope: 'EpubReader', bookId: epubId, todayISO, baselinePercent }); } catch {}
          } else {
            try { console.log('[Baseline] skip persist: percent atual 0', { scope: 'EpubReader', bookId: epubId, todayISO, percent }); } catch {}
          }
        }

        // Compute days remaining from the EPUB reading plan (if any)
        const plan = getReadingPlan(epubId);
        const daysRemaining = computeDaysRemaining(plan?.targetDateISO);
        const dailyTargetPercent = daysRemaining ? Math.ceil(Math.max(0, 100 - baselinePercent) / daysRemaining) : null;
        const achievedPercentToday = Math.max(0, percent - baselinePercent);
        const dailyProgressPercent = computeDailyProgressPercent(achievedPercentToday, dailyTargetPercent) ?? 0;

        // Update widget if on native, using DAILY percent (not book percent)
        (async () => {
          try {
            if (canUseNative()) {
              const hasGoal = dailyTargetPercent != null && dailyTargetPercent > 0;
              await updateDailyProgressWidget(dailyProgressPercent, hasGoal);
              await WidgetUpdater.update?.();
            }
          } catch {}
        })();
      } catch {}
    });
    // Attach swipe gestures to each rendered section (inside iframe)
            const attachSwipe = (contents: any) => {
              try {
                const doc = contents?.document as Document | undefined;
                if (!doc) return;
                let startX = 0, startY = 0, startT = 0;
                const threshold = 50; // px
                const restraintY = 40; // px vertical tolerance
                const maxTime = 800; // ms
                const onTouchStart = (e: TouchEvent) => {
                  const t = e.changedTouches?.[0];
                  if (!t) return;
                  startX = t.clientX;
                  startY = t.clientY;
                  startT = Date.now();
                };
                const onTouchEnd = (e: TouchEvent) => {
                  const t = e.changedTouches?.[0];
                  if (!t) return;
                  const dx = t.clientX - startX;
                  const dy = t.clientY - startY;
                  const dt = Date.now() - startT;
                  if (dt <= maxTime && Math.abs(dy) <= restraintY && Math.abs(dx) >= threshold) {
                    if (dx < 0) rendition.next(); else rendition.prev();
                  }
                };
                doc.addEventListener('touchstart', onTouchStart, { passive: true });
                doc.addEventListener('touchend', onTouchEnd, { passive: true });
                // Clean up when section is unloaded
                contents?.window?.addEventListener('unload', () => {
                  try {
                    doc.removeEventListener('touchstart', onTouchStart as any);
                    doc.removeEventListener('touchend', onTouchEnd as any);
                  } catch {}
                });
              } catch {}
            };

    // Ativa swipe gestures normalmente
    rendition.on('rendered', (_section: any, contents: any) => attachSwipe(contents));
    try {
      const current = (rendition as any).getContents?.();
      const list = Array.isArray(current) ? current : (current ? [current] : []);
      list.forEach((c: any) => attachSwipe(c));
    } catch {}

    // Exibe a posição salva (ou início)
    let saved: string | null = null;
    try { saved = localStorage.getItem(`epubLoc:${epubId}`); } catch {}
    rendition.display(saved || undefined);

    // ⚡ Gera locations em segundo plano (não trava exibição inicial)
    try {
      book.locations.generate(500).then(() => {
        // força um relocated para recalcular percentuais com base nas novas locations
        try { rendition.currentLocation() && rendition.emit("relocated", rendition.currentLocation()); } catch {}
      });
    } catch {}
  })
  .catch(() => setErr("Falha ao carregar o EPUB."));

      } catch (e) {
        if (!cancelled) setErr("Falha ao baixar o EPUB pelo proxy.");
      }
    };
    load();

    return () => { cancelled = true; try { renditionRef.current?.destroy(); } catch {} };
  }, [epubId]);

  // Watch for dark mode changes and re-apply theme
  useEffect(() => {
    const target = document.documentElement;
    let mo: MutationObserver | null = null;
    try {
      mo = new MutationObserver(() => {
        try { (renditionRef.current as any)?.themes && (renditionRef.current as any).themes.select(target.classList.contains('dark') ? 'dark' : 'light'); } catch {}
      });
      mo.observe(target, { attributes: true, attributeFilter: ['class'] });
    } catch {}
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onMq = () => {
      try { (renditionRef.current as any)?.themes && (renditionRef.current as any).themes.select(target.classList.contains('dark') || mq.matches ? 'dark' : 'light'); } catch {}
    };
    try { mq?.addEventListener?.('change', onMq); } catch {}
    return () => {
      try { mo?.disconnect(); } catch {}
      try { mq?.removeEventListener?.('change', onMq); } catch {}
    };
  }, []);

  return (
  <main className="container mx-auto py-10">
      <SEO title={`EPUB — ${epubId}`} description="Leitor EPUB" canonical={`/epub/${epubId}`} />
      <nav className="mb-4 text-sm">
        <BackLink to="/biblioteca" label="Biblioteca" />
      </nav>
      {err && (
        <div className="mb-2 text-destructive">{err}</div>
      )}
      <div className="border rounded h-[80vh] overflow-hidden">
        <div ref={viewerRef} className="w-full h-full" />
      </div>
      <div className="mt-3 flex gap-2">
        <Button onClick={() => renditionRef.current?.prev()}>← Anterior</Button>
        <Button onClick={() => renditionRef.current?.next()}>Próximo →</Button>
      </div>
    </main>
  );
};

export default EpubReader;
