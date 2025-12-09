import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useParams } from "react-router-dom";
import { BackLink } from "@/components/app/BackLink";
import { Button } from "@/components/ui/button";
import { SEO } from "@/components/app/SEO";
import { EpubView } from "react-reader";
import type { Rendition, Contents, NavItem } from "epubjs";
import { BOOKS } from "@/lib/books";
import { resolveEpubSource } from "@/lib/utils";
import { getDailyBaseline, setDailyBaseline, setProgress, getReadingPlan } from "@/lib/storage";
import { updateDailyProgressWidget } from "@/main";
import { WidgetUpdater, canUseNative } from "@/lib/widgetUpdater";
import { format } from "date-fns";
import { computeDaysRemaining, computeDailyProgressPercent } from "@/lib/reading";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Settings, BookOpen, BookOpenCheck, Maximize, Minimize, List } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { getUserEpubBlob } from "@/lib/userEpubs";
import { dataLayer } from "@/services/data/RxDBDataLayer";
import { Slider } from "@/components/ui/slider";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

type LayoutMode = "auto" | "single" | "double";
type FontFamily = "serif" | "sans" | "dyslexic";
type ThemeMode = "system" | "light" | "dark" | "sepia";
type ContentWidth = "narrow" | "medium" | "wide";

const THEME_PALETTES: Record<'light' | 'dark' | 'sepia', { background: string; text: string; link: string; }> = {
  light: { background: '#fdfcf7', text: '#111111', link: '#1d4ed8' },
  dark: { background: '#0a0a0a', text: '#f5f5f5', link: '#60a5fa' },
  sepia: { background: '#f4ecd8', text: '#5c4a3a', link: '#8b6914' },
};

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

// Debounce helper
function debounce<T extends (...args: any[]) => void>(fn: T, delay: number): T & { cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const debounced = (...args: Parameters<T>) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
  debounced.cancel = () => {
    if (timeoutId) clearTimeout(timeoutId);
  };
  return debounced as T & { cancel: () => void };
}

