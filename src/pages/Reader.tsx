import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/hooks/use-toast";
import confetti from "canvas-confetti";
import { getBookById } from "@/lib/books";
import { SEO } from "@/components/app/SEO";
import { differenceInCalendarDays, formatISO, parseISO } from "date-fns";
import { useTheme } from "next-themes";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Sun, Moon, Monitor, AlignLeft, AlignJustify } from "lucide-react";
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

  // Word-based daily goal calculations
  const totalWords = useMemo(() => computeTotalWords(parts), [parts]);

  const wordsUpToCurrent = useMemo(() => computeWordsUpToPosition(parts, { partIndex: p.partIndex, chapterIndex: p.chapterIndex }), [parts, p]);

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

  const todayISO = formatISO(new Date(), { representation: "date" });
  const [baselineWords, setBaselineWords] = useState<number | null>(null);

  useEffect(() => {
    if (!parts) return;
    const base = getDailyBaseline(bookId, todayISO);
    if (base) {
      setBaselineWords(base.words);
    } else {
      const entry = { words: wordsUpToCurrent, percent: p.percent };
      setDailyBaseline(bookId, todayISO, entry);
      setBaselineWords(entry.words);
    }
  }, [parts, wordsUpToCurrent, bookId, todayISO, p.percent]);

  const daysRemaining = useMemo(() => computeDaysRemaining(plan?.targetDateISO), [plan]);
  const dailyTargetWords = useMemo(
    () => computeDailyTargetWords(targetWords, baselineWords, daysRemaining),
    [targetWords, baselineWords, daysRemaining]
  );
  const achievedWordsToday = useMemo(
    () => computeAchievedWordsToday(wordsUpToCurrent, baselineWords),
    [wordsUpToCurrent, baselineWords]
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
        <Link to="/biblioteca" className="text-primary underline-offset-4 hover:underline">← Biblioteca</Link>
      </nav>

      <h1 className="text-2xl font-bold">{meta.title}</h1>
      <p className="text-muted-foreground mb-4">{meta.author}</p>

      <section className="flex flex-col md:flex-row gap-6">
        <aside className="md:w-64 shrink-0 border rounded-md p-3 h-fit">
          <div className="mb-4">
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
          <div className="mb-4">
            <p className="text-sm font-medium mb-2">Tamanho da fonte</p>
            <Slider
              value={[fontSize]}
              min={14}
              max={24}
              step={1}
              onValueChange={(v) => setFontSize(v[0])}
            />
          </div>
          <div className="mb-4">
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
          <div className="space-y-2">
            <Button 
              className="w-full" 
              onClick={onReadToday} 
              variant={hasReadToday() ? "outline" : "secondary"}
              disabled={hasReadToday()}
            >
              {hasReadToday() ? "✓ Leitura marcada" : "Marcar leitura de hoje"}
            </Button>
            <Button
              className="w-full"
              onClick={() => {
                try {
                  confetti({ particleCount: 60, spread: 70, origin: { y: 0.7 } });
                } catch {}
                concludeChapter();
              }}
            >
              Concluir capítulo
            </Button>
          </div>
          
          {/* Streak info */}
          <div className="mt-4 p-3 bg-muted/50 rounded-md">
            <p className="text-sm font-medium">Sequência de Leitura</p>
            <p className="text-lg font-bold text-primary">{streak.current} dias</p>
            <p className="text-xs text-muted-foreground">
              Recorde: {streak.longest} dias
            </p>
            {streak.freezeAvailable && (
              <p className="text-xs text-blue-600">
                🧊 1 congelamento disponível
              </p>
            )}
          </div>
        </aside>

        <article className="flex-1">
          <div className="mb-3 space-y-3">
            <div>
              <Progress value={p.percent} />
              <p className="text-sm text-muted-foreground mt-1">Progresso: {p.percent}%</p>
            </div>
            {plan?.targetDateISO && planProgressPercent != null && (
              <div>
                <Progress value={planProgressPercent} />
                <p className="text-sm text-muted-foreground mt-1">
                  Meta de leitura: {planProgressPercent}%{daysRemaining ? ` — ${daysRemaining} dia(s) restantes` : ""}
                </p>
              </div>
            )}
            {dailyProgressPercent != null && (
              <div>
                <Progress value={dailyProgressPercent} />
                <p className="text-sm text-muted-foreground mt-1">
                  {`Meta do dia: ${dailyProgressPercent}% — ${achievedWordsToday}/${dailyTargetWords} palavras`}
                </p>
              </div>
            )}
          </div>

          {loading && <p>Carregando…</p>}
          {err && <p className="text-destructive">{err}</p>}

          {currentChapter && (
            <div>
              <h2 className="text-xl font-semibold mb-3">{currentChapter.chapter_title}</h2>
              <div className={`space-y-4 leading-relaxed ${textAlign === "justify" ? "text-justify" : "text-left"}`} style={{ fontSize }}>
                {currentChapter.content.map((blk, i) => (
                  <p key={i}>{blk.content}</p>
                ))}
              </div>
              {/* Bottom action: conclude chapter */}
              <div className="mt-8 pt-4 border-t">
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
