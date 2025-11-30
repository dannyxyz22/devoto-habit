import { useEffect, useRef, useState, useMemo } from "react";
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
import { Settings, BookOpen, BookOpenCheck, Maximize, Minimize, Sun, Moon, Monitor } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { getUserEpubBlob } from "@/lib/userEpubs";
import { loadLocationsFromCache, saveLocationsToCache } from "@/lib/locationsCache";
import { dataLayer } from "@/services/data/RxDBDataLayer";
import { Slider } from "@/components/ui/slider";
import { useTheme } from "next-themes";

type LayoutMode = "auto" | "single" | "double";
type FontFamily = "serif" | "sans" | "dyslexic";
type ThemeMode = "system" | "light" | "dark" | "sepia";
type ContentWidth = "narrow" | "medium" | "wide";

interface ReadingPreferences {
  fontSize: number; // 100-200 (percentage)
  fontFamily: FontFamily;
  lineHeight: number; // 1.4-2.0
  theme: ThemeMode;
  contentWidth: ContentWidth;
}

const DEFAULT_PREFERENCES: ReadingPreferences = {
  fontSize: 100,
  fontFamily: "serif",
  lineHeight: 1.6,
  theme: "system",
  contentWidth: "medium",
};

const EpubReader = () => {
  const { epubId = "" } = useParams();
  const { toast } = useToast();
  const { resolvedTheme } = useTheme();
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

  // Reading preferences state
  // Track if a rendition has been initialized so we can re-apply preferences
  const [renditionReady, setRenditionReady] = useState<boolean>(false);

  const [preferences, setPreferences] = useState<ReadingPreferences>(() => {
    // Initial load uses global key only; epubId-specific load happens in effect below
    try {
      const globalRaw = localStorage.getItem("epubReadingPreferences");
      return globalRaw ? { ...DEFAULT_PREFERENCES, ...JSON.parse(globalRaw) } : DEFAULT_PREFERENCES;
    } catch {
      return DEFAULT_PREFERENCES;
    }
  });

  // Resolve the effective theme based on preferences.theme and system preference
  // When resolvedTheme is undefined (initial render), defaults to 'light'
  const effectiveTheme = useMemo(() => {
    if (preferences.theme === 'system') {
      return resolvedTheme === 'dark' ? 'dark' : 'light';
    }
    return preferences.theme;
  }, [preferences.theme, resolvedTheme]);

  // Reload preferences when book changes (supports per-book storage with fallback to global)
  useEffect(() => {
    if (!epubId) return;
    try {
      const globalRaw = localStorage.getItem("epubReadingPreferences");
      const perBookRaw = localStorage.getItem(`epubReadingPreferences:${epubId}`);
      const merged = {
        ...DEFAULT_PREFERENCES,
        ...(globalRaw ? JSON.parse(globalRaw) : {}),
        ...(perBookRaw ? JSON.parse(perBookRaw) : {}),
      } as ReadingPreferences;
      setPreferences(merged);
    } catch {
      setPreferences(DEFAULT_PREFERENCES);
    }
  }, [epubId]);

  // Reading progress state
  const [readingProgress, setReadingProgress] = useState<{
    percentage: number;
    currentPage: number;
    totalPages: number;
  }>({
    percentage: 0,
    currentPage: 0,
    totalPages: 0,
  });

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

  // Persist reading preferences (both global last-used and per-book)
  useEffect(() => {
    try {
      localStorage.setItem("epubReadingPreferences", JSON.stringify(preferences));
      if (epubId) {
        localStorage.setItem(`epubReadingPreferences:${epubId}`, JSON.stringify(preferences));
      }
    } catch { }
  }, [preferences, epubId]);

  // Apply reading preferences to rendition (runs whenever preferences, effectiveTheme or renditionReady change)
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition || !renditionReady) return;

    // Wait for next frame to ensure rendition is ready
    requestAnimationFrame(() => {
      try {
        const themes = (rendition as any).themes;
        if (!themes) {
          console.warn('[Preferences] Themes not ready yet');
          return;
        }

        // Select theme using the resolved effective theme
        themes.select(effectiveTheme);

        // Update container background
        const getVar = (name: string, fallback: string) => {
          try {
            const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
            return v ? `hsl(${v})` : fallback;
          } catch { return fallback; }
        };
        const bgLight = getVar('--background', '#ffffff');
        const bgDark = getVar('--background', '#0b0b0b');
        const bgSepia = '#f4ecd8';
        const bgMap: Record<string, string> = { light: bgLight, dark: bgDark, sepia: bgSepia };

        const container = viewerRef.current;
        if (container) {
          try { container.style.background = bgMap[effectiveTheme]; } catch { }
        }

        // Apply font size
        themes.fontSize(`${preferences.fontSize}%`);

        // Apply font family
        const fontFamilyMap: Record<FontFamily, string> = {
          serif: "Georgia, 'Times New Roman', serif",
          sans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          dyslexic: "'OpenDyslexic', sans-serif",
        };
        themes.font(fontFamilyMap[preferences.fontFamily]);

        // Apply line height and content width via override
        const widthMap: Record<ContentWidth, string> = {
          narrow: "60%",
          medium: "80%",
          wide: "95%",
        };

        themes.override("line-height", preferences.lineHeight.toString());
        themes.override("max-width", widthMap[preferences.contentWidth]);
        themes.override("margin", "0 auto");

        // Re-render to apply changes immediately, keeping exact CFI position
        try {
          const currentLocation = rendition.currentLocation() as any;
          const currentCfi = currentLocation?.start?.cfi;
          if (currentCfi) {
            // Wait for styles to propagate, then redisplay at same CFI
            requestAnimationFrame(() => {
              rendition.display(currentCfi);
            });
          }
        } catch (err) {
          console.warn('[Preferences] Reaplicar CFI falhou:', err);
        }

        console.log('[Preferences] Applied:', { ...preferences, effectiveTheme });
      } catch (error) {
        console.error("[Preferences] Error applying:", error);
      }
    });
  }, [preferences, effectiveTheme, renditionReady, epubId]);

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
        const bgSepia = '#f4ecd8';
        const fgSepia = '#5c4a3a';
        const linkSepia = '#8b6914';

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
        themes.register('sepia', {
          'html, body': { background: bgSepia + ' !important', color: fgSepia + ' !important' },
          'a, a:visited': { color: linkSepia + ' !important' },
          'p, div, span, li': { color: fgSepia + ' !important' },
        });
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
        setRenditionReady(true); // signal that rendition has been created
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
                let totalPages = 1;

                // Tenta pelas locations (se já existirem)
                try {
                  if (book.locations.length()) {
                    const p = book.locations.percentageFromCfi(cfi);
                    if (typeof p === "number" && !isNaN(p)) {
                      percent = Math.round(p * 100);
                    }
                    totalPages = book.locations.length();
                  }
                } catch { }

                // Fallback: usa displayed.percentage até que locations fiquem prontas
                if (!percent) {
                  const p2 = location?.start?.displayed?.percentage;
                  if (typeof p2 === "number" && !isNaN(p2)) {
                    percent = Math.round(p2 * 100);
                  }
                }

                // Update reading progress state
                const currentPage = Math.max(1, Math.round((percent / 100) * totalPages));
                setReadingProgress({
                  percentage: percent,
                  currentPage,
                  totalPages: Math.max(totalPages, 1),
                });

                setProgress(epubId, { partIndex: 0, chapterIndex: 0, percent });

                // Sync with DataLayer (including CFI)
                (async () => {
                  try {
                    // Try to find in user_epubs first using DataLayer
                    const userEpub = await dataLayer.getUserEpub(epubId);

                    if (userEpub) {
                      // Update user_epub progress via DataLayer
                      await dataLayer.saveUserEpub({
                        ...userEpub,
                        percentage: percent,
                        last_location_cfi: cfi,
                        _modified: Date.now()
                      });
                      console.log('[EpubReader] Progress synced to user_epubs:', { id: epubId, percent, cfi });
                    } else {
                      // Fallback to books collection (for static EPUBs)
                      const book = await dataLayer.getBook(epubId);
                      if (book) {
                        await dataLayer.saveBook({
                          ...book,
                          percentage: percent,
                          last_location_cfi: cfi,
                          _modified: Date.now()
                        });
                        console.log('[EpubReader] Progress synced to books:', { id: epubId, percent, cfi });
                      } else {
                        // If not in DB, check if it is a static book and create it
                        const staticBook = BOOKS.find(b => b.id === epubId);
                        if (staticBook) {
                          console.log('[EpubReader] Static book not in DB, creating...', staticBook.title);
                          await dataLayer.saveBook({
                            id: staticBook.id,
                            title: staticBook.title,
                            author: staticBook.author,
                            type: 'epub',
                            percentage: percent,
                            last_location_cfi: cfi,
                            cover_url: staticBook.coverImage,
                            added_date: Date.now(),
                            _modified: Date.now()
                          });
                        }
                      }
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

              // Check RxDB for cloud-synced location (user_epubs or books)
              (async () => {
                try {
                  const db = await import('@/lib/database/db').then(m => m.getDatabase());
                  const dbInstance = await db;

                  // Check user_epubs first
                  const userEpub = await dbInstance.user_epubs.findOne({
                    selector: { id: epubId }
                  }).exec();

                  if (userEpub) {
                    const epub = userEpub.toJSON();
                    if (epub.last_location_cfi && epub.last_location_cfi !== saved) {
                      console.log('[EpubReader] Found cloud location from user_epubs:', epub.last_location_cfi);
                      rendition.display(epub.last_location_cfi);
                      saved = epub.last_location_cfi;
                    }
                  } else {
                    // Fallback to books collection
                    const book = await dataLayer.getBook(epubId);
                    if (book && book.last_location_cfi && book.last_location_cfi !== saved) {
                      console.log('[EpubReader] Found cloud location from books:', book.last_location_cfi);
                      rendition.display(book.last_location_cfi);
                      saved = book.last_location_cfi;
                    }
                  }
                } catch (err) {
                  console.warn('[EpubReader] Error loading cloud location:', err);
                }
              })();
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

  // Note: System theme changes are handled automatically via effectiveTheme
  // which responds to resolvedTheme from next-themes

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
          // Refocus to ensure keyboard continues working
          setTimeout(() => document.body.focus(), 100);
          break;
        case 'ArrowRight':
        case 'PageDown':
        case ' ': // Space bar
          e.preventDefault();
          rendition.next();
          // Refocus to ensure keyboard continues working
          setTimeout(() => document.body.focus(), 100);
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
          {/* Settings Panel */}
          <div className={`transition-opacity duration-300 ${isFullscreen ? 'lg:opacity-0 lg:pointer-events-none' : 'lg:opacity-100'}`}>
            <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="icon" className="text-foreground lg:text-muted-foreground hover:text-primary lg:hover:text-foreground lg:hover:bg-accent">
                  <Settings className="h-5 w-5" />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="absolute right-4 top-16 z-50 max-h-[calc(100vh-8rem)] overflow-y-auto">
                <div className="bg-popover border border-border rounded-lg p-4 shadow-xl min-w-[280px] lg:min-w-[320px] space-y-4">
                  {/* Progress Indicator */}
                  <div className="pb-3 border-b border-border">
                    <p className="text-xs font-medium text-muted-foreground mb-2">Progresso de Leitura</p>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-foreground font-medium">{readingProgress.percentage}%</span>
                      <span className="text-muted-foreground text-xs">
                        Página {readingProgress.currentPage} de {readingProgress.totalPages}
                      </span>
                    </div>
                    <div className="mt-2 w-full bg-secondary rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-primary h-full transition-all duration-300 rounded-full"
                        style={{ width: `${readingProgress.percentage}%` }}
                      />
                    </div>
                  </div>

                  {/* Font Size */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium text-foreground">Tamanho da Fonte</label>
                      <span className="text-xs text-muted-foreground">{preferences.fontSize}%</span>
                    </div>
                    <Slider
                      value={[preferences.fontSize]}
                      onValueChange={([value]) => setPreferences(prev => ({ ...prev, fontSize: value }))}
                      min={100}
                      max={200}
                      step={10}
                      className="w-full"
                    />
                  </div>

                  {/* Font Family */}
                  <div>
                    <label className="text-sm font-medium text-foreground mb-2 block">Fonte</label>
                    <ToggleGroup
                      type="single"
                      value={preferences.fontFamily}
                      onValueChange={(v) => v && setPreferences(prev => ({ ...prev, fontFamily: v as FontFamily }))}
                      className="justify-start flex-wrap"
                    >
                      <ToggleGroupItem value="serif" aria-label="Serif" className="data-[state=on]:bg-accent">
                        Serif
                      </ToggleGroupItem>
                      <ToggleGroupItem value="sans" aria-label="Sans-serif" className="data-[state=on]:bg-accent">
                        Sans
                      </ToggleGroupItem>
                      <ToggleGroupItem value="dyslexic" aria-label="Dyslexic" className="data-[state=on]:bg-accent text-xs">
                        Dyslexic
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </div>

                  {/* Line Height */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium text-foreground">Espaçamento</label>
                      <span className="text-xs text-muted-foreground">{preferences.lineHeight.toFixed(1)}</span>
                    </div>
                    <Slider
                      value={[preferences.lineHeight]}
                      onValueChange={([value]) => setPreferences(prev => ({ ...prev, lineHeight: value }))}
                      min={1.4}
                      max={2.0}
                      step={0.1}
                      className="w-full"
                    />
                  </div>

                  {/* Theme */}
                  <div>
                    <label className="text-sm font-medium text-foreground mb-2 block">Tema</label>
                    <ToggleGroup
                      type="single"
                      value={preferences.theme}
                      onValueChange={(v) => v && setPreferences(prev => ({ ...prev, theme: v as ThemeMode }))}
                      className="justify-start flex-wrap"
                    >
                      <ToggleGroupItem value="system" aria-label="Sistema" className="data-[state=on]:bg-accent">
                        <Monitor className="h-4 w-4 mr-1" />
                        Sistema
                      </ToggleGroupItem>
                      <ToggleGroupItem value="light" aria-label="Claro" className="data-[state=on]:bg-accent">
                        <Sun className="h-4 w-4 mr-1" />
                        Claro
                      </ToggleGroupItem>
                      <ToggleGroupItem value="dark" aria-label="Escuro" className="data-[state=on]:bg-accent">
                        <Moon className="h-4 w-4 mr-1" />
                        Escuro
                      </ToggleGroupItem>
                      <ToggleGroupItem value="sepia" aria-label="Sépia" className="data-[state=on]:bg-accent">
                        Sépia
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </div>

                  {/* Content Width */}
                  <div>
                    <label className="text-sm font-medium text-foreground mb-2 block">Largura do Conteúdo</label>
                    <ToggleGroup
                      type="single"
                      value={preferences.contentWidth}
                      onValueChange={(v) => v && setPreferences(prev => ({ ...prev, contentWidth: v as ContentWidth }))}
                      className="justify-start flex-wrap"
                    >
                      <ToggleGroupItem value="narrow" aria-label="Estreito" className="data-[state=on]:bg-accent text-xs">
                        Estreito
                      </ToggleGroupItem>
                      <ToggleGroupItem value="medium" aria-label="Médio" className="data-[state=on]:bg-accent text-xs">
                        Médio
                      </ToggleGroupItem>
                      <ToggleGroupItem value="wide" aria-label="Largo" className="data-[state=on]:bg-accent text-xs">
                        Largo
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </div>

                  {/* Layout Mode */}
                  <div className="pt-3 border-t border-border">
                    <label className="text-sm font-medium text-foreground mb-2 block">Modo de Layout</label>
                    <ToggleGroup type="single" value={layoutMode} onValueChange={(v) => v && setLayoutMode(v as LayoutMode)}>
                      <ToggleGroupItem value="auto" aria-label="Layout automático" title="Automático" className="data-[state=on]:bg-accent">
                        <Settings className="h-4 w-4 mr-2" />
                        Auto
                      </ToggleGroupItem>
                      <ToggleGroupItem value="single" aria-label="Página única" title="Página Única" className="data-[state=on]:bg-accent">
                        <BookOpen className="h-4 w-4 mr-2" />
                        1 Pág
                      </ToggleGroupItem>
                      <ToggleGroupItem value="double" aria-label="Duas páginas" title="Duas Páginas" className="data-[state=on]:bg-accent">
                        <BookOpenCheck className="h-4 w-4 mr-2" />
                        2 Pág
                      </ToggleGroupItem>
                    </ToggleGroup>
                    <p className="text-xs text-muted-foreground mt-2">
                      {layoutMode === "auto" && containerWidth >= 900 && "Modo atual: duas páginas"}
                      {layoutMode === "auto" && containerWidth < 900 && "Modo atual: página única"}
                      {layoutMode === "single" && "Modo atual: sempre página única"}
                      {layoutMode === "double" && "Modo atual: sempre duas páginas"}
                    </p>
                  </div>
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
          onClick={() => {
            renditionRef.current?.prev();
            setTimeout(() => document.body.focus(), 100);
          }}
          variant="ghost"
          size="icon"
          className="absolute left-0 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full bg-background/80 hover:bg-accent text-muted-foreground hover:text-foreground shadow-lg backdrop-blur-sm z-50 hidden lg:flex"
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
          onClick={() => {
            renditionRef.current?.next();
            setTimeout(() => document.body.focus(), 100);
          }}
          variant="ghost"
          size="icon"
          className="absolute right-0 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full bg-background/80 hover:bg-accent text-muted-foreground hover:text-foreground shadow-lg backdrop-blur-sm z-50 hidden lg:flex"
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
