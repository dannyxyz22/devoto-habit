import { differenceInCalendarDays, formatISO, isToday, parseISO } from "date-fns";
import { dataLayer } from "@/services/data/RxDBDataLayer";

export const storage = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(key);
      return v ? (JSON.parse(v) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  set<T>(key: string, value: T) {
    localStorage.setItem(key, JSON.stringify(value));
  },
};

// Reading progress
export type Progress = {
  partIndex: number;
  chapterIndex: number;
  percent: number;
  currentPage?: number;    // For physical books
  totalPages?: number;     // For physical books
};

export const getProgress = (bookId: string): Progress =>
  storage.get<Progress>(`progress:${bookId}`, {
    partIndex: 0,
    chapterIndex: 0,
    percent: 0,
  });

export const setProgress = (bookId: string, p: Progress) =>
  storage.set(`progress:${bookId}`, p);

// Streak - now uses RxDB with localStorage fallback
export type Streak = {
  current: number;
  longest: number;
  lastReadISO: string | null;
  freezeAvailable: boolean;
};

// Get streak from RxDB (async) with localStorage cache
export const getStreakAsync = async (): Promise<Streak> => {
  try {
    const stats = await dataLayer.getUserStats();
    if (stats) {
      return {
        current: stats.streak_current ?? 0,
        longest: stats.streak_longest ?? 0,
        lastReadISO: stats.last_read_iso ?? null,
        freezeAvailable: stats.freeze_available ?? true,
      };
    }
  } catch (e) {
    console.warn('[storage] Failed to get streak from RxDB, using localStorage:', e);
  }
  // Fallback to localStorage
  return storage.get<Streak>("streak", {
    current: 0,
    longest: 0,
    lastReadISO: null,
    freezeAvailable: true,
  });
};

// Sync version for backward compatibility (reads localStorage cache)
export const getStreak = (): Streak =>
  storage.get<Streak>("streak", {
    current: 0,
    longest: 0,
    lastReadISO: null,
    freezeAvailable: true,
  });

export const markReadToday = async () => {
  const s = await getStreakAsync();
  const today = formatISO(new Date(), { representation: "date" });
  if (s.lastReadISO) {
    const last = parseISO(s.lastReadISO);
    const diff = differenceInCalendarDays(new Date(), last);
    if (diff === 0) return s; // already counted today
    if (diff === 1) {
      s.current += 1;
    } else if (diff > 1 && s.freezeAvailable) {
      // Use freeze automatically once
      s.freezeAvailable = false;
      s.current += 1; // keep streak
    } else {
      s.current = 1; // reset
    }
  } else {
    s.current = 1;
  }
  s.lastReadISO = today;
  s.longest = Math.max(s.longest, s.current);

  // Save to RxDB
  try {
    await dataLayer.saveUserStats({
      streak_current: s.current,
      streak_longest: s.longest,
      last_read_iso: s.lastReadISO,
      freeze_available: s.freezeAvailable,
    });
  } catch (e) {
    console.warn('[storage] Failed to save streak to RxDB:', e);
  }
  // Also update localStorage cache
  storage.set("streak", s);
  return s;
};

export const useFreeze = async () => {
  const s = await getStreakAsync();
  s.freezeAvailable = false;
  try {
    await dataLayer.saveUserStats({ freeze_available: false });
  } catch (e) {
    console.warn('[storage] Failed to save freeze to RxDB:', e);
  }
  storage.set("streak", s);
  return s;
};

// Reading time stats - now uses RxDB
export type Stats = {
  minutesByDate: Record<string, number>;
};

export const getStatsAsync = async (): Promise<Stats> => {
  try {
    const stats = await dataLayer.getUserStats();
    if (stats && stats.minutes_by_date) {
      // minutes_by_date is stored as JSON string in RxDB
      const minutesByDate = typeof stats.minutes_by_date === 'string'
        ? JSON.parse(stats.minutes_by_date)
        : stats.minutes_by_date;
      return { minutesByDate: minutesByDate as Record<string, number> };
    }
  } catch (e) {
    console.warn('[storage] Failed to get stats from RxDB:', e);
  }
  return storage.get<Stats>("stats", { minutesByDate: {} });
};

