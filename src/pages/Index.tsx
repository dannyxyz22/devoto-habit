import Hero from "@/components/app/Hero";
import { updateDailyProgressWidget } from "@/main";
import { Capacitor } from "@capacitor/core";
import { WidgetUpdater, canUseNative } from "@/lib/widgetUpdater";
import { SEO } from "@/components/app/SEO";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useEffect, useMemo, useState } from "react";
import { Progress } from "@/components/ui/progress";
import { BOOKS } from "@/lib/books";
import { differenceInCalendarDays, formatISO, parseISO } from "date-fns";
import { useTodayISO } from "@/hooks/use-today";
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
  const [activeIsEpub, setActiveIsEpub] = useState(false);
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
    setActiveIsEpub(meta.type === 'epub');
    if (meta.type === 'epub') {
      setParts(null);
      return;
    } else {
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
    }
  }, [activeBookId]);

  // Compute plan progress and daily goal similar to Reader
  const plan = useMemo(() => activeBookId ? getReadingPlan(activeBookId) : { targetDateISO: null }, [activeBookId]);
  const p = useMemo(() => activeBookId ? getProgress(activeBookId) : { partIndex: 0, chapterIndex: 0, percent: 0 }, [activeBookId]);
  const totalWords = useMemo(() => computeTotalWords(parts), [parts]);
  const wordsUpToCurrent = useMemo(
    () => activeIsEpub ? 0 : computeWordsUpToPosition(parts, { partIndex: p.partIndex, chapterIndex: p.chapterIndex }),
    [activeIsEpub, parts, p]
  );
  const targetWords = useMemo(
    () => activeIsEpub ? 0 : computeWordsUpToInclusiveTarget(parts, { targetPartIndex: plan.targetPartIndex, targetChapterIndex: plan.targetChapterIndex }, totalWords),
    [activeIsEpub, parts, plan, totalWords]
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
  const todayISO = useTodayISO();
  // Derive today's baseline synchronously to avoid transient old percent after day change
  const baselineForToday = useMemo(() => {
    if (!activeBookId) return activeIsEpub ? (p.percent || 0) : wordsUpToCurrent;
    const base = getDailyBaseline(activeBookId, todayISO);
    if (base) return activeIsEpub ? base.percent : base.words;
    return activeIsEpub ? (p.percent || 0) : wordsUpToCurrent;
  }, [activeBookId, activeIsEpub, todayISO, wordsUpToCurrent, p.percent]);
  // Persist baseline if missing
  useEffect(() => {
    if (!activeBookId) return;
    const base = getDailyBaseline(activeBookId, todayISO);
    if (!base) {
      setDailyBaseline(activeBookId, todayISO, { words: wordsUpToCurrent, percent: p.percent });
    }
  }, [activeBookId, todayISO, wordsUpToCurrent, p.percent]);

  const daysRemaining = useMemo(() => computeDaysRemaining(plan?.targetDateISO), [plan]);
  // EPUB daily target uses percentage instead of words
  const dailyTargetWords = useMemo(
    () => activeIsEpub
      ? (daysRemaining ? Math.ceil(Math.max(0, 100 - (baselineForToday || 0)) / daysRemaining) : null)
      : computeDailyTargetWords(targetWords, baselineForToday, daysRemaining),
    [activeIsEpub, targetWords, baselineForToday, daysRemaining]
  );
  const achievedWordsToday = useMemo(
    () => activeIsEpub ? Math.max(0, (p.percent || 0) - (baselineForToday || 0)) : computeAchievedWordsToday(wordsUpToCurrent, baselineForToday),
    [activeIsEpub, p.percent, baselineForToday, wordsUpToCurrent]
  );
  const dailyProgressPercent = useMemo(
    () => computeDailyProgressPercent(achievedWordsToday, dailyTargetWords),
    [achievedWordsToday, dailyTargetWords]
  );
  const planProgressPercent = useMemo(() => {
    if (activeIsEpub) {
      // From plan start percent to 100% target
      const rawStart = planStart?.startWords != null ? planStart.startWords : null; // for type narrowing only
      const startPercent = (() => { try { const raw = localStorage.getItem(`planStart:${activeBookId}`); const j = raw ? JSON.parse(raw) : null; return j?.startPercent ?? 0; } catch { return 0; } })();
      const denom = Math.max(1, 100 - startPercent);
      const num = Math.max(0, (p.percent || 0) - startPercent);
      return Math.min(100, Math.round((num / denom) * 100));
    }
    return computePlanProgressPercent(parts, wordsUpToCurrent, targetWords, planStart);
  }, [activeIsEpub, parts, wordsUpToCurrent, targetWords, planStart, p.percent, activeBookId]);
  const totalBookProgressPercent = useMemo(() => activeIsEpub ? (p.percent || 0) : (parts ? Math.min(100, Math.round((wordsUpToCurrent / Math.max(1, totalWords)) * 100)) : null), [activeIsEpub, parts, wordsUpToCurrent, totalWords, p.percent]);

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

  // Target labels for the reading plan
  const targetPartTitle = useMemo(() => {
    if (!parts || plan?.targetPartIndex == null) return null;
    const part = parts[plan.targetPartIndex];
    return part?.part_title ?? null;
  }, [parts, plan]);
  const targetChapterTitle = useMemo(() => {
    if (!parts || plan?.targetPartIndex == null || plan?.targetChapterIndex == null) return null;
    const ch = parts[plan.targetPartIndex]?.chapters?.[plan.targetChapterIndex];
    return ch?.chapter_title ?? null;
  }, [parts, plan]);

  const stats = useMemo(() => getStats(), []);
  const minutesToday = stats.minutesByDate[todayISO] || 0;

  // Push widget update when progress/goal changes (native only)
  useEffect(() => {
  const isNative = canUseNative();
  if (!isNative) return;
    const percent = Math.max(0, Math.min(100, Math.round(dailyProgressPercent || 0)));
    const hasGoal = dailyTargetWords != null && dailyTargetWords > 0;
    (async () => {
      try {
        await updateDailyProgressWidget(percent, hasGoal);
    await WidgetUpdater.update?.();
      } catch {}
    })();
  }, [dailyProgressPercent, dailyTargetWords]);

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
        {dailyProgressPercent}% — {achievedWordsToday}/{dailyTargetWords} {activeIsEpub ? "%" : "palavras"}
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
        {!activeIsEpub && parts && plan?.targetPartIndex != null && (
                <p className="text-sm text-muted-foreground mt-1">
                  {`${targetPartTitle ? `${targetPartTitle}` : ""}`}
                  <br />
                  {plan.targetChapterIndex != null ? `${targetChapterTitle ? `${targetChapterTitle}` : ""}` : ""}
                </p>
              )}
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
            activeIsEpub ? (
              <>
                <p className="text-sm text-muted-foreground mt-1">{p.percent || 0}% lido</p>
                <div className="mt-2">
                  <Button asChild variant="link">
                    <Link to={`/epub/${activeBookId}`}>Continuar leitura</Link>
                  </Button>
                </div>
              </>
            ) : parts ? (
              <>
                <p className="text-sm text-muted-foreground mt-1">
                  {`${currentPartTitle ? `${currentPartTitle}` : ""}`}
                  <br />
                  {`${currentChapterTitle ? `${currentChapterTitle}` : ""}`}
                </p>
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
