import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { BackLink } from "@/components/app/BackLink";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/hooks/use-toast";
import confetti from "canvas-confetti";
import { getBookById } from "@/lib/books";
import { SEO } from "@/components/app/SEO";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { useTodayISO } from "@/hooks/use-today";
import { Capacitor } from "@capacitor/core";
import { updateDailyProgressWidget } from "@/main";
import { WidgetUpdater, canUseNative } from "@/lib/widgetUpdater";
import { useTheme } from "next-themes";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Sun, Moon, Monitor, AlignLeft, AlignJustify, Settings } from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import {
  addReadingMinutes,
  getProgress,
  getStreak,
  hasReadToday,
  markReadToday,
  setProgress,
  getReadingPlan,
  getDailyBaseline,
  setDailyBaseline,
  type Streak,
} from "@/lib/storage";
import {
  type Part,
  computeTotalWords,
  computeWordsUpToPosition,
  computeWordsUpToInclusiveTarget,
  computePlanProgressPercent,
  computeDaysRemaining,
  computeDailyTargetWords,
  computeAchievedWordsToday,
  computeDailyProgressPercent,
  countWordsInChapter,
} from "@/lib/reading";

// Types now shared via lib/reading

const Reader = () => {
  const { bookId = "" } = useParams();
  const meta = getBookById(bookId);
  const [parts, setParts] = useState<Part[] | null>(null);
  const [fontSize, setFontSize] = useState<number>(18);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [p, setP] = useState(() => getProgress(bookId));
  const [streak, setStreak] = useState<Streak>(() => getStreak());
  const startRef = useRef<number | null>(null);
  const { theme, setTheme } = useTheme();
  const [lineSpacing, setLineSpacing] = useState<"compact" | "normal" | "relaxed">(() => {
    try {
      return (localStorage.getItem("lineSpacing") as any) || "compact";
    } catch {
      return "compact";
    }
  });
  const [textAlign, setTextAlign] = useState<"left" | "justify">(() => {
    try {
      return (localStorage.getItem("textAlign") as "left" | "justify") || "justify";
    } catch {
      return "justify";
    }
  });
  useEffect(() => {
    try { localStorage.setItem("textAlign", textAlign); } catch {}
  }, [textAlign]);
  useEffect(() => {
    try { localStorage.setItem("lineSpacing", lineSpacing); } catch {}
  }, [lineSpacing]);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem("readerSettingsOpen");
      return raw ? JSON.parse(raw) : false;
    } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("readerSettingsOpen", JSON.stringify(settingsOpen)); } catch {}
  }, [settingsOpen]);

  useEffect(() => {
    if (!meta) return;
    const cacheKey = `book:${meta.id}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        setParts(JSON.parse(cached));
        return;
      } catch {}
    }
    setLoading(true);
    fetch(meta.sourceUrl)
      .then((r) => r.json())
      .then((json) => {
        localStorage.setItem(cacheKey, JSON.stringify(json));
        setParts(json as Part[]);
      })
      .catch(() => setErr("Falha ao carregar o livro. Tente novamente."))
      .finally(() => setLoading(false));
  }, [meta]);

  // Remember last opened book for quick resume from Hero CTA
  useEffect(() => {
    if (bookId) {
      try { localStorage.setItem('lastBookId', bookId); } catch {}
    }
  }, [bookId]);

  // Track reading time
  useEffect(() => {
    startRef.current = Date.now();
    return () => {
      if (startRef.current) addReadingMinutes(Date.now() - startRef.current);
    };
  }, []);

  const flatChapters = useMemo(() => {
    if (!parts) return [] as { partIndex: number; chapterIndex: number; title: string }[];
    const arr: { partIndex: number; chapterIndex: number; title: string }[] = [];
    parts.forEach((part, pi) =>
      part.chapters.forEach((ch, ci) => arr.push({ partIndex: pi, chapterIndex: ci, title: ch.chapter_title }))
    );
    return arr;
  }, [parts]);

  const currentChapter = useMemo(() => {
    if (!parts) return null;
    const ch = parts[p.partIndex]?.chapters[p.chapterIndex];
    return ch || null;
  }, [parts, p]);

  const currentChapterWords = useMemo(() => {
    return currentChapter ? countWordsInChapter(currentChapter as any) : 0;
  }, [currentChapter]);

  const lineHeight = useMemo(() => {
    switch (lineSpacing) {
      case "compact":
        return 1.2;
      case "normal":
        return 1.5;
      default:
        return 1.75;
    }
  }, [lineSpacing]);

  // Word-based daily goal calculations
  const totalWords = useMemo(() => computeTotalWords(parts), [parts]);

  const wordsUpToCurrent = useMemo(() => computeWordsUpToPosition(parts, { partIndex: p.partIndex, chapterIndex: p.chapterIndex }), [parts, p]);

  // Words-based overall book percent (more precise than chapter-count percent)
  const totalBookProgressPercent = useMemo(() => {
    if (!parts) return 0;
    const denom = Math.max(1, totalWords);
    return Math.min(100, Math.round((wordsUpToCurrent / denom) * 100));
  }, [parts, wordsUpToCurrent, totalWords]);

  const plan = useMemo(() => getReadingPlan(bookId), [bookId]);

  // Calculate target words based on plan
  const targetWords = useMemo(
    () => computeWordsUpToInclusiveTarget(parts, { targetPartIndex: plan.targetPartIndex, targetChapterIndex: plan.targetChapterIndex }, totalWords),
    [parts, plan, totalWords]
  );

  // Load plan start (position where the user chose to begin the plan)
  const planStart = useMemo(() => {
    if (!bookId) return null as null | { startPartIndex: number; startChapterIndex: number; startWords?: number };
    try {
      const raw = localStorage.getItem(`planStart:${bookId}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, [bookId]);

  const todayISO = useTodayISO();
  // Derive today's baseline synchronously to prevent a transient stale percent after day change
  const baselineForToday = useMemo(() => {
    const base = getDailyBaseline(bookId, todayISO);
    return base ? base.words : wordsUpToCurrent;
  }, [bookId, todayISO, wordsUpToCurrent]);
  // Persist baseline if missing (side-effect, no UI dependency)
  useEffect(() => {
    const base = getDailyBaseline(bookId, todayISO);
    if (base) {
      try { console.log('[Baseline] existente', { scope: 'Reader', bookId, todayISO, base }); } catch {}
      return;
    }
    // Avoid persisting zero before parts/progress are ready
    const hasProgress = (p?.percent ?? 0) > 0 || p.partIndex > 0 || p.chapterIndex > 0 || wordsUpToCurrent > 0;
    if (!parts) {
      try { console.log('[Baseline] skip persist: parts não carregadas', { scope: 'Reader', bookId, todayISO, wordsUpToCurrent, p }); } catch {}
      return;
    }
    if (!hasProgress) {
      try { console.log('[Baseline] skip persist: sem progresso ainda', { scope: 'Reader', bookId, todayISO, wordsUpToCurrent, p }); } catch {}
      return;
    }
    // Persist percent aligned to the words-based total book progress for consistency
    setDailyBaseline(bookId, todayISO, { words: wordsUpToCurrent, percent: totalBookProgressPercent });
    try { console.log('[Baseline] persistida', { scope: 'Reader', bookId, todayISO, words: wordsUpToCurrent, percent: totalBookProgressPercent }); } catch {}
  }, [bookId, todayISO, parts, wordsUpToCurrent, p.partIndex, p.chapterIndex, p.percent, totalBookProgressPercent]);

  const daysRemaining = useMemo(() => computeDaysRemaining(plan?.targetDateISO), [plan]);
  const dailyTargetWords = useMemo(
    () => computeDailyTargetWords(targetWords, baselineForToday, daysRemaining),
    [targetWords, baselineForToday, daysRemaining]
  );
  const achievedWordsToday = useMemo(
    () => computeAchievedWordsToday(wordsUpToCurrent, baselineForToday),
    [wordsUpToCurrent, baselineForToday]
  );
  const dailyProgressPercent = useMemo(
    () => computeDailyProgressPercent(achievedWordsToday, dailyTargetWords),
    [achievedWordsToday, dailyTargetWords]
  );
  // Progress of the reading plan from selected start to target
  const planProgressPercent = useMemo(
    () => computePlanProgressPercent(parts, wordsUpToCurrent, targetWords, planStart),
    [parts, wordsUpToCurrent, targetWords, planStart]
  );

  // Update Android widget when daily progress changes
  useEffect(() => {
    const isNative = canUseNative();
    if (!isNative) return;
    const percent = Math.max(0, Math.min(100, Math.round(dailyProgressPercent || 0)));
    const hasGoal = dailyTargetWords != null && dailyTargetWords > 0;

    console.log("[Widget] preparando update:", { percent, hasGoal });

    (async () => {
      try {
        await updateDailyProgressWidget(percent, hasGoal);
         console.log("[Widget] Preferences set OK");
        // Trigger native refresh
  await WidgetUpdater.update?.();
   console.log("[Widget] Plugin update invoked");
      } catch (err) {
      console.error("[Widget] erro ao atualizar widget:", err);
    }
    })();

  }, [dailyProgressPercent, dailyTargetWords]);
  
  // Check if daily goal was just completed and auto-mark reading
  const [wasGoalCompleted, setWasGoalCompleted] = useState(false);
  useEffect(() => {
    if (dailyProgressPercent === 100 && !wasGoalCompleted && !hasReadToday()) {
      setWasGoalCompleted(true);
      onReadToday();
    } else if (dailyProgressPercent !== 100) {
      setWasGoalCompleted(false);
    }
  }, [dailyProgressPercent, wasGoalCompleted]);

  const updateProgress = (np: typeof p) => {
    setP(np);
    setProgress(bookId, np);
  };
  const concludeChapter = () => {
    if (!parts) return;
    const isLast = p.partIndex === parts.length - 1 && p.chapterIndex === parts[p.partIndex].chapters.length - 1;
    if (isLast) {
      updateProgress({ ...p, percent: 100 });
      celebrate("Livro concluído! Parabéns pela perseverança.");
      // Scroll to top after concluding the last chapter
      requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
      return;
    }
    // move forward
    let np = { ...p };
    const nextChapterIndex = p.chapterIndex + 1;
    if (nextChapterIndex < parts[p.partIndex].chapters.length) {
      np.chapterIndex = nextChapterIndex;
    } else {
      np.partIndex += 1;
      np.chapterIndex = 0;
    }
    const idx = flatChapters.findIndex(
      (i) => i.partIndex === np.partIndex && i.chapterIndex === np.chapterIndex
    );
    const percent = Math.round(((idx + 1) / flatChapters.length) * 100);
    np.percent = Math.min(100, percent);
    updateProgress(np);
    onReadToday();
    // Move viewport to the top so the next chapter starts at the beginning
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  };

  const onReadToday = () => {
    if (hasReadToday()) {
      toast({ 
        title: "Já marcado", 
        description: "Você já marcou a leitura de hoje.", 
        variant: "default" 
      });
      return;
    }
    
    const before = getStreak();
    const after = markReadToday();
    setStreak(after);
    
    if (after.current > before.current) {
      celebrate("Leitura do dia registrada! Streak +1");
    } else {
      toast({ title: "Leitura do dia", description: "Registrada com sucesso." });
    }
  };

  const celebrate = (message: string) => {
    toast({ title: message });
    try { navigator.vibrate?.(150); } catch {}
    confetti({ particleCount: 90, spread: 70, origin: { y: 0.7 } });
  };

  if (!meta) {
    return (
      <main className="container mx-auto py-10">
        <h1 className="text-2xl font-bold mb-2">Livro não encontrado</h1>
        <Button asChild>
          <Link to="/biblioteca">Voltar à biblioteca</Link>
        </Button>
      </main>
    );
  }

  return (
    <main className="container mx-auto py-6">
      <SEO
        title={`${meta.title} — Leitura Devota`}
        description={`Leia ${meta.title} de ${meta.author} em português com progresso e streak.`}
        canonical={`/leitor/${meta.id}`}
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'Book',
          name: meta.title,
          author: { '@type': 'Person', name: meta.author },
          inLanguage: 'pt-BR',
        }}
      />
      <nav className="mb-4 text-sm">
        <BackLink to="/biblioteca" label="Biblioteca" />
      </nav>

      <h1 className="text-2xl font-bold">{meta.title}</h1>
      <p className="text-muted-foreground mb-4">{meta.author}</p>

      <section className="flex flex-col md:flex-row gap-6">
        <article className="flex-1">
          {/* Opções de leitura: agora acima dos progressos */}
          <div className="border rounded-md p-3 mb-4">
            <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen}>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium">Opções de leitura</p>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={settingsOpen ? "Recolher opções" : "Expandir opções"}>
                    <Settings className="h-4 w-4" />
                  </Button>
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent className="space-y-4">
                <div>
                  <p className="text-sm font-medium mb-2">Aparência</p>
                  <ToggleGroup type="single" value={theme || "system"} onValueChange={(v)=> v && setTheme(v)}>
                    <ToggleGroupItem value="system" aria-label="Usar tema do sistema" title="Sistema">
                      <Monitor className="h-4 w-4" />
                    </ToggleGroupItem>
                    <ToggleGroupItem value="light" aria-label="Usar tema claro" title="Claro">
                      <Sun className="h-4 w-4" />
                    </ToggleGroupItem>
                    <ToggleGroupItem value="dark" aria-label="Usar tema escuro" title="Escuro">
                      <Moon className="h-4 w-4" />
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>
                <div>
                  <p className="text-sm font-medium mb-2">Tamanho da fonte</p>
                  <Slider
                    value={[fontSize]}
                    min={14}
                    max={24}
                    step={1}
                    onValueChange={(v) => setFontSize(v[0])}
                  />
                </div>
                <div>
                  <p className="text-sm font-medium mb-2">Espaçamento entre linhas</p>
                  <ToggleGroup type="single" value={lineSpacing} onValueChange={(v)=> v && setLineSpacing(v as any)}>
                    <ToggleGroupItem value="compact" aria-label="Espaçamento compacto" title="Compacto">1.2×</ToggleGroupItem>
                    <ToggleGroupItem value="normal" aria-label="Espaçamento normal" title="Normal">1.5×</ToggleGroupItem>
                    <ToggleGroupItem value="relaxed" aria-label="Espaçamento relaxado" title="Relaxado">1.75×</ToggleGroupItem>
                  </ToggleGroup>
                </div>
                <div>
                  <p className="text-sm font-medium mb-2">Alinhamento do texto</p>
                  <ToggleGroup type="single" value={textAlign} onValueChange={(v)=> v && setTextAlign(v as any)}>
                    <ToggleGroupItem value="justify" aria-label="Justificado" title="Justificado">
                      <AlignJustify className="h-4 w-4" />
                    </ToggleGroupItem>
                    <ToggleGroupItem value="left" aria-label="Alinhado à esquerda" title="Esquerda">
                      <AlignLeft className="h-4 w-4" />
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
          <div className="mb-3 space-y-3">
            {dailyProgressPercent != null && (
              <div>
                <Progress value={dailyProgressPercent} />
                <p className="text-sm text-muted-foreground mt-1">
                  {`Meta do dia: ${dailyProgressPercent}% — ${achievedWordsToday}/${dailyTargetWords} palavras`}
                </p>
                {currentChapter && (
                  <p className="text-xs font-medium text-primary mt-1">
                    {`Capítulo atual: ${currentChapterWords} palavras`}
                  </p>
                )}
              </div>
            )}
          </div>

          {loading && <p>Carregando…</p>}
          {err && <p className="text-destructive">{err}</p>}

          {currentChapter && (
            <div>
              <h2 className="text-xl font-semibold mb-3">{currentChapter.chapter_title}</h2>
              <div className={`space-y-4 ${textAlign === "justify" ? "text-justify" : "text-left"}`} style={{ fontSize, lineHeight }}>
                {currentChapter.content.map((blk, i) => (
                  <p key={i}>{blk.content}</p>
                ))}
              </div>
              {/* Bottom action: conclude chapter */}
              <div className="mt-8 pt-4 border-t">
                <div className="flex flex-col md:flex-row gap-2">
                  <Button
                    className="w-full md:w-auto"
                    onClick={() => {
                      // Visual feedback when concluding via bottom button
                      try {
                        confetti({ particleCount: 60, spread: 70, origin: { y: 0.7 } });
                      } catch {}
                      concludeChapter();
                    }}
                  >
                    Concluir capítulo
                  </Button>
                  {(!hasReadToday() && (dailyProgressPercent == null || dailyProgressPercent < 100)) && (
                    <Button 
                      className="w-full md:w-auto" 
                      onClick={onReadToday} 
                      variant="secondary"
                    >
                      Marcar leitura de hoje
                    </Button>
                  )}
                  {(hasReadToday() || (dailyProgressPercent != null && dailyProgressPercent >= 100)) && (
                    <p className="text-xs text-muted-foreground self-center">
                      Leitura do dia já contabilizada
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </article>

        <aside className="md:w-72 shrink-0 border rounded-md p-3 h-[70vh] overflow-auto">
          <p className="text-sm font-medium mb-2">Capítulos</p>
          <ol className="space-y-2 text-sm">
            {flatChapters.map((c, idx) => (
              <li key={`${c.partIndex}-${c.chapterIndex}`}>
                <button
                  className={`text-left w-full rounded px-2 py-1 hover:bg-accent/30 ${
                    c.partIndex === p.partIndex && c.chapterIndex === p.chapterIndex ? "bg-accent/40" : ""
                  }`}
                  onClick={() => {
                    updateProgress({ partIndex: c.partIndex, chapterIndex: c.chapterIndex, percent: Math.round(((idx + 1) / flatChapters.length) * 100) });
                  }}
                >
                  {idx + 1}. {c.title}
                </button>
              </li>
            ))}
          </ol>
        </aside>
      </section>
    </main>
  );
};

export default Reader;