export const getStats = (): Stats => storage.get<Stats>("stats", { minutesByDate: {} });

export const addReadingMinutes = async (ms: number) => {
  const minutes = Math.max(1, Math.round(ms / 60000));
  const s = await getStatsAsync();
  const key = formatISO(new Date(), { representation: "date" });
  s.minutesByDate[key] = (s.minutesByDate[key] || 0) + minutes;

  // Calculate total minutes
  const totalMinutes = Object.values(s.minutesByDate).reduce((a, b) => a + b, 0);

  try {
    await dataLayer.saveUserStats({
      minutes_by_date: JSON.stringify(s.minutesByDate),
      total_minutes: totalMinutes,
    });
  } catch (e) {
    console.warn('[storage] Failed to save reading minutes to RxDB:', e);
  }
  storage.set("stats", s);
  return s;
};


export const hasReadToday = async () => {
  const s = await getStreakAsync();
  return s.lastReadISO ? isToday(parseISO(s.lastReadISO)) : false;
};

// Sync version for backward compatibility
export const hasReadTodaySync = () => {
  const s = getStreak();
  return s.lastReadISO ? isToday(parseISO(s.lastReadISO)) : false;
};

// Reading plan per book - now uses RxDB
export type ReadingPlan = {
  targetDateISO: string | null;
  targetPartIndex?: number;
  targetChapterIndex?: number;
};

export const getReadingPlanAsync = async (bookId: string): Promise<ReadingPlan> => {
  try {
    const plan = await dataLayer.getReadingPlan(bookId);
    if (plan) {
      return {
        targetDateISO: plan.target_date_iso ?? null,
        targetPartIndex: plan.target_part_index,
        targetChapterIndex: plan.target_chapter_index,
      };
    }
  } catch (e) {
    console.warn('[storage] Failed to get reading plan from RxDB:', e);
  }
  return storage.get<ReadingPlan>(`plan:${bookId}`, { targetDateISO: null });
};

// Sync version for backward compatibility
export const getReadingPlan = (bookId: string): ReadingPlan =>
  storage.get<ReadingPlan>(`plan:${bookId}`, { targetDateISO: null });

export const setReadingPlan = async (bookId: string, targetDateISO: string | null, targetPartIndex?: number, targetChapterIndex?: number) => {
  try {
    // If targetDateISO is null or empty string, delete the plan instead of saving
    if (targetDateISO === null || targetDateISO === '' || (typeof targetDateISO === 'string' && targetDateISO.trim() === '')) {
      await dataLayer.deleteReadingPlan(bookId);
      console.log('[storage] 📅 Reading plan deleted:', { bookId });
      storage.set<ReadingPlan>(`plan:${bookId}`, { targetDateISO: null, targetPartIndex, targetChapterIndex });
    } else {
      // Validate date format (should be YYYY-MM-DD)
      if (typeof targetDateISO === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(targetDateISO)) {
        console.warn('[storage] Invalid date format:', targetDateISO);
        throw new Error('Formato de data inválido. Use YYYY-MM-DD');
      }
      await dataLayer.saveReadingPlan({
        book_id: bookId,
        target_date_iso: targetDateISO,
        target_part_index: targetPartIndex,
        target_chapter_index: targetChapterIndex,
      });
      console.log('[storage] 📅 Reading plan saved:', { bookId, targetDateISO });
      storage.set<ReadingPlan>(`plan:${bookId}`, { targetDateISO, targetPartIndex, targetChapterIndex });
    }
  } catch (e) {
    console.warn('[storage] Failed to save/delete reading plan to RxDB:', e);
    throw e; // Re-throw to let UI handle the error
  }
};

// Daily baseline per book - now uses RxDB
export type BaselineEntry = { words: number; percent: number };

