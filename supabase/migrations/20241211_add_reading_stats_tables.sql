-- Migration: Add reading_plans, daily_baselines, user_stats tables
-- Run this in the Supabase SQL Editor

-- ============================================
-- Reading Plans Table
-- ============================================
CREATE TABLE IF NOT EXISTS reading_plans (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL,
  target_date_iso TEXT,
  target_part_index INTEGER,
  target_chapter_index INTEGER,
  start_part_index INTEGER,
  start_chapter_index INTEGER,
  start_words INTEGER,
  start_percent REAL,
  _modified BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  _deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE(user_id, book_id)
);

-- RLS policies for reading_plans
ALTER TABLE reading_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own reading plans"
  ON reading_plans FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own reading plans"
  ON reading_plans FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own reading plans"
  ON reading_plans FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own reading plans"
  ON reading_plans FOR DELETE
  USING (auth.uid() = user_id);

-- Indexes for reading_plans
CREATE INDEX IF NOT EXISTS idx_reading_plans_modified ON reading_plans(_modified);
CREATE INDEX IF NOT EXISTS idx_reading_plans_user_book ON reading_plans(user_id, book_id);

-- ============================================
-- Daily Baselines Table
-- ============================================
CREATE TABLE IF NOT EXISTS daily_baselines (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL,
  date_iso TEXT NOT NULL,
  words INTEGER NOT NULL DEFAULT 0,
  percent REAL NOT NULL DEFAULT 0,
  _modified BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  _deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE(user_id, book_id, date_iso)
);

-- RLS policies for daily_baselines
ALTER TABLE daily_baselines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own baselines"
  ON daily_baselines FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own baselines"
  ON daily_baselines FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own baselines"
  ON daily_baselines FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own baselines"
  ON daily_baselines FOR DELETE
  USING (auth.uid() = user_id);

-- Indexes for daily_baselines
CREATE INDEX IF NOT EXISTS idx_daily_baselines_modified ON daily_baselines(_modified);
CREATE INDEX IF NOT EXISTS idx_daily_baselines_user_book ON daily_baselines(user_id, book_id);

-- ============================================
-- User Stats Table
-- ============================================
CREATE TABLE IF NOT EXISTS user_stats (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  streak_current INTEGER NOT NULL DEFAULT 0,
  streak_longest INTEGER NOT NULL DEFAULT 0,
  last_read_iso TEXT,
  freeze_available BOOLEAN NOT NULL DEFAULT TRUE,
  total_minutes INTEGER NOT NULL DEFAULT 0,
  last_book_id TEXT,
  minutes_by_date JSONB NOT NULL DEFAULT '{}'::jsonb,
  _modified BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  _deleted BOOLEAN NOT NULL DEFAULT FALSE
);

-- RLS policies for user_stats
ALTER TABLE user_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own stats"
  ON user_stats FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own stats"
  ON user_stats FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own stats"
  ON user_stats FOR UPDATE
  USING (auth.uid() = user_id);

-- Index for user_stats
CREATE INDEX IF NOT EXISTS idx_user_stats_modified ON user_stats(_modified);

-- ============================================
-- Enable Realtime for new tables (optional but recommended)
-- ============================================
-- Uncomment these if you want real-time sync across devices:
-- ALTER PUBLICATION supabase_realtime ADD TABLE reading_plans;
-- ALTER PUBLICATION supabase_realtime ADD TABLE daily_baselines;
-- ALTER PUBLICATION supabase_realtime ADD TABLE user_stats;
