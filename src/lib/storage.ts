import { differenceInCalendarDays, formatISO, isToday, parseISO } from "date-fns";

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

// Streak
export type Streak = {
  current: number;
  longest: number;
  lastReadISO: string | null;
  freezeAvailable: boolean;
};

export const getStreak = (): Streak =>
  storage.get<Streak>("streak", {
    current: 0,
    longest: 0,
    lastReadISO: null,
    freezeAvailable: true,
  });

export const markReadToday = () => {
  const s = getStreak();
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
  storage.set("streak", s);
  return s;
};

export const useFreeze = () => {
  const s = getStreak();
  s.freezeAvailable = false;
  storage.set("streak", s);
  return s;
};

// Reading time stats
export type Stats = {
  minutesByDate: Record<string, number>;
};

export const getStats = (): Stats => storage.get<Stats>("stats", { minutesByDate: {} });

export const addReadingMinutes = (ms: number) => {
  const minutes = Math.max(1, Math.round(ms / 60000));
  const s = getStats();
  const key = formatISO(new Date(), { representation: "date" });
  s.minutesByDate[key] = (s.minutesByDate[key] || 0) + minutes;
  storage.set("stats", s);
  return s;
};

// Reminder configuration (simple local reminder)
export type Reminder = { time: string | null };
export const getReminder = (): Reminder => storage.get<Reminder>("reminder", { time: null });
export const setReminder = (time: string | null) => storage.set("reminder", { time });

export const hasReadToday = () => {
  const s = getStreak();
  return s.lastReadISO ? isToday(parseISO(s.lastReadISO)) : false;
};

// Reading plan per book (optional target end date and chapter)
export type ReadingPlan = {
  targetDateISO: string | null;
  targetPartIndex?: number;
  targetChapterIndex?: number;
};
export const getReadingPlan = (bookId: string): ReadingPlan =>
  storage.get<ReadingPlan>(`plan:${bookId}`, { targetDateISO: null });
export const setReadingPlan = (bookId: string, targetDateISO: string | null, targetPartIndex?: number, targetChapterIndex?: number) =>
  storage.set<ReadingPlan>(`plan:${bookId}`, { targetDateISO, targetPartIndex, targetChapterIndex });

// Daily baseline per book (track start-of-day position for daily goal)
export type BaselineEntry = { words: number; percent: number };
const getBaselineMap = (bookId: string): Record<string, BaselineEntry> =>
  storage.get<Record<string, BaselineEntry>>(`baseline:${bookId}`, {});
export const getDailyBaseline = (bookId: string, dateISO: string): BaselineEntry | null => {
  const map = getBaselineMap(bookId);
  return map[dateISO] || null;
};
export const setDailyBaseline = (bookId: string, dateISO: string, entry: BaselineEntry) => {
  const map = getBaselineMap(bookId);
  map[dateISO] = entry;
  storage.set(`baseline:${bookId}`, map);
};
