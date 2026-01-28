-- ============================================
-- Smart Diary database schema
-- ============================================

CREATE TABLE IF NOT EXISTS diaries (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  title TEXT,
  content TEXT,
  raw_content TEXT,
  mode TEXT NOT NULL DEFAULT 'traditional',
  stress_level INTEGER,
  weather TEXT,
  tags TEXT DEFAULT '[]',
  word_count INTEGER DEFAULT 0,
  conversation_id TEXT,
  is_generated INTEGER DEFAULT 0,
  is_edited INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  is_deleted INTEGER DEFAULT 0,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

CREATE INDEX IF NOT EXISTS idx_diaries_date ON diaries(date);
CREATE INDEX IF NOT EXISTS idx_diaries_mode ON diaries(mode);
CREATE INDEX IF NOT EXISTS idx_diaries_deleted ON diaries(is_deleted);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  diary_id TEXT,
  date TEXT NOT NULL,
  messages TEXT NOT NULL DEFAULT '[]',
  message_count INTEGER DEFAULT 0,
  duration_minutes INTEGER,
  extracted_info TEXT DEFAULT '{}',
  ai_provider TEXT,
  ai_model TEXT,
  state TEXT DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversations_date ON conversations(date);
CREATE INDEX IF NOT EXISTS idx_conversations_diary ON conversations(diary_id);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT DEFAULT 'medium',
  status TEXT DEFAULT 'not_started',
  deadline TEXT,
  completion_note TEXT,
  completed_at TEXT,
  conversation_id TEXT,
  diary_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  is_deleted INTEGER DEFAULT 0,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id),
  FOREIGN KEY (diary_id) REFERENCES diaries(id)
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_deadline ON tasks(deadline);
CREATE INDEX IF NOT EXISTS idx_tasks_deleted ON tasks(is_deleted);

CREATE TABLE IF NOT EXISTS weekly_reports (
  id TEXT PRIMARY KEY,
  week_start TEXT NOT NULL,
  week_end TEXT NOT NULL,
  report_content TEXT,
  stats TEXT DEFAULT '{}',
  ai_provider TEXT,
  ai_model TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reports_week ON weekly_reports(week_start);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT
);

INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES
  ('app_mode', 'traditional', datetime('now')),
  ('first_launch', 'true', datetime('now')),
  ('theme', 'light', datetime('now')),
  ('ai_provider', NULL, datetime('now')),
  ('ai_api_key', NULL, datetime('now')),
  ('ai_base_url', NULL, datetime('now')),
  ('ai_model', 'gpt-4', datetime('now')),
  ('encryption_enabled', 'false', datetime('now')),
  ('auto_backup', 'true', datetime('now')),
  ('backup_interval_days', '7', datetime('now'));
