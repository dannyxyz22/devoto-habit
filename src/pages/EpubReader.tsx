import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { BackLink } from "@/components/app/BackLink";
import { Button } from "@/components/ui/button";
import { SEO } from "@/components/app/SEO";
import ePub, { Rendition } from "epubjs";
import { BOOKS } from "@/lib/books";
import { resolveEpubSource } from "@/lib/utils";
import { getDailyBaseline, setDailyBaseline, setProgress, getProgress, getReadingPlan } from "@/lib/storage";
import { updateDailyProgressWidget } from "@/main";
import { WidgetUpdater, canUseNative } from "@/lib/widgetUpdater";
import { format } from "date-fns";
import { computeDaysRemaining, computeDailyProgressPercent } from "@/lib/reading";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Settings, BookOpen, BookOpenCheck, Maximize, Minimize } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { getUserEpubBlob } from "@/lib/userEpubs";
import { loadLocationsFromCache, saveLocationsToCache } from "@/lib/locationsCache";
import { dataLayer } from "@/services/data/RxDBDataLayer";

type LayoutMode = "auto" | "single" | "double";

const EpubReader = () => {
  const { epubId = "" } = useParams();
  const { toast } = useToast();
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(() => {
    try {
      return (localStorage.getItem("epubLayoutMode") as LayoutMode) || "auto";
    } catch {
      return "auto";
    }
  });
  const [settingsOpen, setSettingsOpen] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem("epubReaderSettingsOpen");
      return raw ? JSON.parse(raw) : false;
    } catch {
      return false;
    }
  });
  const [showMobileMenu, setShowMobileMenu] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Persist layout mode preference
  useEffect(() => {
    try {
      localStorage.setItem("epubLayoutMode", layoutMode);
    } catch { }
  }, [layoutMode]);

  // Persist settings panel state
  useEffect(() => {
    try {
      localStorage.setItem("epubReaderSettingsOpen", JSON.stringify(settingsOpen));
    } catch { }
  }, [settingsOpen]);

  // Monitor container width with ResizeObserver (debounced to avoid flickering)
  useEffect(() => {
    const container = viewerRef.current;
    if (!container) return;

    let timeoutId: NodeJS.Timeout;
    const observer = new ResizeObserver((entries) => {
      // Clear previous timeout
      clearTimeout(timeoutId);

      // Wait for resize to stop before updating
      timeoutId = setTimeout(() => {
        for (const entry of entries) {
          setContainerWidth(entry.contentRect.width);
        }
      }, 400); // 400ms delay after resize stops
    });

    observer.observe(container);
    setContainerWidth(container.clientWidth);

    return () => {
      clearTimeout(timeoutId);
      observer.disconnect();
    };
  }, []);

  // Compute effective spread mode
  const effectiveSpread = (() => {
    const threshold = 900;
    if (layoutMode === "single") return "none";
    if (layoutMode === "double") return "auto";
    return containerWidth >= threshold ? "auto" : "none";
  })();

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
        try { container.style.background = (dark ? bgDark : bgLight); } catch { }
      } catch { }
    };
    try { localStorage.setItem('lastBookId', epubId); } catch { }

    // Check if this is a user-uploaded EPUB
    const isUserUpload = epubId.startsWith('user-');

    let cancelled = false;
    const load = async () => {
      try {
        let ab: ArrayBuffer | null = null;

        // If it's a user upload, load from IndexedDB
        if (isUserUpload) {
          const blob = await getUserEpubBlob(epubId);
          if (!blob) {
            throw new Error('User EPUB not found in storage');
          }
          ab = await blob.arrayBuffer();
        } else {
          // Original logic for built-in books
          const meta = BOOKS.find(b => b.id === epubId);
          const src = meta?.sourceUrl || `/epubs/${epubId}.epub`;
          const url = resolveEpubSource(src);

          // Try Cache Storage first
          try {
            if ('caches' in window) {
              const cache = await caches.open('epub-cache-v1');
              const cached = await cache.match(url);
              if (cached && cached.ok) {
                ab = await cached.arrayBuffer();
              }
            }
          } catch { }
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
            } catch { }
            ab = await resp.arrayBuffer();
          }
        }

        if (cancelled) return;
        const book = ePub(ab);
        const rendition = book.renderTo(container, { width: "100%", height: "100%", spread: effectiveSpread as any });
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
                  try { localStorage.setItem(`epubLoc:${epubId}`, cfi); } catch { }
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
                } catch { }

                // Fallback: usa displayed.percentage até que locations fiquem prontas
                if (!percent) {
                  const p2 = location?.start?.displayed?.percentage;
                  if (typeof p2 === "number" && !isNaN(p2)) {
                    percent = Math.round(p2 * 100);
                  }
                }

                setProgress(epubId, { partIndex: 0, chapterIndex: 0, percent });

                // Sync with DataLayer (including CFI)
                (async () => {
                  try {
                    const book = await dataLayer.getBook(epubId);
                    if (book) {
                      await dataLayer.saveBook({
                        ...book,
                        percentage: percent,
                        last_location_cfi: cfi,
                        _modified: Date.now()
                      });
                    }
                  } catch (error) {
                    console.error("Error syncing EPUB progress:", error);
                  }
                })();

                // Ensure today's baseline exists (based on percent) and compute daily goal percent
                const base = getDailyBaseline(epubId, todayISO);
                const baselinePercent = base ? base.percent : percent;
                if (base) {
                  try { console.log('[Baseline] existente', { scope: 'EpubReader', bookId: epubId, todayISO, base }); } catch { }
                } else {
                  if ((percent ?? 0) > 0) {
                    setDailyBaseline(epubId, todayISO, { words: 0, percent: percent });
                    try { console.log('[Baseline] persistida', { scope: 'EpubReader', bookId: epubId, todayISO, baselinePercent: percent }); } catch { }
                  } else {
                    try { console.log('[Baseline] skip persist: percent atual 0', { scope: 'EpubReader', bookId: epubId, todayISO, percent }); } catch { }
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
                  } catch { }
                })();
              } catch { }
            });

            // Attach gestures and click events to each rendered section (inside iframe)
            const attachEvents = (contents: any) => {
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

                  // Swipe detection
                  if (dt <= maxTime && Math.abs(dy) <= restraintY && Math.abs(dx) >= threshold) {
                    if (dx < 0) rendition.next(); else rendition.prev();
                  }
                };

                // Click/Tap detection for menu toggle
                const onClick = (e: Event) => {
                  // Only on mobile
                  if (window.innerWidth < 1024) {
                    // Toggle logic
                    setShowMobileMenu(prev => {
                      const showing = !prev;
                      if (!showing) {
                        document.documentElement.requestFullscreen().catch(() => { });
                        toast({
                          description: "Toque na tela para sair do modo 'Tela cheia' e arraste para os lados para mudar de página",
                          duration: 4000,
                        });
                      } else {
                        if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
                      }
                      return showing;
                    });
                  }
                };

                doc.addEventListener('touchstart', onTouchStart, { passive: true });
                doc.addEventListener('touchend', onTouchEnd, { passive: true });
                doc.addEventListener('click', onClick);

                // Clean up when section is unloaded
                contents?.window?.addEventListener('unload', () => {
                  try {
                    doc.removeEventListener('touchstart', onTouchStart as any);
                    doc.removeEventListener('touchend', onTouchEnd as any);
                    doc.removeEventListener('click', onClick);
                  } catch { }
                });
              } catch { }
            };

            // Ativa swipe gestures e clicks
            rendition.on('rendered', (_section: any, contents: any) => attachEvents(contents));
            try {
              const current = (rendition as any).getContents?.();
              const list = Array.isArray(current) ? current : (current ? [current] : []);
              list.forEach((c: any) => attachEvents(c));
            } catch { }

            // Exibe a posição salva (ou início)
            let saved: string | null = null;
            try {
              // Try local storage first for immediate feedback
              saved = localStorage.getItem(`epubLoc:${epubId}`);

              // If not local, or if we want to ensure sync, check DataLayer
              // Note: This is async, so we might need a better strategy if we want to wait
              // For now, let's try to fetch it before rendering if possible, but here we are inside .then()
              // We can fire a background check
              dataLayer.getBook(epubId).then(book => {
                if (book && book.last_location_cfi && book.last_location_cfi !== saved) {
                  console.log('Found newer cloud location:', book.last_location_cfi);
                  rendition.display(book.last_location_cfi);
                  saved = book.last_location_cfi;
                }
              });
            } catch { }
            rendition.display(saved || undefined);

            // ⚡ Gera locations em segundo plano (ou restaura do cache LRU)
            try {
              // Tenta carregar locations do cache LRU
              const cachedLocations = loadLocationsFromCache(epubId);

              if (cachedLocations) {
                // Restaura locations do cache
                try {
                  const locations = JSON.parse(cachedLocations);
                  book.locations.load(locations);
                  console.log('[Locations] Restauradas do cache LRU:', book.locations.length);
                  // Força recalcular percentuais com locations restauradas
                  try { rendition.currentLocation() && rendition.emit("relocated", rendition.currentLocation()); } catch { }
                } catch (err) {
                  console.error('[Locations] Erro ao restaurar cache:', err);
                  // Se falhar, gera novamente
                  generateAndCacheLocations();
                }
              } else {
                // Não tem cache, gera pela primeira vez
                generateAndCacheLocations();
              }

              function generateAndCacheLocations() {
                book.locations.generate(500).then(() => {
                  // Salva locations no cache LRU
                  try {
                    const locationsData = book.locations.save();
                    saveLocationsToCache(epubId, locationsData);
                  } catch (err) {
                    console.error('[Locations] Erro ao salvar cache:', err);
                  }
                  // Força recalcular percentuais com base nas novas locations
                  try { rendition.currentLocation() && rendition.emit("relocated", rendition.currentLocation()); } catch { }
                });
              }
            } catch { }
          })
          .catch(() => setErr("Falha ao carregar o EPUB."));

      } catch (e) {
        if (!cancelled) setErr("Falha ao baixar o EPUB pelo proxy.");
      }
    };
    load();

    return () => { cancelled = true; try { renditionRef.current?.destroy(); } catch { } };
  }, [epubId, effectiveSpread, toast]);

  // Watch for dark mode changes and re-apply theme
  useEffect(() => {
    const target = document.documentElement;
    let mo: MutationObserver | null = null;
    try {
      mo = new MutationObserver(() => {
        try { (renditionRef.current as any)?.themes && (renditionRef.current as any).themes.select(target.classList.contains('dark') ? 'dark' : 'light'); } catch { }
      });
      mo.observe(target, { attributes: true, attributeFilter: ['class'] });
    } catch { }
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onMq = () => {
      try { (renditionRef.current as any)?.themes && (renditionRef.current as any).themes.select(target.classList.contains('dark') || mq.matches ? 'dark' : 'light'); } catch { }
    };
    try { mq?.addEventListener?.('change', onMq); } catch { }
    return () => {
      try { mo?.disconnect(); } catch { }
      try { mq?.removeEventListener?.('change', onMq); } catch { }
    };
  }, []);

  // Keyboard shortcuts for navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      const rendition = renditionRef.current;
      if (!rendition) return;

      switch (e.key) {
        case 'ArrowLeft':
        case 'PageUp':
          e.preventDefault();
          rendition.prev();
          break;
        case 'ArrowRight':
        case 'PageDown':
        case ' ': // Space bar
          e.preventDefault();
          rendition.next();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Sync menu state with fullscreen changes
  useEffect(() => {
    const onFullscreenChange = () => {
      // If user exits fullscreen (via ESC or system gesture), show the menu
      const isFull = !!document.fullscreenElement;
      setIsFullscreen(isFull);
      if (!isFull) {
        setShowMobileMenu(true);
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  return (
    <main className={`h-screen bg-background flex flex-col items-center justify-center ${isFullscreen ? '' : 'lg:py-8 lg:px-4'}`}>
      <SEO title={`EPUB — ${epubId}`} description="Leitor EPUB" canonical={`/epub/${epubId}`} />

      {/* Header - Hidden on mobile unless showMobileMenu is true */}
      <div
        className={`
          w-full max-w-7xl mb-6 flex items-center justify-between
          transition-all duration-300 fixed top-0 left-0 right-0 p-4 z-50 bg-white/90 backdrop-blur lg:static lg:bg-transparent lg:p-0
          lg:opacity-100 lg:translate-y-0
          ${showMobileMenu ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-full pointer-events-none'}
          ${isFullscreen ? 'hidden' : ''}
        `}
      >
        <nav className={`text-sm lg:block transition-opacity duration-300 ${isFullscreen ? 'lg:opacity-0 lg:pointer-events-none' : 'lg:opacity-100'}`}>
          <BackLink to="/biblioteca" label="Biblioteca" className="text-foreground lg:text-muted-foreground hover:text-primary lg:hover:text-foreground" />
        </nav>

        <div className="flex items-center gap-2">
          {/* Settings Panel - Compact version */}
          <div className={`transition-opacity duration-300 ${isFullscreen ? 'lg:opacity-0 lg:pointer-events-none' : 'lg:opacity-100'}`}>
            <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="icon" className="text-foreground lg:text-muted-foreground hover:text-primary lg:hover:text-foreground lg:hover:bg-accent">
                  <Settings className="h-5 w-5" />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="absolute right-4 top-16 z-50">
                <div className="bg-popover border border-border rounded-lg p-4 shadow-xl min-w-[280px]">
                  <p className="text-sm font-medium text-foreground mb-3">Modo de layout</p>
                  <ToggleGroup type="single" value={layoutMode} onValueChange={(v) => v && setLayoutMode(v as LayoutMode)}>
                    <ToggleGroupItem value="auto" aria-label="Layout automático" title="Automático" className="data-[state=on]:bg-accent">
                      <Settings className="h-4 w-4 mr-2" />
                      Auto
                    </ToggleGroupItem>
                    <ToggleGroupItem value="single" aria-label="Página única" title="Página Única" className="data-[state=on]:bg-accent">
                      <BookOpen className="h-4 w-4 mr-2" />
                      1 Página
                    </ToggleGroupItem>
                    <ToggleGroupItem value="double" aria-label="Duas páginas" title="Duas Páginas" className="data-[state=on]:bg-accent">
                      <BookOpenCheck className="h-4 w-4 mr-2" />
                      2 Páginas
                    </ToggleGroupItem>
                  </ToggleGroup>
                  <p className="text-xs text-muted-foreground mt-3">
                    {layoutMode === "auto" && containerWidth >= 900 && "Modo atual: duas páginas (tela larga)"}
                    {layoutMode === "auto" && containerWidth < 900 && "Modo atual: página única (tela estreita)"}
                    {layoutMode === "single" && "Modo atual: sempre página única"}
                    {layoutMode === "double" && "Modo atual: sempre duas páginas"}
                  </p>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>

          {/* Desktop Fullscreen Toggle */}
          <Button
            variant="ghost"
            size="icon"
            onClick={async () => {
              if (!document.fullscreenElement) {
                try {
                  await document.documentElement.requestFullscreen();
                  toast({
                    description: "Pressione ESC para sair da tela cheia",
                    duration: 4000,
                  });
                } catch (err) {
                  console.error('Fullscreen error:', err);
                  toast({
                    description: "Não foi possível entrar em tela cheia. Tente pressionar F11.",
                    duration: 4000,
                    variant: "destructive",
                  });
                }
              } else {
                try {
                  await document.exitFullscreen();
                } catch (err) {
                  console.error('Exit fullscreen error:', err);
                }
              }
            }}
            className="hidden lg:flex text-muted-foreground hover:text-foreground hover:bg-accent"
            title={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
          >
            {isFullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {err && (
        <div className="mb-4 text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-4 py-2 z-50 relative">
          {err}
        </div>
      )}

      {/* Book Container */}
      <div className="relative w-full max-w-[1500px] flex-1 flex items-center justify-center">
        {/* Navigation Button - Left (Desktop only) */}
        <Button
          onClick={() => renditionRef.current?.prev()}
          variant="ghost"
          size="icon"
          className="absolute left-0 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full bg-background/80 hover:bg-accent text-muted-foreground hover:text-foreground shadow-lg backdrop-blur-sm z-50 flex"
        >
          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Button>

        {/* Book Pages - Full width on mobile, bordered on desktop */}
        <div className={`relative w-full lg:bg-gradient-to-b lg:from-muted lg:to-background lg:rounded-2xl lg:p-6 lg:shadow-2xl ${isFullscreen ? 'h-screen' : ''}`}>
          <div
            className={`relative bg-card lg:rounded-lg lg:shadow-[0_0_60px_rgba(0,0,0,0.1)] overflow-hidden h-screen ${isFullscreen ? '' : 'lg:h-[85vh]'}`}
            style={isFullscreen ? { height: 'calc(100vh - 3rem)' } : undefined}
            onClick={() => {
              // Toggle mobile menu and fullscreen on tap (mobile only)
              if (window.innerWidth < 1024) {
                if (showMobileMenu) {
                  // Hide menu -> Enter Fullscreen
                  setShowMobileMenu(false);
                  document.documentElement.requestFullscreen().catch(() => { });
                  toast({
                    description: "Toque na tela para sair do modo 'Tela cheia' e arraste para os lados para mudar de página",
                    duration: 4000,
                  });
                } else {
                  // Show menu -> Exit Fullscreen
                  setShowMobileMenu(true);
                  if (document.fullscreenElement) {
                    document.exitFullscreen().catch(() => { });
                  }
                }
              }
            }}
          >
            {/* EPUB Viewer */}
            <div ref={viewerRef} className="w-full h-full max-w-full mx-auto" />

            {/* Center Shadow (Book Fold Effect) - Only in double page mode on desktop */}
            {effectiveSpread === 'auto' && (
              <div
                className="absolute top-0 bottom-0 left-1/2 w-4 -ml-2 pointer-events-none z-10 hidden lg:block"
                style={{
                  background: 'linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.08) 20%, rgba(0,0,0,0.15) 50%, rgba(0,0,0,0.08) 80%, transparent 100%)'
                }}
              />
            )}
          </div>
        </div>

        {/* Navigation Button - Right (Desktop only) */}
        <Button
          onClick={() => renditionRef.current?.next()}
          variant="ghost"
          size="icon"
          className="absolute right-0 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full bg-background/80 hover:bg-accent text-muted-foreground hover:text-foreground shadow-lg backdrop-blur-sm z-50 flex"
        >
          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Button>
      </div>
    </main>
  );
};

export default EpubReader;
