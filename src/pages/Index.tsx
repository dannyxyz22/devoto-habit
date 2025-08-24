import Hero from "@/components/app/Hero";
import { SEO } from "@/components/app/SEO";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useEffect, useMemo, useState } from "react";
import { Progress } from "@/components/ui/progress";
import { BOOKS } from "@/lib/books";
import { differenceInCalendarDays, formatISO, parseISO } from "date-fns";
import { getStreak, getReadingPlan, getProgress, getDailyBaseline, setDailyBaseline, getStats, type Streak } from "@/lib/storage";
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

const Index = () => {
  const [streak, setStreak] = useState<Streak>(() => getStreak());
  const [used, setUsed] = useState(false);
  const [activeBookId, setActiveBookId] = useState<string | null>(null);
  const [parts, setParts] = useState<Part[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Detect prior usage and choose an active book
  useEffect(() => {
    try {
      const ls = window.localStorage;
      let u = false;
      for (let i = 0; i < ls.length; i++) {
        const key = ls.key(i) || "";
        if (key.startsWith("progress:") || key.startsWith("plan:")) { u = true; break; }
      }
      if (!u) {
        const sk = ls.getItem("streak");
        const st = sk ? JSON.parse(sk) : null;
        if (st?.lastReadISO) u = true;
      }
      if (!u) {
        const stat = ls.getItem("stats");
        const s = stat ? JSON.parse(stat) : null;
        if (s?.minutesByDate && Object.keys(s.minutesByDate).length > 0) u = true;
      }
      setUsed(u);

      // Pick active book: lastBookId, or first with plan, else null
      let chosen: string | null = null;
      const last = ls.getItem("lastBookId");
      if (last) chosen = last;
      if (!chosen) {
        for (const b of BOOKS) {
          const plan = getReadingPlan(b.id);
          if (plan?.targetDateISO) { chosen = b.id; break; }
        }
      }
      setActiveBookId(chosen);
    } catch {}
  }, []);

  // Load active book structure to compute progress when needed
  useEffect(() => {
    if (!activeBookId) return;
    const meta = BOOKS.find(b => b.id === activeBookId);
    if (!meta) return;
    const cacheKey = `book:${meta.id}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try { setParts(JSON.parse(cached)); return; } catch {}
    }
    setLoading(true);
    fetch(meta.sourceUrl)
      .then(r => r.json())
      .then(json => {
        localStorage.setItem(cacheKey, JSON.stringify(json));
        setParts(json as Part[]);
      })
      .catch(() => setErr("Falha ao carregar o livro para estatísticas."))
      .finally(() => setLoading(false));
  }, [activeBookId]);

  // Compute plan progress and daily goal similar to Reader
  const plan = useMemo(() => activeBookId ? getReadingPlan(activeBookId) : { targetDateISO: null }, [activeBookId]);
  const p = useMemo(() => activeBookId ? getProgress(activeBookId) : { partIndex: 0, chapterIndex: 0, percent: 0 }, [activeBookId]);
  const totalWords = useMemo(() => computeTotalWords(parts), [parts]);
  const wordsUpToCurrent = useMemo(
    () => computeWordsUpToPosition(parts, { partIndex: p.partIndex, chapterIndex: p.chapterIndex }),
    [parts, p]
  );
  const targetWords = useMemo(
    () => computeWordsUpToInclusiveTarget(parts, { targetPartIndex: plan.targetPartIndex, targetChapterIndex: plan.targetChapterIndex }, totalWords),
    [parts, plan, totalWords]
  );

  // Load plan start to compute progress from start to target
  const planStart = useMemo(() => {
    if (!activeBookId) return null as null | { startPartIndex: number; startChapterIndex: number; startWords?: number };
    try {
      const raw = localStorage.getItem(`planStart:${activeBookId}`);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }, [activeBookId]);

  const remainingWords = Math.max(0, targetWords - wordsUpToCurrent);
  const todayISO = formatISO(new Date(), { representation: "date" });
  const [baselineWords, setBaselineWords] = useState<number | null>(null);
  useEffect(() => {
    if (!activeBookId || !parts) return;
    const base = getDailyBaseline(activeBookId, todayISO);
    if (base) {
      setBaselineWords(base.words);
    } else {
      const entry = { words: wordsUpToCurrent, percent: p.percent };
      setDailyBaseline(activeBookId, todayISO, entry);
      setBaselineWords(entry.words);
    }
  }, [activeBookId, parts, wordsUpToCurrent, p.percent, todayISO]);

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
  const planProgressPercent = useMemo(
    () => computePlanProgressPercent(parts, wordsUpToCurrent, targetWords, planStart),
    [parts, wordsUpToCurrent, targetWords, planStart]
  );
  const totalBookProgressPercent = useMemo(() => parts ? Math.min(100, Math.round((wordsUpToCurrent / Math.max(1, totalWords)) * 100)) : null, [parts, wordsUpToCurrent, totalWords]);

  // Current reading position labels
  const currentPartTitle = useMemo(() => {
    if (!parts) return null;
    const part = parts[p.partIndex];
    return part?.part_title ?? null;
  }, [parts, p.partIndex]);
  const currentChapterTitle = useMemo(() => {
    if (!parts) return null;
    const part = parts[p.partIndex];
    const ch = part?.chapters?.[p.chapterIndex];
    return ch?.chapter_title ?? null;
  }, [parts, p.partIndex, p.chapterIndex]);

  const stats = useMemo(() => getStats(), []);
  const minutesToday = stats.minutesByDate[todayISO] || 0;

  return (
    <main>
      <SEO
        title="Leitura Devota — Clássicos Católicos"
        description="Crie o hábito de leitura espiritual diária com clássicos católicos em português."
        canonical="/"
      />
      <Hero />
      <section className="mt-8 grid md:grid-cols-3 gap-6">
        {/* Meta diária (se houver) */}
        <div className="rounded-lg border p-4">
          <h3 className="text-lg font-semibold">Meta diária</h3>
          {used && activeBookId && dailyProgressPercent != null ? (
            <>
              <Progress value={dailyProgressPercent} />
              <p className="text-sm text-muted-foreground mt-2">
                {dailyProgressPercent}% — {achievedWordsToday}/{dailyTargetWords} palavras
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">Se tiver uma meta, mostraremos seu progresso diário aqui.</p>
          )}
        </div>

        {/* Meta de leitura: mostra progresso da meta (se houver) */}
        <div className="rounded-lg border p-4">
          <h3 className="text-lg font-semibold">Meta de leitura</h3>
          {used && activeBookId && plan?.targetDateISO && planProgressPercent != null ? (
            <>
              <Progress value={planProgressPercent} />
              <p className="text-sm text-muted-foreground mt-2">Meta: {planProgressPercent}%
                {daysRemaining ? ` • ${daysRemaining} dia(s) restantes` : ""}
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">Defina uma meta e acompanhe seu avanço.</p>
          )}
        </div>

        {/* Livro ativo */}
        <div className="rounded-lg border p-4">
          <h3 className="text-lg font-semibold">Livro ativo</h3>
          {used ? (
            <>
              <p className="text-muted-foreground text-sm">{activeBookId ? (BOOKS.find(b=>b.id===activeBookId)?.title || activeBookId) : "—"}</p>
              {activeBookId && totalBookProgressPercent != null && (
                <div className="mt-2">
                  <Progress value={totalBookProgressPercent} />
                  <p className="text-sm text-muted-foreground mt-2">Livro: {totalBookProgressPercent}%</p>
                </div>
              )}
            </>
          ) : (
            <Button asChild variant="link">
              <Link to="/biblioteca">Escolha um livro na biblioteca</Link>
            </Button>
          )}
        </div>
      </section>
      <section className="mt-6 grid md:grid-cols-3 gap-6">
        {/* Marcador do livro (posição atual) */}
        <div className="rounded-lg border p-4">
          <h3 className="text-lg font-semibold">Marcador do livro</h3>
          {used && activeBookId ? (
            parts ? (
              <>
                <p className="text-sm text-muted-foreground">Parte {p.partIndex + 1}{currentPartTitle ? ` — ${currentPartTitle}` : ""}</p>
                <p className="text-sm text-muted-foreground">Capítulo {p.chapterIndex + 1}{currentChapterTitle ? ` — ${currentChapterTitle}` : ""}</p>
                <div className="mt-2">
                  <Button asChild variant="link">
                    <Link to={`/leitor/${activeBookId}`}>Continuar leitura</Link>
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-muted-foreground text-sm">Carregando marcador…</p>
            )
          ) : (
            <Button asChild variant="link">
              <Link to="/biblioteca">Escolha um livro na biblioteca</Link>
            </Button>
          )}
        </div>
        {/* Streak diário */}
        <div className="rounded-lg border p-4">
          <h3 className="text-lg font-semibold">Streak diário</h3>
          {used ? (
            <>
              <p className="text-3xl font-bold text-primary">{streak.current} dias</p>
              <p className="text-xs text-muted-foreground">Recorde: {streak.longest} • {streak.lastReadISO ? "Atualizado" : "Ainda não iniciado"}</p>
              {streak.freezeAvailable && (
                <p className="text-xs text-blue-600">🧊 1 congelamento disponível</p>
              )}
            </>
          ) : (
            <p className="text-muted-foreground">Ganhe consistência com sua leitura devocional.</p>
          )}
        </div>
        {/* Minutos hoje */}
        <div className="rounded-lg border p-4">
          <h3 className="text-lg font-semibold">Minutos hoje</h3>
          {used ? (
            <p className="text-2xl font-bold">{minutesToday} min</p>
          ) : (
            <Button asChild variant="link">
              <Link to="/biblioteca">Contabilize seu tempo de leitura</Link>
            </Button>
          )}
        </div>
      </section>
      {err && (
        <div className="mt-4 rounded-lg border p-4">
          <h3 className="text-lg font-semibold">Status</h3>
          <p className="text-muted-foreground text-sm">{err}</p>
        </div>
      )}
      
    </main>
  );
};

export default Index;
