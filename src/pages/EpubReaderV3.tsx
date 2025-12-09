import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ReactReader } from "react-reader";
import type { NavItem, Rendition } from "epubjs";
import { BOOKS } from "@/lib/books";
import { resolveEpubSource } from "@/lib/utils";
import { getUserEpubBlob } from "@/lib/userEpubs";
import { SEO } from "@/components/app/SEO";
import { getDailyBaseline, setDailyBaseline, setProgress, getReadingPlan } from "@/lib/storage";
import { updateDailyProgressWidget } from "@/main";
import { WidgetUpdater, canUseNative } from "@/lib/widgetUpdater";
import { format } from "date-fns";
import { computeDaysRemaining, computeDailyProgressPercent } from "@/lib/reading";
import { dataLayer } from "@/services/data/RxDBDataLayer";

/**
 * EpubReaderV3 - Versão minimalista baseada na documentação oficial do react-reader
 * 
 * Segue o padrão do exemplo Persist.tsx:
 * https://github.com/gerhardsletten/react-reader/blob/main/src/examples/Persist.tsx
 */

// Chave para localStorage
const getLocationKey = (epubId: string) => `epubLoc:${epubId}`;

const EpubReaderV3 = () => {
  const { epubId = "" } = useParams();
  const navigate = useNavigate();
  
  // URL do EPUB (pode ser string URL ou ArrayBuffer)
  const [epubUrl, setEpubUrl] = useState<string | ArrayBuffer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Controlado pelo react-reader - estado da localização (CFI)
  // Inicializa do localStorage se existir
  const [location, setLocation] = useState<string | number>(() => {
    try {
      const saved = localStorage.getItem(getLocationKey(epubId));
      return saved || 0;
    } catch {
      return 0;
    }
  });

  // Referência para o rendition (para calcular progresso)
  const renditionRef = useRef<Rendition | null>(null);

  // Função para sincronizar progresso com DataLayer
  const syncProgress = useCallback(async (cfi: string, percent: number) => {
    if (!epubId) return;
    
    const todayISO = format(new Date(), 'yyyy-MM-dd');
    
    console.log("[EpubReaderV3] syncProgress called:", { cfi, percent });
    
    // Salvar no storage local
    setProgress(epubId, { partIndex: 0, chapterIndex: 0, percent });
    
    // Sincronizar com DataLayer (RxDB/Supabase)
    try {
      const userEpub = await dataLayer.getUserEpub(epubId);
      
      if (userEpub) {
        console.log("[EpubReaderV3] Saving to user_epubs:", { id: epubId, percent, cfi });
        await dataLayer.saveUserEpub({
          ...userEpub,
          percentage: percent,
          last_location_cfi: cfi,
          _modified: Date.now()
        });
        console.log("[EpubReaderV3] Progress synced to user_epubs:", { percent, cfi });
      } else {
        const book = await dataLayer.getBook(epubId);
        if (book) {
          console.log("[EpubReaderV3] Saving to books:", { id: epubId, percent, cfi });
          await dataLayer.saveBook({
            ...book,
            percentage: percent,
            last_location_cfi: cfi,
            _modified: Date.now()
          });
          console.log("[EpubReaderV3] Progress synced to books:", { percent, cfi });
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
            console.log("[EpubReaderV3] Created book entry:", staticBook.title);
          }
        }
      }
    } catch (error) {
      console.error("[EpubReaderV3] Error syncing progress:", error);
    }
    
    // Atualizar baseline diário
    const base = getDailyBaseline(epubId, todayISO);
    const baselinePercent = base ? base.percent : percent;
    if (!base && percent > 0) {
      setDailyBaseline(epubId, todayISO, { words: 0, percent });
    }
    
    // Calcular progresso diário e atualizar widget
    const plan = getReadingPlan(epubId);
    const daysRemaining = computeDaysRemaining(plan?.targetDateISO);
    const dailyTargetPercent = daysRemaining ? Math.ceil(Math.max(0, 100 - baselinePercent) / daysRemaining) : null;
    const achievedPercentToday = Math.max(0, percent - baselinePercent);
    const dailyProgressPercent = computeDailyProgressPercent(achievedPercentToday, dailyTargetPercent) ?? 0;
    
    // Atualizar widget nativo
    if (canUseNative()) {
      try {
        const hasGoal = dailyTargetPercent != null && dailyTargetPercent > 0;
        await updateDailyProgressWidget(dailyProgressPercent, hasGoal);
        await WidgetUpdater.update?.();
      } catch { }
    }
  }, [epubId]);

  // Callback quando a localização muda
  const handleLocationChanged = useCallback((newLocation: string) => {
    console.log("[EpubReaderV3] locationChanged:", newLocation);
    setLocation(newLocation);
    
    // Salvar no localStorage
    try {
      localStorage.setItem(getLocationKey(epubId), newLocation);
      console.log("[EpubReaderV3] Saved to localStorage");
    } catch (err) {
      console.error("[EpubReaderV3] Failed to save:", err);
    }
    
    // Calcular porcentagem de progresso
    const rendition = renditionRef.current;
    if (rendition) {
      try {
        const currentLoc = rendition.currentLocation() as any;
        let percent = 0;
        
        // Usar displayed.percentage como fallback
        if (currentLoc?.start?.displayed?.percentage) {
          percent = Math.round(currentLoc.start.displayed.percentage * 100);
        }
        
        // Tentar usar locations se disponível
        const book = (rendition as any).book;
        if (book?.locations?.length?.()) {
          const p = book.locations.percentageFromCfi(newLocation);
          if (typeof p === "number" && !isNaN(p)) {
            percent = Math.round(p * 100);
          }
        }
        
        // Sincronizar progresso
        syncProgress(newLocation, percent);
      } catch (err) {
        console.warn("[EpubReaderV3] Error calculating progress:", err);
      }
    }
  }, [epubId, syncProgress]);

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
            });
          } catch { }
        }, 1000);
      });
    }
  }, []);

  // Carregar EPUB
  useEffect(() => {
    if (!epubId) return;
    
    let cancelled = false;
    setLoading(true);
    setError(null);
    
    const load = async () => {
      try {
        const isUserUpload = epubId.startsWith("user-");
        
        if (isUserUpload) {
          // EPUB do usuário (IndexedDB)
          const blob = await getUserEpubBlob(epubId);
          if (!blob) throw new Error("EPUB não encontrado");
          const ab = await blob.arrayBuffer();
          if (!cancelled) setEpubUrl(ab);
        } else {
          // EPUB estático
          const meta = BOOKS.find(b => b.id === epubId);
          const src = meta?.sourceUrl || `/epubs/${epubId}.epub`;
          const url = resolveEpubSource(src);
          if (!cancelled) setEpubUrl(url);
        }
        
        if (!cancelled) setLoading(false);
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

  // Recarregar posição salva quando epubId muda
  useEffect(() => {
    try {
      const saved = localStorage.getItem(getLocationKey(epubId));
      if (saved) {
        console.log("[EpubReaderV3] Restoring location:", saved);
        setLocation(saved);
      } else {
        setLocation(0);
      }
    } catch {
      setLocation(0);
    }
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
    <div className="h-screen w-full">
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
      />
    </div>
  );
};

export default EpubReaderV3;