const EpubReaderV2 = () => {
  const { epubId = "" } = useParams();
  const { toast } = useToast();
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const settingsPanelRef = useRef<HTMLDivElement | null>(null);
  const settingsOpenRef = useRef<boolean>(false);
  
  // Controlled location state - this is the key to preventing spurious saves
  const [location, setLocation] = useState<string | null>(null);
  const [epubUrl, setEpubUrl] = useState<string | ArrayBuffer | null>(null);
  const [toc, setToc] = useState<NavItem[]>([]);
  const [tocOpen, setTocOpen] = useState(false);
  
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

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
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
        setTimeout(() => document.body.focus(), 100);
        break;
      case 'ArrowRight':
      case 'PageDown':
      case ' ':
        e.preventDefault();
        rendition.next();
        setTimeout(() => document.body.focus(), 100);
        break;
    }
  }, []);

  // Reading preferences state
  const [renditionReady, setRenditionReady] = useState<boolean>(false);

  const [preferences, setPreferences] = useState<ReadingPreferences>(() => {
    try {
      const globalRaw = localStorage.getItem("epubReadingPreferences");
      return globalRaw ? { ...DEFAULT_PREFERENCES, ...JSON.parse(globalRaw) } : DEFAULT_PREFERENCES;
    } catch {
      return DEFAULT_PREFERENCES;
    }
  });

  // Reload preferences when book changes
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

  // Load initial location from localStorage
  useEffect(() => {
    if (!epubId) return;
    try {
      const savedCfi = localStorage.getItem(`epubLoc:${epubId}`);
      console.log('[EpubReaderV2] Loading saved location:', savedCfi);
      if (savedCfi) {
        setLocation(savedCfi);
      }
    } catch { }
  }, [epubId]);

  // Load EPUB source
  useEffect(() => {
    if (!epubId) return;
    
    let cancelled = false;
    
    const load = async () => {
      try {
        const isUserUpload = epubId.startsWith('user-');
        
        if (isUserUpload) {
          const blob = await getUserEpubBlob(epubId);
          if (!blob) {
            throw new Error('User EPUB not found in storage');
          }
          const ab = await blob.arrayBuffer();
          if (!cancelled) setEpubUrl(ab);
        } else {
          const meta = BOOKS.find(b => b.id === epubId);
          const src = meta?.sourceUrl || `/epubs/${epubId}.epub`;
          const url = resolveEpubSource(src);
          
          // Try Cache Storage first
          let ab: ArrayBuffer | null = null;
          try {
            if ('caches' in window) {
              const cache = await caches.open('epub-cache-v1');
              const cached = await cache.match(url);
              if (cached && cached.ok) {
                ab = await cached.arrayBuffer();
              }
            }
          } catch { }
          
          if (!ab) {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            try {
              if ('caches' in window) {
                const cache = await caches.open('epub-cache-v1');
                await cache.put(url, resp.clone());
              }
            } catch { }
            ab = await resp.arrayBuffer();
          }
          
          if (!cancelled) setEpubUrl(ab);
        }
        
        try { localStorage.setItem('lastBookId', epubId); } catch { }
      } catch (e) {
        if (!cancelled) setErr("Falha ao carregar o EPUB.");
        console.error('[EpubReaderV2] Load error:', e);
      }
    };
    
    load();
    return () => { cancelled = true; };
  }, [epubId]);

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

  // Close settings when clicking outside panel
  useEffect(() => {
    if (!settingsOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const panel = settingsPanelRef.current;
      if (!panel) return;
      const target = event.target as Node | null;
      if (target && !panel.contains(target)) {
        setSettingsOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [settingsOpen]);

  useEffect(() => {
    settingsOpenRef.current = settingsOpen;
  }, [settingsOpen]);

  // Persist reading preferences
  useEffect(() => {
    try {
      localStorage.setItem("epubReadingPreferences", JSON.stringify(preferences));
      if (epubId) {
        localStorage.setItem(`epubReadingPreferences:${epubId}`, JSON.stringify(preferences));
      }
    } catch { }
  }, [preferences, epubId]);

  // Monitor container width
  useEffect(() => {
    const container = viewerRef.current;
    if (!container) return;

    let timeoutId: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver((entries) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        for (const entry of entries) {
          setContainerWidth(entry.contentRect.width);
        }
      }, 400);
    });

    observer.observe(container);
    setContainerWidth(container.clientWidth);

    return () => {
      clearTimeout(timeoutId);
      observer.disconnect();
    };
  }, []);

  // Compute effective spread mode
  const effectiveSpread = useMemo(() => {
    const threshold = 900;
    if (layoutMode === "single") return "none";
    if (layoutMode === "double") return "auto";
    return containerWidth >= threshold ? "auto" : "none";
  }, [layoutMode, containerWidth]);

  // Debounced save function to prevent rapid saves during initialization
  const saveProgress = useMemo(() => debounce((cfi: string, percent: number) => {
    if (!epubId || !cfi) return;
    
    const todayISO = format(new Date(), 'yyyy-MM-dd');
    
    console.log('[EpubReaderV2] Saving progress:', { epubId, cfi, percent });
    
    // Save to localStorage
    try { localStorage.setItem(`epubLoc:${epubId}`, cfi); } catch { }
    
    // Save to storage
    setProgress(epubId, { partIndex: 0, chapterIndex: 0, percent });
    
    // Sync with DataLayer
    (async () => {
      try {
        const userEpub = await dataLayer.getUserEpub(epubId);
        
        if (userEpub) {
          await dataLayer.saveUserEpub({
            ...userEpub,
            percentage: percent,
            last_location_cfi: cfi,
            _modified: Date.now()
          });
          console.log('[EpubReaderV2] Progress synced to user_epubs');
        } else {
          const book = await dataLayer.getBook(epubId);
          if (book) {
            await dataLayer.saveBook({
              ...book,
              percentage: percent,
              last_location_cfi: cfi,
              _modified: Date.now()
            });
            console.log('[EpubReaderV2] Progress synced to books');
          } else {
            const staticBook = BOOKS.find(b => b.id === epubId);
            if (staticBook) {
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
    
    // Handle daily baseline and widget updates
    const base = getDailyBaseline(epubId, todayISO);
    const baselinePercent = base ? base.percent : percent;
    if (!base && percent > 0) {
      setDailyBaseline(epubId, todayISO, { words: 0, percent });
    }
    
    const plan = getReadingPlan(epubId);
    const daysRemaining = computeDaysRemaining(plan?.targetDateISO);
    const dailyTargetPercent = daysRemaining ? Math.ceil(Math.max(0, 100 - baselinePercent) / daysRemaining) : null;
    const achievedPercentToday = Math.max(0, percent - baselinePercent);
    const dailyProgressPercent = computeDailyProgressPercent(achievedPercentToday, dailyTargetPercent) ?? 0;
    
    (async () => {
      try {
        if (canUseNative()) {
          const hasGoal = dailyTargetPercent != null && dailyTargetPercent > 0;
          await updateDailyProgressWidget(dailyProgressPercent, hasGoal);
          await WidgetUpdater.update?.();
        }
      } catch { }
    })();
  }, 500), [epubId]);

  // Cleanup debounced save on unmount
  useEffect(() => {
    return () => saveProgress.cancel();
  }, [saveProgress]);

  // Handle location change from react-reader
  const handleLocationChanged = useCallback((newLocation: string) => {
    console.log('[EpubReaderV2] locationChanged:', newLocation);
    
    // Update controlled state
    setLocation(newLocation);
    
    // Get progress percentage from rendition
    const rendition = renditionRef.current;
    if (!rendition) return;
    
    try {
      const currentLoc = rendition.currentLocation() as any;
      let percent = 0;
      let totalPages = 1;
      
      // Try locations API first
      const book = (rendition as any).book;
      if (book?.locations?.length?.()) {
        const p = book.locations.percentageFromCfi(newLocation);
        if (typeof p === "number" && !isNaN(p)) {
          percent = Math.round(p * 100);
        }
        totalPages = book.locations.length();
      }
      
      // Fallback to displayed percentage
      if (!percent && currentLoc?.start?.displayed?.percentage) {
        percent = Math.round(currentLoc.start.displayed.percentage * 100);
      }
      
      const currentPage = Math.max(1, Math.round((percent / 100) * totalPages));
      setReadingProgress({
        percentage: percent,
        currentPage,
        totalPages: Math.max(totalPages, 1),
      });
      
      // Debounced save
      saveProgress(newLocation, percent);
    } catch (err) {
      console.warn('[EpubReaderV2] Error getting progress:', err);
    }
  }, [saveProgress]);

  // Resolve theme
  const resolveTheme = useCallback((theme: ThemeMode): 'light' | 'dark' | 'sepia' => {
    if (theme === 'system') {
      const isDark = document.documentElement.classList.contains('dark') || 
                    window.matchMedia?.('(prefers-color-scheme: dark)')?.matches;
      return isDark ? 'dark' : 'light';
    }
    return theme as 'light' | 'dark' | 'sepia';
  }, []);

  // Get rendition callback - apply themes and preferences
  const handleGetRendition = useCallback((rendition: Rendition) => {
    renditionRef.current = rendition;
    console.log('[EpubReaderV2] Got rendition');
    
    const themes = (rendition as any).themes;
    if (!themes) return;
    
    // Register themes
    themes.register('light', {
      'html, body': {
        background: THEME_PALETTES.light.background + ' !important',
        color: THEME_PALETTES.light.text + ' !important',
      },
      'a, a:visited': { color: THEME_PALETTES.light.link + ' !important' },
      'p, div, span, li': { color: THEME_PALETTES.light.text + ' !important' },
    });
    themes.register('dark', {
      'html, body': {
        background: THEME_PALETTES.dark.background + ' !important',
        color: THEME_PALETTES.dark.text + ' !important',
      },
      'a, a:visited': { color: THEME_PALETTES.dark.link + ' !important' },
      'p, div, span, li': { color: THEME_PALETTES.dark.text + ' !important' },
      'img': { filter: 'none' },
    });
    themes.register('sepia', {
      'html, body': {
        background: THEME_PALETTES.sepia.background + ' !important',
        color: THEME_PALETTES.sepia.text + ' !important',
      },
      'a, a:visited': { color: THEME_PALETTES.sepia.link + ' !important' },
      'p, div, span, li': { color: THEME_PALETTES.sepia.text + ' !important' },
    });
    
    // Apply preferences
    const selectedTheme = resolveTheme(preferences.theme);
    themes.fontSize(`${preferences.fontSize}%`);
    
    const fontFamilyMap: Record<FontFamily, string> = {
      serif: "Georgia, 'Times New Roman', serif",
      sans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      dyslexic: "'OpenDyslexic', sans-serif",
    };
    themes.font(fontFamilyMap[preferences.fontFamily]);
    
    const widthMap: Record<ContentWidth, string> = {
      narrow: "60%",
      medium: "80%",
      wide: "95%",
    };
    themes.override("line-height", preferences.lineHeight.toString());
    themes.override("max-width", widthMap[preferences.contentWidth]);
    themes.override("margin", "0 auto");
    themes.select(selectedTheme);
    
    // Update container background
    const container = viewerRef.current;
    if (container) {
      container.style.background = THEME_PALETTES[selectedTheme].background;
    }
    
    // Generate locations for progress tracking
    const book = (rendition as any).book;
    if (book) {
      book.ready.then(() => {
        // Get TOC
        if (book.navigation?.toc) {
          setToc(book.navigation.toc);
        }
        
        // Generate locations
        setTimeout(() => {
          try {
            console.log('[EpubReaderV2] Generating locations...');
            book.locations.generate(500).then(() => {
              console.log('[EpubReaderV2] Locations generated');
            });
          } catch { }
        }, 1000);
      });
    }
    
    setRenditionReady(true);
    
    // Attach gestures to each rendered section
    rendition.on('rendered', (_section: any, contents: Contents) => {
      attachGestures(contents);
    });
  }, [epubId, preferences, resolveTheme]);

  // Attach touch gestures and click events
  const attachGestures = useCallback((contents: Contents) => {
    try {
      const doc = contents?.document as Document | undefined;
      if (!doc) return;
      
      let startX = 0, startY = 0, startT = 0;
      const threshold = 50;
      const restraintY = 40;
      const maxTime = 800;

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
          if (dx < 0) renditionRef.current?.next();
          else renditionRef.current?.prev();
        }
      };

      const onClick = () => {
        if (settingsOpenRef.current) {
          setSettingsOpen(false);
        }
        if (window.innerWidth < 1024) {
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

      const onKeyDown = handleKeyDown as any;

      doc.addEventListener('touchstart', onTouchStart, { passive: true });
      doc.addEventListener('touchend', onTouchEnd, { passive: true });
      doc.addEventListener('click', onClick);
      doc.addEventListener('keydown', onKeyDown);
      (contents as any)?.window?.addEventListener('keydown', onKeyDown);
    } catch { }
  }, [handleKeyDown, toast]);

  // Apply preferences when they change
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition || !renditionReady) return;

    const themes = (rendition as any).themes;
    if (!themes) return;

    const selectedTheme = resolveTheme(preferences.theme);
    themes.fontSize(`${preferences.fontSize}%`);
    
    const fontFamilyMap: Record<FontFamily, string> = {
      serif: "Georgia, 'Times New Roman', serif",
      sans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      dyslexic: "'OpenDyslexic', sans-serif",
    };
    themes.font(fontFamilyMap[preferences.fontFamily]);
    
    const widthMap: Record<ContentWidth, string> = {
      narrow: "60%",
      medium: "80%",
      wide: "95%",
    };
    themes.override("line-height", preferences.lineHeight.toString());
    themes.override("max-width", widthMap[preferences.contentWidth]);
    themes.override("margin", "0 auto");
    themes.select(selectedTheme);
    
    const container = viewerRef.current;
    if (container) {
      container.style.background = THEME_PALETTES[selectedTheme].background;
    }
  }, [preferences, renditionReady, resolveTheme]);

  // Watch for system theme changes
  useEffect(() => {
    if (preferences.theme !== 'system') return;

    const target = document.documentElement;
    let mo: MutationObserver | null = null;
    
    const reapplyPreferences = () => {
      setPreferences(prev => ({ ...prev }));
    };

    try {
      mo = new MutationObserver(reapplyPreferences);
      mo.observe(target, { attributes: true, attributeFilter: ['class'] });
    } catch { }
    
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    try { mq?.addEventListener?.('change', reapplyPreferences); } catch { }
    
    return () => {
      try { mo?.disconnect(); } catch { }
      try { mq?.removeEventListener?.('change', reapplyPreferences); } catch { }
    };
  }, [preferences.theme]);

  // Keyboard shortcuts
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Sync menu state with fullscreen changes
  useEffect(() => {
    const onFullscreenChange = () => {
      const isFull = !!document.fullscreenElement;
      setIsFullscreen(isFull);
      if (!isFull) {
        setShowMobileMenu(true);
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const fullscreenOuterShell = isFullscreen
    ? "relative w-full"
    : "relative w-full lg:bg-gradient-to-b lg:from-muted lg:to-background lg:rounded-2xl lg:p-6 lg:shadow-2xl";

  const fullscreenInnerShell = isFullscreen
    ? "relative bg-card h-[100dvh]"
    : "relative bg-card lg:rounded-lg lg:shadow-[0_0_60px_rgba(0,0,0,0.1)] h-screen lg:h-[85vh]";

  // Navigate to TOC item
  const handleTocClick = useCallback((href: string) => {
    setLocation(href);
    setTocOpen(false);
  }, []);

  return (
    <main className={`min-h-[100dvh] w-full bg-background flex flex-col items-center justify-center ${isFullscreen ? '' : 'lg:py-2 lg:px-2'}`}>
      <SEO title={`EPUB — ${epubId}`} description="Leitor EPUB" canonical={`/epub/${epubId}`} />

      {/* Header */}
      <div
        className={`
          w-full max-w-7xl lg:mb-2 flex items-center justify-between
          transition-all duration-300 fixed top-0 left-0 right-0 px-2 py-1.5 z-50 bg-white/90 backdrop-blur lg:static lg:bg-transparent lg:p-0
          lg:opacity-100 lg:translate-y-0
          ${showMobileMenu ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-full pointer-events-none'}
          ${isFullscreen ? 'hidden' : ''}
        `}
      >
        <nav className={`text-sm lg:block transition-opacity duration-300 ${isFullscreen ? 'lg:opacity-0 lg:pointer-events-none' : 'lg:opacity-100'}`}>
          <BackLink to="/biblioteca" label="Biblioteca" className="text-foreground lg:text-muted-foreground hover:text-primary lg:hover:text-foreground" />
        </nav>

        <div className="flex items-center gap-2">
          {/* TOC Button */}
          <Sheet open={tocOpen} onOpenChange={setTocOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9 text-foreground lg:text-muted-foreground hover:text-primary lg:hover:text-foreground lg:hover:bg-accent">
                <List className="h-4 w-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[300px] sm:w-[400px]">
              <SheetHeader>
                <SheetTitle>Índice</SheetTitle>
              </SheetHeader>
              <div className="mt-4 space-y-1 max-h-[80vh] overflow-y-auto">
                {toc.map((item, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleTocClick(item.href)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-accent rounded-md transition-colors"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </SheetContent>
          </Sheet>

          {/* Settings Panel */}
          <div className={`transition-opacity duration-300 ${isFullscreen ? 'lg:opacity-0 lg:pointer-events-none' : 'lg:opacity-100'}`}>
            <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9 text-foreground lg:text-muted-foreground hover:text-primary lg:hover:text-foreground lg:hover:bg-accent">
                  <Settings className="h-4 w-4" />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="absolute right-4 top-16 z-50 max-h-[calc(100vh-8rem)] overflow-y-auto">
                <div ref={settingsPanelRef} className="bg-popover border border-border rounded-lg p-4 shadow-xl min-w-[280px] lg:min-w-[320px] space-y-4">
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
                      <ToggleGroupItem value="system" aria-label="Sistema" className="data-[state=on]:bg-accent text-xs">
                        Sistema
                      </ToggleGroupItem>
                      <ToggleGroupItem value="light" aria-label="Claro" className="data-[state=on]:bg-accent">
                        Claro
                      </ToggleGroupItem>
                      <ToggleGroupItem value="dark" aria-label="Escuro" className="data-[state=on]:bg-accent">
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
            className="hidden lg:flex h-9 w-9 text-muted-foreground hover:text-foreground hover:bg-accent"
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

        {/* Book Pages */}
        <div className={fullscreenOuterShell}>
          <div
            ref={viewerRef}
            className={`${fullscreenInnerShell} overflow-hidden`}
            onClick={() => {
              if (window.innerWidth < 1024) {
                if (showMobileMenu) {
                  setShowMobileMenu(false);
                  document.documentElement.requestFullscreen().catch(() => { });
                  toast({
                    description: "Toque na tela para sair do modo 'Tela cheia' e arraste para os lados para mudar de página",
                    duration: 4000,
                  });
                } else {
                  setShowMobileMenu(true);
                  if (document.fullscreenElement) {
                    document.exitFullscreen().catch(() => { });
                  }
                }
              }
            }}
          >
            {/* react-reader EpubView */}
            {epubUrl && (
              <EpubView
                url={epubUrl}
                location={location ?? undefined}
                locationChanged={handleLocationChanged}
                getRendition={handleGetRendition}
                epubOptions={{
                  spread: effectiveSpread as any,
                }}
              />
            )}

            {/* Center Shadow (Book Fold Effect) */}
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

export default EpubReaderV2;
