import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ReactReader } from "react-reader";
import type { NavItem, Rendition } from "epubjs";
import { BOOKS } from "@/lib/books";
import { resolveEpubSource } from "@/lib/utils";
import { getUserEpubBlob } from "@/lib/userEpubs";
import { SEO } from "@/components/app/SEO";
import { getDailyBaseline, setDailyBaseline, setProgress, getReadingPlan, getProgress } from "@/lib/storage";
import { updateDailyProgressWidget } from "@/main";
import { WidgetUpdater, canUseNative } from "@/lib/widgetUpdater";
import { format } from "date-fns";
import { computeDaysRemaining, computeDailyProgressPercent } from "@/lib/reading";
import { dataLayer } from "@/services/data/RxDBDataLayer";
import { calculatePercent } from "@/lib/percentageUtils";
import { ChevronLeft } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";

/**
 * EpubReaderV3 - Versão minimalista baseada na documentação oficial do react-reader
 * 
 * Segue o padrão do exemplo Persist.tsx:
 * https://github.com/gerhardsletten/react-reader/blob/main/src/examples/Persist.tsx
 */

const EpubReaderV3 = () => {
  const { epubId = "" } = useParams();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  // URL do EPUB (pode ser string URL ou ArrayBuffer)
  const [epubUrl, setEpubUrl] = useState<string | ArrayBuffer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Controlado pelo react-reader - estado da localização (CFI)
  const [location, setLocation] = useState<string | number>(0);

  // Referência para o rendition (para calcular progresso)
  const renditionRef = useRef<Rendition | null>(null);

  // Refs para controle de debounce e flush
  const latestCfiRef = useRef<string | null>(null);
  const latestPercentRef = useRef<number>(0);
  const lastSavedCfiRef = useRef<string | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const locationsReadyRef = useRef<boolean>(false);
  const initialPercentRef = useRef<number>(0); // Store initial percent from DB to avoid overwriting with 0

  // Função core de salvamento (estável, não recriada)
  const saveToRxDB = useCallback(async (cfi: string, percent: number) => {
    if (!epubId) return;

    // Don't save 0% if locations aren't ready yet - would overwrite valid progress
    if (percent === 0 && !locationsReadyRef.current) {
      console.log("[EpubReaderV3] Skipping save: percent is 0 and locations not ready");
      return;
    }

    // Atualiza tracking do último salvo
    lastSavedCfiRef.current = cfi;

    console.log("[EpubReaderV3] Persisting to DB:", { cfi, percent });
    const todayISO = format(new Date(), 'yyyy-MM-dd');

    // Get OLD percentage BEFORE updating (needed for baseline creation)
    let oldPercentage = 0;
    try {
      const userEpub = await dataLayer.getUserEpub(epubId);
      if (userEpub) {
        oldPercentage = userEpub.percentage || 0;
      } else {
        const book = await dataLayer.getBook(epubId);
        if (book) {
          oldPercentage = book.percentage || 0;
        }
      }
    } catch (error) {
      console.warn("[EpubReaderV3] Failed to get old percentage:", error);
    }

    // Ensure baseline exists for today BEFORE updating progress
    // (only create if missing, don't update existing)
    const base = getDailyBaseline(epubId, todayISO);
    if (!base && oldPercentage > 0) {
      // Create baseline with the OLD progress (before this update) as starting point
      // This ensures that today's progress is calculated correctly
      await setDailyBaseline(epubId, todayISO, { words: 0, percent: oldPercentage });
      console.log('[EpubReaderV3] 📏 Baseline created for today:', { epubId, todayISO, percent: oldPercentage });
    }

    // Sincronizar com DataLayer (RxDB/Supabase)
    try {
      const userEpub = await dataLayer.getUserEpub(epubId);

      if (userEpub) {
        await dataLayer.saveUserEpub({
          ...userEpub,
          percentage: percent,
          last_location_cfi: cfi,
          _modified: Date.now()
        });
      } else {
        const book = await dataLayer.getBook(epubId);
        if (book) {
          await dataLayer.saveBook({
            ...book,
            percentage: percent,
            last_location_cfi: cfi,
            _modified: Date.now()
          });
        } else {
          // Criar entrada para livro estático
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
      console.log("[EpubReaderV3] DB Persistence complete");
    } catch (error) {
      console.error("[EpubReaderV3] DB Persistence error:", error);
    }

    // Atualizar baseline e widgets (operações "leves")
    const updatedBase = getDailyBaseline(epubId, todayISO);
    const baselinePercent = updatedBase ? updatedBase.percent : oldPercentage;

    const plan = getReadingPlan(epubId);
    if (plan) { // Calc apenas se tiver plano
      const daysRemaining = computeDaysRemaining(plan.targetDateISO);
      const dailyTargetPercent = daysRemaining ? Math.ceil(Math.max(0, 100 - baselinePercent) / daysRemaining) : null;
      const achievedPercentToday = Math.max(0, percent - baselinePercent);
      const dailyProgressPercent = computeDailyProgressPercent(achievedPercentToday, dailyTargetPercent) ?? 0;

      if (canUseNative()) {
        try {
          const hasGoal = dailyTargetPercent != null && dailyTargetPercent > 0;
          updateDailyProgressWidget(dailyProgressPercent, hasGoal);
          WidgetUpdater.update?.();
        } catch { }
      }
    }
  }, [epubId]);

  // Função agendadora (debounce)
  const scheduleSave = useCallback((cfi: string, percent: number) => {
    latestCfiRef.current = cfi;
    latestPercentRef.current = percent;

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Aguarda 1s de inatividade para salvar
    timeoutRef.current = setTimeout(() => {
      saveToRxDB(cfi, percent);
    }, 1000);
  }, [saveToRxDB]);

  // Cleanup effect: Salva imediatamente se houver pendências ao desmontar
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      const latest = latestCfiRef.current;
      const saved = lastSavedCfiRef.current;

      if (latest && latest !== saved) {
        console.log("[EpubReaderV3] Unmount detected with pending changes. Flushing save...", latest);
        const percent = latestPercentRef.current;
        // Chama saveToRxDB diretamente (sem await pois é cleanup)
        saveToRxDB(latest, percent);
      }
    };
  }, [saveToRxDB]);

  // Callback quando a localização muda
  const handleLocationChanged = useCallback((newLocation: string) => {
    setLocation(newLocation);

    // Salvar sincrono no LocalStorage (Hot Cache) com Timestamp
    try {
      const state = { cfi: newLocation, timestamp: Date.now() };
      localStorage.setItem(`epubLoc:${epubId}`, JSON.stringify(state));
    } catch (e) { console.error('LocalStorage write failed', e); }

    // Calcular porcentagem de progresso
    const rendition = renditionRef.current;
    if (rendition) {
      try {
        const currentLoc = rendition.currentLocation() as any;
        let percent = 0;

        // Usar displayed.percentage como fallback
        if (currentLoc?.start?.displayed?.percentage) {
          percent = calculatePercent(currentLoc.start.displayed.percentage, 1, { round: false });
        }

        // Tentar usar locations se disponível
        const book = (rendition as any).book;
        if (book?.locations?.length?.()) {
          const p = book.locations.percentageFromCfi(newLocation);
          if (typeof p === "number" && !isNaN(p)) {
            percent = calculatePercent(p, 1, { round: false });
          }
        }

        // --- FIX: Update local progress storage for Library UI ---
        // Only update if we have a valid percentage or if locations are confirmed ready (meaning 0% is real)
        if (percent > 0 || locationsReadyRef.current) {
          try {
            // Get existing progress to preserve chapter/part indexes if they exist
            const currentProgress = getProgress(epubId);
            setProgress(epubId, {
              ...currentProgress,
              percent: percent
            });
          } catch (e) { console.warn("[EpubReaderV3] Failed to update local progress:", e); }
        }
        // -------------------------------------------------------

        // Agendar salvamento DB
        scheduleSave(newLocation, percent);
      } catch (err) {
        console.warn("[EpubReaderV3] Error calculating progress:", err);
      }
    }
  }, [epubId, scheduleSave]);

  // Callback para obter acesso ao rendition
  const handleGetRendition = useCallback((rendition: Rendition) => {
    renditionRef.current = rendition;
    console.log("[EpubReaderV3] Got rendition");

    // Gerar locations para cálculo de porcentagem preciso
    const book = (rendition as any).book;
    if (book) {
      book.ready.then(() => {
        setTimeout(() => {
          try {
            console.log("[EpubReaderV3] Generating locations...");
            book.locations.generate(500).then(() => {
              console.log("[EpubReaderV3] Locations generated");
              locationsReadyRef.current = true;

              // Now that locations are ready, recalculate and save the correct percentage
              const rendition = renditionRef.current;
              if (rendition && latestCfiRef.current) {
                try {
                  const p = book.locations.percentageFromCfi(latestCfiRef.current);
                  if (typeof p === "number" && !isNaN(p)) {
                    const percent = calculatePercent(p, 1, { round: false });
                    console.log("[EpubReaderV3] Recalculated percent after locations ready:", percent);

                    // FIX: Update local progress storage with accurate percent
                    try {
                      const currentProgress = getProgress(epubId);
                      setProgress(epubId, {
                        ...currentProgress,
                        percent: percent
                      });
                    } catch (e) {
                      console.warn("[EpubReaderV3] Failed to update local progress after recalc:", e);
                    }

                    // Only save if we have a meaningful percent or user has navigated
                    if (percent > 0 || latestCfiRef.current !== lastSavedCfiRef.current) {
                      saveToRxDB(latestCfiRef.current, percent);
                    }
                  }
                } catch { }
              }
            });
          } catch { }
        }, 1000);
      });
    }
  }, [saveToRxDB]);

  // Carregar EPUB e Progresso em Paralelo (HYBRID STRATEGY)
  useEffect(() => {
    if (!epubId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    const load = async () => {
      try {
        console.log("[EpubReaderV3] Loading content and progress...");

        // 1. Loader do Conteúdo
        const contentPromise = (async () => {
          const isUserUpload = epubId.startsWith("user-");
          if (isUserUpload) {
            const blob = await getUserEpubBlob(epubId);
            if (!blob) throw new Error("EPUB não encontrado");
            return await blob.arrayBuffer();
          } else {
            const meta = BOOKS.find(b => b.id === epubId);
            const src = meta?.sourceUrl || `/epubs/${epubId}.epub`;
            return resolveEpubSource(src);
          }
        })();

        // 2. Load Local State (Hot Cache)
        const getLocalState = (id: string) => {
          try {
            const raw = localStorage.getItem(`epubLoc:${id}`);
            if (!raw) return null;
            if (raw.startsWith('{')) return JSON.parse(raw) as { cfi: string; timestamp: number };
            return { cfi: raw, timestamp: 0 };
          } catch { return null; }
        };
        const localState = getLocalState(epubId);

        // 3. Loader do Progresso Remoto (RxDB)
        const remotePromise = (async () => {
          try {
            // Tentar user_epubs primeiro
            const userEpub = await dataLayer.getUserEpub(epubId);
            if (userEpub?.last_location_cfi) {
              return { cfi: userEpub.last_location_cfi, ts: new Date(userEpub._modified).getTime() };
            }
            // Tentar books depois (para livros estáticos)
            const book = await dataLayer.getBook(epubId);
            if (book?.last_location_cfi) {
              return { cfi: book.last_location_cfi, ts: new Date(book._modified).getTime() };
            }
          } catch (e) {
            console.warn("[EpubReaderV3] Error fetching progress from RxDB:", e);
          }
          return null;
        })();

        const [content, remoteState] = await Promise.all([contentPromise, remotePromise]);

        if (!cancelled) {
          setEpubUrl(content);

          // RECONCILIAÇÃO: Quem ganha?
          let finalCfi: string | number = 0;

          if (localState && remoteState) {
            // Ambos existem: compara timestamps (Local vence se for mais novo)
            if (localState.timestamp > remoteState.ts) {
              console.log("[EpubReaderV3] Conflict: Local is newer. Using Local.", { local: localState.timestamp, remote: remoteState.ts });
              finalCfi = localState.cfi;
            } else {
              console.log("[EpubReaderV3] Conflict: Remote is newer/equal. Using Remote.", { local: localState.timestamp, remote: remoteState.ts });
              finalCfi = remoteState.cfi;
              // Atualiza local para ficar sync
              try { localStorage.setItem(`epubLoc:${epubId}`, JSON.stringify({ cfi: finalCfi, timestamp: remoteState.ts })); } catch { }
            }
          } else if (localState) {
            console.log("[EpubReaderV3] Only Local exists. Using Local.");
            finalCfi = localState.cfi;
          } else if (remoteState) {
            console.log("[EpubReaderV3] Only Remote exists. Using Remote.");
            finalCfi = remoteState.cfi;
            // Cacheia localmente
            try { localStorage.setItem(`epubLoc:${epubId}`, JSON.stringify({ cfi: finalCfi, timestamp: remoteState.ts })); } catch { }
          } else {
            console.log("[EpubReaderV3] No saved state. Starting at beginning.");
            finalCfi = 0;
          }

          setLocation(finalCfi);
          setLoading(false);

          // Note: setLastBookId is called in the onClick handler that navigates here,
          // so we don't need to call it again here.

          console.log("[EpubReaderV3] Ready. Starting at:", finalCfi);
        }
      } catch (err) {
        console.error("[EpubReaderV3] Load error:", err);
        if (!cancelled) {
          setError("Falha ao carregar o EPUB");
          setLoading(false);
        }
      }
    };

    load();
    return () => { cancelled = true; };
  }, [epubId]);

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-red-500 mb-4">{error}</p>
          <button
            onClick={() => navigate("/biblioteca")}
            className="text-primary underline"
          >
            Voltar para Biblioteca
          </button>
        </div>
      </div>
    );
  }

  if (loading || !epubUrl) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Carregando...</p>
      </div>
    );
  }

  return (
    <div className="h-screen w-full relative">
      <SEO
        title={`EPUB — ${epubId}`}
        description="Leitor EPUB"
        canonical={`/epub/${epubId}`}
      />
      <ReactReader
        url={epubUrl}
        location={location}
        locationChanged={handleLocationChanged}
        getRendition={handleGetRendition}
        title=""
        showToc={true}
        swipeable={isMobile}
      />
      {/* Botão de voltar posicionado abaixo do botão de TOC */}
      <button
        onClick={() => navigate("/biblioteca")}
        className="absolute left-2.5 top-12 z-10 flex items-center justify-center w-8 h-8 rounded-full bg-white/90 hover:bg-white shadow-md transition-colors"
        aria-label="Voltar para Biblioteca"
        title="Voltar para Biblioteca"
      >
        <ChevronLeft className="w-5 h-5 text-gray-700" />
      </button>
    </div>
  );
};

export default EpubReaderV3;
