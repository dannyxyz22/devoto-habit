import Hero from "@/components/app/Hero";
import { BookCover } from "@/components/book/BookCover";

import { updateDailyProgressWidget } from "@/main";
import { Capacitor } from "@capacitor/core";
import { WidgetUpdater, canUseNative } from "@/lib/widgetUpdater";
import { SEO } from "@/components/app/SEO";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useEffect, useMemo, useState } from "react";
import { Progress } from "@/components/ui/progress";
import { BOOKS, type BookMeta } from "@/lib/books";
import { getUserEpubs } from "@/lib/userEpubs";
import { dataLayer } from "@/services/data/RxDBDataLayer";
import { getDatabase } from "@/lib/database/db";
import { differenceInCalendarDays, formatISO, parseISO } from "date-fns";
import { useTodayISO } from "@/hooks/use-today";
import { getStreak, getReadingPlan, getProgress, getDailyBaseline, setDailyBaseline, getStats, getLastBookIdAsync, setLastBookId, type Streak, type ReadingPlan } from "@/lib/storage";
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
  const [allBooks, setAllBooks] = useState<BookMeta[]>(BOOKS);
  const [parts, setParts] = useState<Part[] | null>(null);
  const [activeIsEpub, setActiveIsEpub] = useState(false);
  const [activeIsPhysical, setActiveIsPhysical] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  
  // Reactive progress from RxDB subscription
  const [activeBookProgress, setActiveBookProgress] = useState<{ partIndex: number; chapterIndex: number; percent: number }>(
    { partIndex: 0, chapterIndex: 0, percent: 0 }
  );
  
  // Reactive plan from RxDB subscription
  const [activePlan, setActivePlan] = useState<ReadingPlan>({ targetDateISO: null });
  
  // Reactive baseline from RxDB subscription
  const todayISO = useTodayISO();
  const [activeBaseline, setActiveBaseline] = useState<{ words: number; percent: number } | null>(null);
  
  // Subscribe to RxDB for reactive progress updates
  useEffect(() => {
    if (!activeBookId) {
      setActiveBookProgress({ partIndex: 0, chapterIndex: 0, percent: 0 });
      return;
    }
    
    // Load initial from localStorage immediately
    const localProgress = getProgress(activeBookId);
    setActiveBookProgress(localProgress);
    
    let subscription: { unsubscribe: () => void } | null = null;
    
    const setupSubscription = async () => {
      try {
        const db = await getDatabase();
        
        // Track if we found anything in RxDB
        let foundInEpubs = false;
        let foundInBooks = false;
        
        // Subscribe to user_epubs for user-uploaded EPUB progress
        const epubSub = db.user_epubs.findOne({
          selector: { id: activeBookId, _deleted: false }
        }).$.subscribe(epub => {
          if (epub) {
            foundInEpubs = true;
            const data = epub.toJSON();
            const dbPercent = data.percentage || 0;
            // Take max of DB and current state (which may have localStorage)
            setActiveBookProgress(prev => ({
              partIndex: 0,
              chapterIndex: 0,
              percent: Math.max(prev.percent, dbPercent)
            }));
          }
        });
        
        // Subscribe to books for physical books and static EPUBs
        const bookSub = db.books.findOne({
          selector: { id: activeBookId, _deleted: false }
        }).$.subscribe(book => {
          if (book) {
            foundInBooks = true;
            const data = book.toJSON();
            const dbPercent = data.percentage || 0;
            // Take max of DB and current state
            setActiveBookProgress(prev => ({
              partIndex: data.part_index || prev.partIndex,
              chapterIndex: data.chapter_index || prev.chapterIndex,
              percent: Math.max(prev.percent, dbPercent)
            }));
          }
        });
        
        // Combine subscriptions
        subscription = {
          unsubscribe: () => {
            epubSub.unsubscribe();
            bookSub.unsubscribe();
          }
        };
      } catch (err) {
        console.error('[Index] Failed to setup RxDB subscription:', err);
      }
    };
    
    setupSubscription();
    
    return () => {
      subscription?.unsubscribe();
    };
  }, [activeBookId]);
  
  // Subscribe to user_stats for reactive streak and lastBookId updates
  useEffect(() => {
    console.log('[Index] 🚀 useEffect user_stats subscription STARTING');
    
    // Load from localStorage immediately
    setStreak(getStreak());
    
    // Also load lastBookId from localStorage immediately
    const cachedLastBookId = localStorage.getItem('lastBookId');
    console.log('[Index] 📦 localStorage lastBookId:', cachedLastBookId);
    if (cachedLastBookId) {
      console.log('[Index] ✅ Setting activeBookId from localStorage:', cachedLastBookId);
      setActiveBookId(cachedLastBookId);
    }
    
    let subscription: { unsubscribe: () => void } | null = null;
    
    const setupSubscription = async () => {
      try {
        console.log('[Index] 🔌 Setting up RxDB user_stats subscription...');
        const db = await getDatabase();
        const sub = db.user_stats.find({
          selector: { _deleted: false }
        }).$.subscribe(docs => {
          console.log('[Index] 📡 user_stats subscription emitted:', docs?.length, 'docs');
          if (docs && docs.length > 0) {
            const stats = docs[0].toJSON();
            console.log('[Index] 📊 user_stats data:', { 
              last_book_id: stats.last_book_id, 
              streak_current: stats.streak_current,
              last_read_iso: stats.last_read_iso 
            });
            setStreak({
              current: stats.streak_current || 0,
              longest: stats.streak_longest || 0,
              lastReadISO: stats.last_read_iso || null,
              freezeAvailable: stats.freeze_available ?? true
            });
            // Always sync activeBookId from user_stats (reactive to local and cloud changes)
            if (stats.last_book_id) {
              console.log('[Index] ✅ Setting activeBookId from RxDB:', stats.last_book_id);
              setActiveBookId(stats.last_book_id);
            } else {
              console.log('[Index] ⚠️ No last_book_id in user_stats');
            }
          } else {
            console.log('[Index] ⚠️ user_stats subscription: no docs found');
          }
        });
        subscription = { unsubscribe: () => sub.unsubscribe() };
        console.log('[Index] ✅ RxDB subscription active');
      } catch (err) {
        console.error('[Index] ❌ Failed to setup user_stats subscription:', err);
      }
    };
    
    setupSubscription();
    
    return () => {
      console.log('[Index] 🧹 Cleaning up user_stats subscription');
      subscription?.unsubscribe();
    };
  }, []); // No dependencies - subscribe once and react to all changes
  
  // Subscribe to reading_plans for reactive plan updates
  useEffect(() => {
    if (!activeBookId) {
      setActivePlan({ targetDateISO: null });
      return;
    }
    
    // Load from localStorage immediately
    setActivePlan(getReadingPlan(activeBookId));
    
    let subscription: { unsubscribe: () => void } | null = null;
    
    const setupSubscription = async () => {
      try {
        const db = await getDatabase();
        const sub = db.reading_plans.findOne({
          selector: { book_id: activeBookId, _deleted: false }
        }).$.subscribe(doc => {
          if (doc) {
            const plan = doc.toJSON();
            setActivePlan({
              targetDateISO: plan.target_date_iso ?? null,
              targetPartIndex: plan.target_part_index,
              targetChapterIndex: plan.target_chapter_index
            });
          }
        });
        subscription = { unsubscribe: () => sub.unsubscribe() };
      } catch (err) {
        console.error('[Index] Failed to setup reading_plans subscription:', err);
      }
    };
    
    setupSubscription();
    
    return () => {
      subscription?.unsubscribe();
    };
  }, [activeBookId]);
  
  // Subscribe to daily_baselines for reactive baseline updates
  useEffect(() => {
    if (!activeBookId) {
      setActiveBaseline(null);
      return;
    }
    
    // Load from localStorage immediately
    const localBaseline = getDailyBaseline(activeBookId, todayISO);
    setActiveBaseline(localBaseline);
    
    let subscription: { unsubscribe: () => void } | null = null;
    
    const setupSubscription = async () => {
      try {
        const db = await getDatabase();
        const baselineId = `${activeBookId}:${todayISO}`;
        const sub = db.daily_baselines.findOne({
          selector: { id: baselineId, _deleted: false }
        }).$.subscribe(doc => {
          if (doc) {
            const baseline = doc.toJSON();
            setActiveBaseline({
              words: baseline.words || 0,
              percent: baseline.percent || 0
            });
          }
        });
        subscription = { unsubscribe: () => sub.unsubscribe() };
      } catch (err) {
        console.error('[Index] Failed to setup daily_baselines subscription:', err);
      }
    };
    
    setupSubscription();
    
    return () => {
      subscription?.unsubscribe();
    };
  }, [activeBookId, todayISO]);

  // Detect prior usage and choose an active book
  useEffect(() => {
    (async () => {
      try {
        const ls = window.localStorage;
        let u = false;
        
        // Check for lastBookId first (most reliable indicator of prior usage)
        const lastBookId = ls.getItem("lastBookId");
        if (lastBookId) {
          u = true;
          console.log('[Index] 🔍 Prior usage detected via lastBookId:', lastBookId);
        }
        
        // Also check legacy patterns
        if (!u) {
          for (let i = 0; i < ls.length; i++) {
            const key = ls.key(i) || "";
            if (key.startsWith("progress:") || key.startsWith("plan:")) { u = true; break; }
          }
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
        
        console.log('[Index] 🔍 Prior usage result:', u);
        setUsed(u);

        // Fallback: if no lastBookId was set via subscription, try to pick first book with plan
        // The subscription from user_stats will set activeBookId if available
        // This is just a fallback for first-time users or when no lastBookId exists
        const last = await getLastBookIdAsync();
        if (!last) {
          for (const b of BOOKS) {
            const plan = getReadingPlan(b.id);
            if (plan?.targetDateISO) { 
              setActiveBookId(b.id); 
              break; 
            }
          }
        }
      } catch { }
    })();
  }, []);

  // Load user books (EPUBs and Physical)
  useEffect(() => {
    const loadBooks = async () => {
      const [userEpubs, rxdbBooks] = await Promise.all([
        getUserEpubs(),
        dataLayer.getBooks(),
      ]);

      const userBooks: BookMeta[] = userEpubs.map(epub => ({
        id: epub.id,
        title: epub.title,
        author: epub.author,
        sourceUrl: URL.createObjectURL(epub.blob),
        description: 'Uploaded by user',
        coverImage: epub.coverUrl,
        type: 'epub' as const,
        isUserUpload: true,
        addedDate: epub.addedDate,
      }));

      const physicalBooksMeta: BookMeta[] = rxdbBooks
        .filter(b => b.type === 'physical')
        .map(book => ({
          id: book.id,
          title: book.title,
          author: book.author || '',
          description: '', // Add if needed
          coverImage: book.cover_url,
          type: 'physical' as const,
          isPhysical: true,
          totalPages: book.total_pages || 0,
          currentPage: book.current_page || 0,
          addedDate: book._modified,
        }));

      setAllBooks([...userBooks, ...physicalBooksMeta, ...BOOKS]);
    };
    loadBooks();
  }, []);

  // Load active book structure to compute progress when needed
  useEffect(() => {
    if (!activeBookId) return;
    const meta = allBooks.find(b => b.id === activeBookId);
    if (!meta) return;

    const isEpub = meta.type === 'epub';
    const isPhysical = meta.type === 'physical';
    setActiveIsEpub(isEpub);
    setActiveIsPhysical(isPhysical);

    if (isEpub || isPhysical) {
      setParts(null);
      return;
    } else {
      const cacheKey = `book:${meta.id}`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        try { setParts(JSON.parse(cached)); return; } catch { }
      }
      setLoading(true);
      fetch(meta.sourceUrl!)
        .then(r => r.json())
        .then(json => {
          localStorage.setItem(cacheKey, JSON.stringify(json));
          setParts(json as Part[]);
        })
        .catch(() => setErr("Falha ao carregar o livro para estatísticas."))
        .finally(() => setLoading(false));
    }
  }, [activeBookId, allBooks]);

  // Use reactive plan from RxDB subscription
  const plan = activePlan;
  // Use reactive progress from RxDB subscription
  const p = activeBookProgress;
  const totalWords = useMemo(() => computeTotalWords(parts), [parts]);

  const isPercentBased = activeIsEpub || activeIsPhysical;

  const wordsUpToCurrent = useMemo(
    () => isPercentBased ? 0 : computeWordsUpToPosition(parts, { partIndex: p.partIndex, chapterIndex: p.chapterIndex }),
    [isPercentBased, parts, p]
  );
  const targetWords = useMemo(
    () => isPercentBased ? 0 : computeWordsUpToInclusiveTarget(parts, { targetPartIndex: plan.targetPartIndex, targetChapterIndex: plan.targetChapterIndex }, totalWords),
    [isPercentBased, parts, plan, totalWords]
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
  // Note: todayISO is defined at the top of the component
  // Use reactive baseline from RxDB subscription, with fallback
  const baselineForToday = useMemo(() => {
    if (!activeBookId) return isPercentBased ? (p.percent || 0) : wordsUpToCurrent;
    // Use reactive baseline from subscription
    if (activeBaseline) return isPercentBased ? activeBaseline.percent : activeBaseline.words;
    // Fallback to localStorage
    const base = getDailyBaseline(activeBookId, todayISO);
    if (base) return isPercentBased ? base.percent : base.words;
    return isPercentBased ? (p.percent || 0) : wordsUpToCurrent;
  }, [activeBookId, isPercentBased, todayISO, wordsUpToCurrent, p.percent, activeBaseline]);

  // Persist baseline if missing, with guards and logs
  useEffect(() => {
    if (!activeBookId) return;
    const base = getDailyBaseline(activeBookId, todayISO);
    if (base) {
      try { console.log('[Baseline] existente', { scope: 'Index', bookId: activeBookId, todayISO, base }); } catch { }
      return;
    }
    const hasProgress = isPercentBased ? ((p?.percent ?? 0) > 0) : (wordsUpToCurrent > 0);
    if (!parts && !isPercentBased) {
      try { console.log('[Baseline] skip persist: parts não carregadas', { scope: 'Index', bookId: activeBookId, todayISO, wordsUpToCurrent, p, isPercentBased }); } catch { }
      return;
    }
    if (!hasProgress) {
      try { console.log('[Baseline] skip persist: sem progresso ainda', { scope: 'Index', bookId: activeBookId, todayISO, wordsUpToCurrent, percent: p.percent, isPercentBased }); } catch { }
      return;
    }
    // Use consistent percent: EPUB/Physical uses p.percent; non-EPUB uses words-based totalBookProgressPercent
    const baselinePercent = isPercentBased ? (p.percent || 0) : (parts ? Math.min(100, Math.round((wordsUpToCurrent / Math.max(1, totalWords)) * 100)) : 0);
    setDailyBaseline(activeBookId, todayISO, { words: wordsUpToCurrent, percent: baselinePercent });
    try { console.log('[Baseline] persistida', { scope: 'Index', bookId: activeBookId, todayISO, words: wordsUpToCurrent, percent: baselinePercent, isPercentBased }); } catch { }
  }, [activeBookId, todayISO, parts, isPercentBased, wordsUpToCurrent, p.percent, totalWords]);

  const daysRemaining = useMemo(() => computeDaysRemaining(plan?.targetDateISO), [plan]);
  // EPUB/Physical daily target uses percentage instead of words
  const dailyTargetWords = useMemo(
    () => isPercentBased
      ? (daysRemaining ? Math.ceil(Math.max(0, 100 - (baselineForToday || 0)) / daysRemaining) : null)
      : computeDailyTargetWords(targetWords, baselineForToday, daysRemaining),
    [isPercentBased, targetWords, baselineForToday, daysRemaining]
  );
  const achievedWordsToday = useMemo(
    () => isPercentBased ? Math.max(0, (p.percent || 0) - (baselineForToday || 0)) : computeAchievedWordsToday(wordsUpToCurrent, baselineForToday),
    [isPercentBased, p.percent, baselineForToday, wordsUpToCurrent]
  );
  const dailyProgressPercent = useMemo(
    () => computeDailyProgressPercent(achievedWordsToday, dailyTargetWords),
    [achievedWordsToday, dailyTargetWords]
  );
  const planProgressPercent = useMemo(() => {
    if (isPercentBased) {
      // From plan start percent to 100% target
      const rawStart = planStart?.startWords != null ? planStart.startWords : null; // for type narrowing only
      const startPercent = (() => { try { const raw = localStorage.getItem(`planStart:${activeBookId}`); const j = raw ? JSON.parse(raw) : null; return j?.startPercent ?? 0; } catch { return 0; } })();
      const denom = Math.max(1, 100 - startPercent);
      const num = Math.max(0, (p.percent || 0) - startPercent);
      return Math.min(100, Math.round((num / denom) * 100));
    }
    return computePlanProgressPercent(parts, wordsUpToCurrent, targetWords, planStart);
  }, [isPercentBased, parts, wordsUpToCurrent, targetWords, planStart, p.percent, activeBookId]);

  const totalBookProgressPercent = useMemo(() => isPercentBased ? (p.percent || 0) : (parts ? Math.min(100, Math.round((wordsUpToCurrent / Math.max(1, totalWords)) * 100)) : null), [isPercentBased, parts, wordsUpToCurrent, totalWords, p.percent]);

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
      } catch { }
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
                {dailyProgressPercent}% — {achievedWordsToday}/{dailyTargetWords} {isPercentBased ? "%" : "palavras"}
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
              {!isPercentBased && parts && plan?.targetPartIndex != null && (
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
              <p className="text-muted-foreground text-sm">{activeBookId ? (allBooks.find(b => b.id === activeBookId)?.title || activeBookId) : "—"}</p>
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
            isPercentBased ? (
              <>
                <p className="text-sm text-muted-foreground mt-1">{p.percent || 0}% lido</p>
                <div className="mt-2">
                  <Button asChild variant="link">
                    <Link to={activeIsPhysical ? `/physical/${activeBookId}` : `/epub/${activeBookId}`} onClick={() => setLastBookId(activeBookId)}>Continuar leitura</Link>
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
                    <Link to={`/leitor/${activeBookId}`} onClick={() => setLastBookId(activeBookId)}>Continuar leitura</Link>
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
