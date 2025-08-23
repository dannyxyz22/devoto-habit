import Hero from "@/components/app/Hero";
import { SEO } from "@/components/app/SEO";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useEffect, useMemo, useState } from "react";
import { Progress } from "@/components/ui/progress";
import { BOOKS } from "@/lib/books";
import { differenceInCalendarDays, formatISO, parseISO } from "date-fns";
import { getStreak, getReadingPlan, getProgress, getDailyBaseline, setDailyBaseline, getStats, type Streak } from "@/lib/storage";

// Mirror types used in Reader for counting words
type Paragraph = { type: string; content: string };
type Chapter = { chapter_title: string; content: Paragraph[] };
type Part = { part_title: string; chapters: Chapter[] };

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
  const totalWords = useMemo(() => {
    if (!parts) return 0;
    let count = 0;
    parts.forEach(part => part.chapters.forEach(ch => ch.content.forEach(blk => {
      count += blk.content.trim().split(/\s+/).filter(Boolean).length;
    })));
    return count;
  }, [parts]);
  const wordsUpToCurrent = useMemo(() => {
    if (!parts) return 0;
    let count = 0;
    parts.forEach((part, pi) => part.chapters.forEach((ch, ci) => {
      if (pi < p.partIndex || (pi === p.partIndex && ci < p.chapterIndex)) {
        ch.content.forEach(blk => { count += blk.content.trim().split(/\s+/).filter(Boolean).length; });
      }
    }));
    return count;
  }, [parts, p]);
  const targetWords = useMemo(() => {
    if (!parts || plan.targetPartIndex === undefined || plan.targetChapterIndex === undefined) return totalWords;
    let count = 0;
    parts.forEach((part, pi) => part.chapters.forEach((ch, ci) => {
      if (pi < plan.targetPartIndex! || (pi === plan.targetPartIndex! && ci <= plan.targetChapterIndex!)) {
        ch.content.forEach(blk => { count += blk.content.trim().split(/\s+/).filter(Boolean).length; });
      }
    }));
    return count;
  }, [parts, plan, totalWords]);

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

  const daysRemaining = useMemo(() => {
    if (!plan?.targetDateISO) return null;
    try {
      const target = parseISO(plan.targetDateISO);
      const diff = differenceInCalendarDays(target, new Date());
      return Math.max(1, diff + 1);
    } catch { return null; }
  }, [plan]);
  const dailyTargetWords = useMemo(() => daysRemaining ? Math.ceil(remainingWords / daysRemaining) : null, [remainingWords, daysRemaining]);
  const achievedWordsToday = baselineWords != null ? Math.max(0, wordsUpToCurrent - baselineWords) : 0;
  const dailyProgressPercent = dailyTargetWords ? Math.min(100, Math.round((achievedWordsToday / dailyTargetWords) * 100)) : null;
  const planProgressPercent = useMemo(() => parts ? Math.min(100, Math.round((wordsUpToCurrent / Math.max(1, targetWords)) * 100)) : null, [parts, wordsUpToCurrent, targetWords]);
  const totalBookProgressPercent = useMemo(() => parts ? Math.min(100, Math.round((wordsUpToCurrent / Math.max(1, totalWords)) * 100)) : null, [parts, wordsUpToCurrent, totalWords]);

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
        {/* Streak */}
        <div className="rounded-lg border p-4">
          <h2 className="text-lg font-semibold">Streak diário</h2>
          {used ? (
            <>
              <p className="text-3xl font-bold text-primary">{streak.current} dias</p>
              <p className="text-xs text-muted-foreground">Recorde: {streak.longest} • {streak.lastReadISO ? "Atualizado" : "Ainda não iniciado"}</p>
            </>
          ) : (
            <p className="text-muted-foreground">Ganhe consistência com sua leitura devocional.</p>
          )}
        </div>

        {/* Meta de leitura: mostra progresso da meta (se houver) */}
        <div className="rounded-lg border p-4">
          <h2 className="text-lg font-semibold">Meta de leitura</h2>
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

        {/* Meta diária (se houver) */}
        <div className="rounded-lg border p-4">
          <h2 className="text-lg font-semibold">Meta diária</h2>
          {used && activeBookId && dailyProgressPercent != null ? (
            <>
              <Progress value={dailyProgressPercent} />
              <p className="text-sm text-muted-foreground mt-2">
                {dailyProgressPercent}% — {achievedWordsToday}/{dailyTargetWords} palavras
                {plan?.targetDateISO ? ` (até ${new Date(plan.targetDateISO).toLocaleDateString('pt-BR')})` : ""}
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">Se tiver uma meta, mostramos seu progresso diário aqui.</p>
          )}
        </div>
      </section>
      <section className="mt-6 grid md:grid-cols-3 gap-6">
        <div className="rounded-lg border p-4">
          <h3 className="text-sm font-medium">Minutos hoje</h3>
          <p className="text-2xl font-bold">{minutesToday} min</p>
        </div>
        <div className="rounded-lg border p-4">
          <h3 className="text-sm font-medium">Livro ativo</h3>
          <p className="text-muted-foreground text-sm">{activeBookId ? (BOOKS.find(b=>b.id===activeBookId)?.title || activeBookId) : "—"}</p>
          {activeBookId && totalBookProgressPercent != null && (
            <div className="mt-2">
              <Progress value={totalBookProgressPercent} />
              <p className="text-sm text-muted-foreground mt-2">Livro: {totalBookProgressPercent}%</p>
            </div>
          )}
        </div>
        {err && (
          <div className="rounded-lg border p-4">
            <h3 className="text-sm font-medium">Status</h3>
            <p className="text-muted-foreground text-sm">{err}</p>
          </div>
        )}
      </section>
      
    </main>
  );
};

export default Index;