const getBaselineMap = (bookId: string): Record<string, BaselineEntry> =>
  storage.get<Record<string, BaselineEntry>>(`baseline:${bookId}`, {});

export const getDailyBaselineAsync = async (bookId: string, dateISO: string): Promise<BaselineEntry | null> => {
  try {
    const baseline = await dataLayer.getDailyBaseline(bookId, dateISO);
    if (baseline) {
      return { words: baseline.words ?? 0, percent: baseline.percent ?? 0 };
    }
  } catch (e) {
    console.warn('[storage] Failed to get daily baseline from RxDB:', e);
  }
  const map = getBaselineMap(bookId);
  return map[dateISO] || null;
};

// Sync version for backward compatibility
export const getDailyBaseline = (bookId: string, dateISO: string): BaselineEntry | null => {
  const map = getBaselineMap(bookId);
  return map[dateISO] || null;
};

export const setDailyBaseline = async (bookId: string, dateISO: string, entry: BaselineEntry) => {
  try {
    await dataLayer.saveDailyBaseline({
      book_id: bookId,
      date_iso: dateISO,
      words: entry.words,
      percent: entry.percent,
    });
  } catch (e) {
    console.warn('[storage] Failed to save daily baseline to RxDB:', e);
  }
  // Also update localStorage cache
  const map = getBaselineMap(bookId);
  map[dateISO] = entry;
  storage.set(`baseline:${bookId}`, map);
};

// Last book ID - now uses RxDB user_stats
export const getLastBookIdAsync = async (): Promise<string | null> => {
  try {
    const stats = await dataLayer.getUserStats();
    if (stats?.last_book_id) {
      return stats.last_book_id;
    }
  } catch (e) {
    console.warn('[storage] Failed to get last book ID from RxDB:', e);
  }
  return localStorage.getItem('lastBookId');
};

export const setLastBookId = async (bookId: string) => {
  console.log('[storage] 🔖 setLastBookId called with:', bookId);

  // Update localStorage cache FIRST for immediate availability
  try {
    localStorage.setItem('lastBookId', bookId);
    console.log('[storage] ✅ localStorage updated with lastBookId:', bookId);
  } catch (e) {
    console.error('[storage] ❌ localStorage update failed:', e);
  }

  // Then persist to RxDB (async)
  try {
    console.log('[storage] 💾 Saving to RxDB user_stats...');
    await dataLayer.saveUserStats({ last_book_id: bookId });
    console.log('[storage] ✅ RxDB user_stats updated with last_book_id:', bookId);
  } catch (e) {
    console.warn('[storage] ❌ Failed to save last book ID to RxDB:', e);
  }
};

// Plan start data (for reading goal calculations)
export type PlanStart = {
  startPercent: number;
  startPartIndex?: number;
  startChapterIndex?: number;
  startWords?: number;
};

export const getPlanStartAsync = async (bookId: string): Promise<PlanStart | null> => {
  try {
    const plan = await dataLayer.getReadingPlan(bookId);
    if (plan && (plan.start_percent !== undefined || plan.start_part_index !== undefined)) {
      return {
        startPercent: plan.start_percent ?? 0,
        startPartIndex: plan.start_part_index,
        startChapterIndex: plan.start_chapter_index,
        startWords: plan.start_words,
      };
    }
  } catch (e) {
    console.warn('[storage] Failed to get plan start from RxDB:', e);
  }
  // Fallback to localStorage
  try {
    const raw = localStorage.getItem(`planStart:${bookId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const setPlanStart = async (bookId: string, start: PlanStart) => {
  try {
    await dataLayer.saveReadingPlan({
      book_id: bookId,
      start_percent: start.startPercent,
      start_part_index: start.startPartIndex,
      start_chapter_index: start.startChapterIndex,
      start_words: start.startWords,
    });
  } catch (e) {
    console.warn('[storage] Failed to save plan start to RxDB:', e);
  }
  // Also update localStorage cache
  try { localStorage.setItem(`planStart:${bookId}`, JSON.stringify(start)); } catch { }
};
