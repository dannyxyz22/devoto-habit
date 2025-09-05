import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { SEO } from "@/components/app/SEO";
import ePub, { Rendition } from "epubjs";
import { BOOKS } from "@/lib/books";
import { resolveEpubSource } from "@/lib/utils";
import { getDailyBaseline, setDailyBaseline, setProgress } from "@/lib/storage";
import { formatISO } from "date-fns";

const EpubReader = () => {
  const { epubId = "" } = useParams();
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const container = viewerRef.current;
    if (!container || !epubId) return;
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
        const todayISO = formatISO(new Date(), { representation: "date" });
        book.ready
          .then(async () => {
            // Attach relocation listener immediately
            rendition.on("relocated", (location: any) => {
              try {
                const cfi = location?.start?.cfi;
                if (cfi) {
                  try { localStorage.setItem(`epubLoc:${epubId}`, cfi); } catch {}
                }
                let percent = 0;
                try {
                  const p = book.locations.percentageFromCfi(cfi);
                  if (typeof p === "number" && !isNaN(p)) percent = Math.round(p * 100);
                } catch {}
                if (!percent) {
                  const p2 = location?.start?.displayed?.percentage;
                  if (typeof p2 === "number" && !isNaN(p2)) percent = Math.round(p2 * 100);
                }
                setProgress(epubId, { partIndex: 0, chapterIndex: 0, percent });
                const base = getDailyBaseline(epubId, todayISO);
                if (!base) setDailyBaseline(epubId, todayISO, { words: 0, percent });
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
            // On each section render, attach swipe
            rendition.on('rendered', (_section: any, contents: any) => attachSwipe(contents));
            // Also attach to any currently loaded contents
            try {
              const current = (rendition as any).getContents?.();
              const list = Array.isArray(current) ? current : (current ? [current] : []);
              list.forEach((c: any) => attachSwipe(c));
            } catch {}
            // Display immediately (saved CFI if available)
            let saved: string | null = null;
            try { saved = localStorage.getItem(`epubLoc:${epubId}`); } catch {}
            try { if (saved) return rendition.display(saved); } catch {}
            const disp = rendition.display();
            // Generate locations in background with lower granularity for speed
            try { void book.locations.generate(500); } catch {}
            return disp;
          })
          .catch(() => setErr("Falha ao carregar o EPUB."));
      } catch (e) {
        if (!cancelled) setErr("Falha ao baixar o EPUB pelo proxy.");
      }
    };
    load();

    return () => { cancelled = true; try { renditionRef.current?.destroy(); } catch {} };
  }, [epubId]);

  return (
    <main className="container mx-auto py-4">
      <SEO title={`EPUB — ${epubId}`} description="Leitor EPUB" canonical={`/epub/${epubId}`} />
      <nav className="mb-4 text-sm">
        <Link to="/biblioteca" className="text-primary underline-offset-4 hover:underline">← Biblioteca</Link>
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
