import { randomUUID } from "crypto";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { app } from "electron";

type DiaryMode = "traditional" | "ai";

type AppSettings = {
  appMode: DiaryMode;
  firstLaunch: boolean;
  theme: "light" | "dark";
  aiProvider: "openai" | "claude" | "deepseek" | "local" | null;
  aiApiKey: string | null;
  aiBaseUrl: string | null;
  aiModel: string;
  encryptionEnabled: boolean;
  autoBackup: boolean;
  backupIntervalDays: number;
};

type DiaryCreateInput = {
  date?: string;
  title?: string;
  content: string;
  stressLevel?: number;
  weather?: string;
  tags?: string[];
  mode: DiaryMode;
  conversationId?: string;
  isGenerated?: boolean;
};

type DiaryUpdateInput = {
  title?: string;
  content?: string;
  stressLevel?: number;
  weather?: string;
  tags?: string[];
  isEdited?: boolean;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
};

type ExtractedTodo = {
  title: string;
  dueDate?: string;
  priority?: "low" | "medium" | "high" | "urgent";
  notes?: string;
};

type ExtractedInfo = {
  events: string[];
  people: string[];
  locations: string[];
  todos: ExtractedTodo[];
  dismissedTodos?: string[];
};

type TaskPriority = "low" | "medium" | "high" | "urgent";
type TaskStatus = "not_started" | "in_progress" | "completed";

type TaskCreateInput = {
  title: string;
  description?: string;
  priority?: TaskPriority;
  deadline?: string | null;
  conversationId?: string;
};

type DiaryRow = {
  id: string;
  date: string;
  title: string | null;
  content: string | null;
  raw_content: string | null;
  mode: DiaryMode;
  stress_level: number | null;
  weather: string | null;
  tags: string | null;
  word_count: number | null;
  conversation_id: string | null;
  is_generated: number | null;
  is_edited: number | null;
  created_at: string;
  updated_at: string;
  is_deleted: number | null;
};

type ConversationRow = {
  id: string;
  diary_id: string | null;
  date: string;
  messages: string;
  message_count: number | null;
  duration_minutes: number | null;
  extracted_info: string | null;
  ai_provider: string | null;
  ai_model: string | null;
  state: string | null;
  created_at: string;
  updated_at: string;
};

const ACTIVE_CONVERSATION_FILTER = "state IS NULL OR state != 'archived'";

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  priority: TaskPriority | null;
  status: TaskStatus | null;
  deadline: string | null;
  completion_note: string | null;
  completed_at: string | null;
  conversation_id: string | null;
  diary_id: string | null;
  created_at: string;
  updated_at: string;
  is_deleted: number | null;
};

type WeeklyReportContent = {
  title: string;
  summary: string;
  highlights: string[];
  improvements: string[];
  nextWeekPlan: string[];
};

type WeeklyReportStats = {
  diaryCount: number;
  totalWords: number;
  averageStress: number;
  topTags: string[];
  taskStats: {
    total: number;
    completed: number;
    completionRate: number;
  };
  conversationStats: {
    totalRounds: number;
    averageDuration: number;
  };
};

type WeeklyReportRow = {
  id: string;
  week_start: string;
  week_end: string;
  report_content: string | null;
  stats: string | null;
  ai_provider: string | null;
  ai_model: string | null;
  created_at: string;
};

export type DiaryRecord = {
  id: string;
  date: string;
  title: string | null;
  content: string | null;
  rawContent: string | null;
  mode: DiaryMode;
  stressLevel: number | null;
  weather: string | null;
  tags: string[];
  wordCount: number;
  conversationId: string | null;
  isGenerated: boolean;
  isEdited: boolean;
  createdAt: string;
  updatedAt: string;
  isDeleted: boolean;
};

export type ConversationRecord = {
  id: string;
  diaryId: string | null;
  date: string;
  messages: ChatMessage[];
  messageCount: number;
  durationMinutes: number | null;
  extractedInfo: ExtractedInfo;
  aiProvider: string | null;
  aiModel: string | null;
  state: "active" | "summarized" | "archived";
  createdAt: string;
  updatedAt: string;
};

export type WeeklyReportRecord = {
  id: string;
  weekStart: string;
  weekEnd: string;
  reportContent: WeeklyReportContent | null;
  stats: WeeklyReportStats;
  aiProvider: string | null;
  aiModel: string | null;
  createdAt: string;
};

export type TaskRecord = {
  id: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  deadline: string | null;
  completionNote: string | null;
  completedAt: string | null;
  conversationId: string | null;
  diaryId: string | null;
  createdAt: string;
  updatedAt: string;
  isDeleted: boolean;
};

type SettingRow = {
  key: string;
  value: string | null;
};

const DEFAULT_SETTINGS: AppSettings = {
  appMode: "traditional",
  firstLaunch: true,
  theme: "light",
  aiProvider: null,
  aiApiKey: null,
  aiBaseUrl: null,
  aiModel: "gpt-4",
  encryptionEnabled: false,
  autoBackup: true,
  backupIntervalDays: 7
};

const SETTINGS_KEYS: Record<keyof AppSettings, string> = {
  appMode: "app_mode",
  firstLaunch: "first_launch",
  theme: "theme",
  aiProvider: "ai_provider",
  aiApiKey: "ai_api_key",
  aiBaseUrl: "ai_base_url",
  aiModel: "ai_model",
  encryptionEnabled: "encryption_enabled",
  autoBackup: "auto_backup",
  backupIntervalDays: "backup_interval_days"
};

let db: Database.Database | null = null;

export function getDatabasePath() {
  return path.join(app.getPath("userData"), "smart-diary.sqlite");
}

export function initDatabase() {
  if (db) {
    return db;
  }

  const dbPath = getDatabasePath();
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const schemaPath = resolveSchemaPath();
  const schemaSql = fs.readFileSync(schemaPath, "utf-8");
  db.exec(schemaSql);

  return db;
}

export async function backupDatabaseFile(targetPath: string) {
  const instance = initDatabase();
  await instance.backup(targetPath);
}

export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

function getDb() {
  if (!db) {
    throw new Error("Database not initialized");
  }
  return db;
}

function resolveSchemaPath() {
  const appPath = app.getAppPath();
  const appSchema = path.join(appPath, "database", "schema.sql");
  if (fs.existsSync(appSchema)) {
    return appSchema;
  }

  const resourcesSchema = path.join(process.resourcesPath, "database", "schema.sql");
  if (fs.existsSync(resourcesSchema)) {
    return resourcesSchema;
  }

  throw new Error("schema.sql not found");
}

function safeJsonParse<T>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function countWords(input: string) {
  const trimmed = input.trim();
  if (!trimmed) {
    return 0;
  }
  return trimmed.split(/\s+/).length;
}

function mapDiaryRow(row: DiaryRow): DiaryRecord {
  return {
    id: row.id,
    date: row.date,
    title: row.title,
    content: row.content,
    rawContent: row.raw_content,
    mode: row.mode,
    stressLevel: row.stress_level,
    weather: row.weather,
    tags: safeJsonParse<string[]>(row.tags, []),
    wordCount: row.word_count ?? 0,
    conversationId: row.conversation_id,
    isGenerated: row.is_generated === 1,
    isEdited: row.is_edited === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isDeleted: row.is_deleted === 1
  };
}

function mapConversationRow(row: ConversationRow): ConversationRecord {
  const messages = safeJsonParse<ChatMessage[]>(row.messages, []);
  const extractedInfo = safeJsonParse<ExtractedInfo>(row.extracted_info, {
    events: [],
    people: [],
    locations: [],
    todos: [],
    dismissedTodos: []
  });
  return {
    id: row.id,
    diaryId: row.diary_id,
    date: row.date,
    messages,
    messageCount: row.message_count ?? messages.length,
    durationMinutes: row.duration_minutes,
    extractedInfo,
    aiProvider: row.ai_provider,
    aiModel: row.ai_model,
    state: (row.state as ConversationRecord["state"]) ?? "active",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapTaskRow(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    priority: row.priority ?? "medium",
    status: row.status ?? "not_started",
    deadline: row.deadline,
    completionNote: row.completion_note,
    completedAt: row.completed_at,
    conversationId: row.conversation_id,
    diaryId: row.diary_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isDeleted: row.is_deleted === 1
  };
}

function buildEmptyWeeklyStats(): WeeklyReportStats {
  return {
    diaryCount: 0,
    totalWords: 0,
    averageStress: 0,
    topTags: [],
    taskStats: {
      total: 0,
      completed: 0,
      completionRate: 0
    },
    conversationStats: {
      totalRounds: 0,
      averageDuration: 0
    }
  };
}

function mapWeeklyReportRow(row: WeeklyReportRow): WeeklyReportRecord {
  const stats = safeJsonParse<WeeklyReportStats>(row.stats, buildEmptyWeeklyStats());
  const reportContent = safeJsonParse<WeeklyReportContent | null>(
    row.report_content,
    null
  );

  return {
    id: row.id,
    weekStart: row.week_start,
    weekEnd: row.week_end,
    reportContent,
    stats,
    aiProvider: row.ai_provider,
    aiModel: row.ai_model,
    createdAt: row.created_at
  };
}

export function getSettings(): AppSettings {
  const rows = getDb()
    .prepare("SELECT key, value FROM settings")
    .all() as SettingRow[];
  const map = new Map(rows.map((row) => [row.key, row.value]));

  const appMode =
    map.get(SETTINGS_KEYS.appMode) === "ai" ? "ai" : DEFAULT_SETTINGS.appMode;
  const theme =
    map.get(SETTINGS_KEYS.theme) === "dark" ? "dark" : DEFAULT_SETTINGS.theme;

  return {
    appMode,
    firstLaunch: parseBoolean(
      map.get(SETTINGS_KEYS.firstLaunch),
      DEFAULT_SETTINGS.firstLaunch
    ),
    theme,
    aiProvider: (map.get(SETTINGS_KEYS.aiProvider) as AppSettings["aiProvider"]) ??
      DEFAULT_SETTINGS.aiProvider,
    aiApiKey:
      map.get(SETTINGS_KEYS.aiApiKey) ?? DEFAULT_SETTINGS.aiApiKey,
    aiBaseUrl:
      map.get(SETTINGS_KEYS.aiBaseUrl) ?? DEFAULT_SETTINGS.aiBaseUrl,
    aiModel: map.get(SETTINGS_KEYS.aiModel) ?? DEFAULT_SETTINGS.aiModel,
    encryptionEnabled: parseBoolean(
      map.get(SETTINGS_KEYS.encryptionEnabled),
      DEFAULT_SETTINGS.encryptionEnabled
    ),
    autoBackup: parseBoolean(
      map.get(SETTINGS_KEYS.autoBackup),
      DEFAULT_SETTINGS.autoBackup
    ),
    backupIntervalDays: parseNumber(
      map.get(SETTINGS_KEYS.backupIntervalDays),
      DEFAULT_SETTINGS.backupIntervalDays
    )
  };
}

export function setSettings(input: Partial<AppSettings>): AppSettings {
  const statement = getDb().prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (@key, @value, datetime('now')) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  );

  const updates = Object.entries(SETTINGS_KEYS)
    .map(([property, key]) => {
      const value = input[property as keyof AppSettings];
      if (value === undefined) {
        return null;
      }
      return {
        key,
        value: serializeSettingValue(value)
      };
    })
    .filter((entry): entry is { key: string; value: string | null } => entry !== null);

  if (updates.length === 0) {
    return getSettings();
  }

  const tx = getDb().transaction(() => {
    for (const update of updates) {
      statement.run(update);
    }
  });
  tx();

  return getSettings();
}

function serializeSettingValue(value: AppSettings[keyof AppSettings]) {
  if (value === null) {
    return null;
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    return String(value);
  }
  return String(value);
}

function parseBoolean(value: string | null | undefined, fallback: boolean) {
  if (value === null || value === undefined) {
    return fallback;
  }
  return value === "true" || value === "1";
}

function parseNumber(value: string | null | undefined, fallback: number) {
  if (value === null || value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeDueDate(value?: string | null) {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed === "未知") {
    return null;
  }
  return trimmed;
}

export function createConversation(): ConversationRecord {
  const now = new Date().toISOString();
  const date = now.slice(0, 10);
  const settings = getSettings();
  const id = randomUUID();

  getDb()
    .prepare(
      `INSERT INTO conversations (
        id, diary_id, date, messages, message_count, duration_minutes, extracted_info,
        ai_provider, ai_model, state, created_at, updated_at
      ) VALUES (
        @id, NULL, @date, @messages, @message_count, NULL, @extracted_info,
        @ai_provider, @ai_model, @state, @created_at, @updated_at
      )`
    )
    .run({
      id,
      date,
      messages: "[]",
      message_count: 0,
      extracted_info: JSON.stringify({
        events: [],
        people: [],
        locations: [],
        todos: [],
        dismissedTodos: []
      }),
      ai_provider: settings.aiProvider ?? "openai",
      ai_model: settings.aiModel,
      state: "active",
      created_at: now,
      updated_at: now
    });

  const row = getDb()
    .prepare("SELECT * FROM conversations WHERE id = ?")
    .get(id) as ConversationRow;

  return mapConversationRow(row);
}

export function appendConversationMessage(
  conversationId: string,
  message: ChatMessage
): ConversationRecord | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM conversations WHERE id = ? AND (${ACTIVE_CONVERSATION_FILTER})`
    )
    .get(conversationId) as ConversationRow | undefined;
  if (!row) {
    return null;
  }

  const messages = safeJsonParse<ChatMessage[]>(row.messages, []);
  const nextMessage: ChatMessage = {
    id: message.id,
    role: message.role,
    content: message.content,
    timestamp: message.timestamp || new Date().toISOString()
  };
  messages.push(nextMessage);

  getDb()
    .prepare(
      "UPDATE conversations SET messages = ?, message_count = ?, updated_at = ? WHERE id = ?"
    )
    .run(
      JSON.stringify(messages),
      messages.length,
      new Date().toISOString(),
      conversationId
    );

  return getConversation(conversationId);
}

export function getConversation(id: string): ConversationRecord | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM conversations WHERE id = ? AND (${ACTIVE_CONVERSATION_FILTER})`
    )
    .get(id) as ConversationRow | undefined;

  return row ? mapConversationRow(row) : null;
}

export function listConversations(): ConversationRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM conversations WHERE ${ACTIVE_CONVERSATION_FILTER} ORDER BY updated_at DESC`
    )
    .all() as ConversationRow[];

  return rows.map(mapConversationRow);
}

export function updateConversationExtractedInfo(
  conversationId: string,
  extractedInfo: ExtractedInfo
) {
  getDb()
    .prepare(
      `UPDATE conversations SET extracted_info = ?, updated_at = ? WHERE id = ? AND (${ACTIVE_CONVERSATION_FILTER})`
    )
    .run(
      JSON.stringify(extractedInfo),
      new Date().toISOString(),
      conversationId
    );
}

export function archiveConversation(id: string): boolean {
  const result = getDb()
    .prepare(
      `UPDATE conversations SET state = 'archived', updated_at = ? WHERE id = ? AND (${ACTIVE_CONVERSATION_FILTER})`
    )
    .run(new Date().toISOString(), id);
  return result.changes > 0;
}

export function createTask(input: TaskCreateInput): TaskRecord {
  const now = new Date().toISOString();
  const id = randomUUID();

  getDb()
    .prepare(
      `INSERT INTO tasks (
        id, title, description, priority, status, deadline, completion_note,
        completed_at, conversation_id, diary_id, created_at, updated_at, is_deleted
      ) VALUES (
        @id, @title, @description, @priority, @status, @deadline, NULL,
        NULL, @conversation_id, NULL, @created_at, @updated_at, 0
      )`
    )
    .run({
      id,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority ?? "medium",
      status: "not_started",
      deadline: normalizeDueDate(input.deadline),
      conversation_id: input.conversationId ?? null,
      created_at: now,
      updated_at: now
    });

  const row = getDb()
    .prepare("SELECT * FROM tasks WHERE id = ?")
    .get(id) as TaskRow;

  return mapTaskRow(row);
}

export function listTasks(): TaskRecord[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM tasks WHERE is_deleted = 0 ORDER BY created_at DESC"
    )
    .all() as TaskRow[];

  return rows.map(mapTaskRow);
}

export function updateTask(
  id: string,
  input: {
    priority?: TaskPriority;
    deadline?: string | null;
  }
): TaskRecord | null {
  const fields: string[] = [];
  const values: Record<string, unknown> = {
    id,
    updated_at: new Date().toISOString()
  };

  if (input.priority !== undefined) {
    fields.push("priority = @priority");
    values.priority = input.priority;
  }

  if (input.deadline !== undefined) {
    fields.push("deadline = @deadline");
    values.deadline = input.deadline;
  }

  if (fields.length === 0) {
    const row = getDb()
      .prepare("SELECT * FROM tasks WHERE id = ? AND is_deleted = 0")
      .get(id) as TaskRow | undefined;
    return row ? mapTaskRow(row) : null;
  }

  fields.push("updated_at = @updated_at");

  const result = getDb()
    .prepare(
      `UPDATE tasks SET ${fields.join(", ")} WHERE id = @id AND is_deleted = 0`
    )
    .run(values);

  if (result.changes === 0) {
    return null;
  }

  const row = getDb()
    .prepare("SELECT * FROM tasks WHERE id = ?")
    .get(id) as TaskRow;

  return mapTaskRow(row);
}

export function completeTask(id: string): TaskRecord | null {
  const now = new Date().toISOString();
  const result = getDb()
    .prepare(
      "UPDATE tasks SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ? AND is_deleted = 0"
    )
    .run(now, now, id);

  if (result.changes === 0) {
    return null;
  }

  const row = getDb()
    .prepare("SELECT * FROM tasks WHERE id = ?")
    .get(id) as TaskRow;

  return mapTaskRow(row);
}

export function deleteTask(id: string): boolean {
  const now = new Date().toISOString();
  const result = getDb()
    .prepare("UPDATE tasks SET is_deleted = 1, updated_at = ? WHERE id = ?")
    .run(now, id);

  return result.changes > 0;
}

export function linkConversationToDiary(conversationId: string, diaryId: string) {
  getDb()
    .prepare("UPDATE conversations SET diary_id = ?, updated_at = ? WHERE id = ?")
    .run(diaryId, new Date().toISOString(), conversationId);
}

export function createDiary(input: DiaryCreateInput): DiaryRecord {
  const now = new Date().toISOString();
  const date = input.date ?? now.slice(0, 10);
  const tags = JSON.stringify(input.tags ?? []);
  const id = randomUUID();
  const wordCount = countWords(input.content);

  getDb()
    .prepare(
      `INSERT INTO diaries (
        id, date, title, content, raw_content, mode, stress_level, weather,
        tags, word_count, conversation_id, is_generated, is_edited, created_at,
        updated_at, is_deleted
      ) VALUES (
        @id, @date, @title, @content, @raw_content, @mode, @stress_level, @weather,
        @tags, @word_count, @conversation_id, @is_generated, @is_edited, @created_at,
        @updated_at, 0
      )`
    )
    .run({
      id,
      date,
      title: input.title ?? null,
      content: input.content,
      raw_content: input.content,
      mode: input.mode,
      stress_level: input.stressLevel ?? null,
      weather: input.weather ?? null,
      tags,
      word_count: wordCount,
      conversation_id: input.conversationId ?? null,
      is_generated: input.isGenerated ? 1 : 0,
      is_edited: 0,
      created_at: now,
      updated_at: now
    });

  const row = getDb()
    .prepare("SELECT * FROM diaries WHERE id = ?")
    .get(id) as DiaryRow;

  return mapDiaryRow(row);
}

export function updateDiary(
  id: string,
  input: DiaryUpdateInput
): DiaryRecord | null {
  const fields: string[] = [];
  const values: Record<string, unknown> = {
    id,
    updated_at: new Date().toISOString()
  };

  if (input.title !== undefined) {
    fields.push("title = @title");
    values.title = input.title ?? null;
  }

  if (input.content !== undefined) {
    fields.push("content = @content");
    fields.push("raw_content = @raw_content");
    fields.push("word_count = @word_count");
    values.content = input.content;
    values.raw_content = input.content;
    values.word_count = input.content ? countWords(input.content) : 0;
  }

  if (input.stressLevel !== undefined) {
    fields.push("stress_level = @stress_level");
    values.stress_level = input.stressLevel ?? null;
  }

  if (input.weather !== undefined) {
    fields.push("weather = @weather");
    values.weather = input.weather ?? null;
  }

  if (input.tags !== undefined) {
    fields.push("tags = @tags");
    values.tags = JSON.stringify(input.tags ?? []);
  }

  if (input.isEdited !== undefined) {
    fields.push("is_edited = @is_edited");
    values.is_edited = input.isEdited ? 1 : 0;
  }

  if (fields.length === 0) {
    return getDiary(id);
  }

  fields.push("updated_at = @updated_at");

  const statement = getDb().prepare(
    `UPDATE diaries SET ${fields.join(", ")} WHERE id = @id AND is_deleted = 0`
  );
  const result = statement.run(values);
  if (result.changes === 0) {
    return null;
  }

  return getDiary(id);
}

export function getDiary(id: string): DiaryRecord | null {
  const row = getDb()
    .prepare("SELECT * FROM diaries WHERE id = ? AND is_deleted = 0")
    .get(id) as DiaryRow | undefined;

  return row ? mapDiaryRow(row) : null;
}

export function listDiaries(): DiaryRecord[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM diaries WHERE is_deleted = 0 ORDER BY date DESC, created_at DESC"
    )
    .all() as DiaryRow[];

  return rows.map(mapDiaryRow);
}

export function deleteDiary(id: string): boolean {
  const result = getDb()
    .prepare(
      "UPDATE diaries SET is_deleted = 1, updated_at = ? WHERE id = ? AND is_deleted = 0"
    )
    .run(new Date().toISOString(), id);

  return result.changes > 0;
}

export function getWeeklyReportStats(
  weekStart: string,
  weekEnd: string
): WeeklyReportStats {
  const diaryRows = getDb()
    .prepare(
      "SELECT stress_level, tags, word_count FROM diaries WHERE is_deleted = 0 AND date >= ? AND date <= ?"
    )
    .all(weekStart, weekEnd) as Array<{
    stress_level: number | null;
    tags: string | null;
    word_count: number | null;
  }>;

  let stressSum = 0;
  let stressCount = 0;
  let totalWords = 0;
  const tagCounts = new Map<string, number>();

  for (const row of diaryRows) {
    if (typeof row.stress_level === "number") {
      stressSum += row.stress_level;
      stressCount += 1;
    }
    totalWords += row.word_count ?? 0;

    const tags = safeJsonParse<string[]>(row.tags, []);
    for (const tag of tags) {
      if (!tag) {
        continue;
      }
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }

  const topTags = Array.from(tagCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag]) => tag);

  const totalTasksRow = getDb()
    .prepare(
      "SELECT COUNT(*) as count FROM tasks WHERE is_deleted = 0 AND date(created_at) >= ? AND date(created_at) <= ?"
    )
    .get(weekStart, weekEnd) as { count: number };
  const completedTasksRow = getDb()
    .prepare(
      "SELECT COUNT(*) as count FROM tasks WHERE is_deleted = 0 AND status = 'completed' AND completed_at IS NOT NULL AND date(completed_at) >= ? AND date(completed_at) <= ?"
    )
    .get(weekStart, weekEnd) as { count: number };

  const conversationRow = getDb()
    .prepare(
      "SELECT SUM(message_count) as total_messages, AVG(duration_minutes) as avg_duration FROM conversations WHERE date >= ? AND date <= ?"
    )
    .get(weekStart, weekEnd) as {
    total_messages: number | null;
    avg_duration: number | null;
  };

  const totalTasks = totalTasksRow?.count ?? 0;
  const completedTasks = completedTasksRow?.count ?? 0;
  const completionRate =
    totalTasks > 0 ? completedTasks / totalTasks : 0;

  return {
    diaryCount: diaryRows.length,
    totalWords,
    averageStress: stressCount > 0 ? stressSum / stressCount : 0,
    topTags,
    taskStats: {
      total: totalTasks,
      completed: completedTasks,
      completionRate
    },
    conversationStats: {
      totalRounds: conversationRow?.total_messages ?? 0,
      averageDuration: conversationRow?.avg_duration ?? 0
    }
  };
}

export function getWeeklyReportSourceData(
  weekStart: string,
  weekEnd: string
): { diaries: DiaryRecord[]; tasks: TaskRecord[] } {
  const diaries = getDb()
    .prepare(
      "SELECT * FROM diaries WHERE is_deleted = 0 AND date >= ? AND date <= ? ORDER BY date ASC, created_at ASC"
    )
    .all(weekStart, weekEnd) as DiaryRow[];

  const tasks = getDb()
    .prepare(
      "SELECT * FROM tasks WHERE is_deleted = 0 AND (date(created_at) >= ? AND date(created_at) <= ? OR (completed_at IS NOT NULL AND date(completed_at) >= ? AND date(completed_at) <= ?)) ORDER BY created_at ASC"
    )
    .all(weekStart, weekEnd, weekStart, weekEnd) as TaskRow[];

  return {
    diaries: diaries.map(mapDiaryRow),
    tasks: tasks.map(mapTaskRow)
  };
}

export function createWeeklyReport(input: {
  weekStart: string;
  weekEnd: string;
  reportContent: WeeklyReportContent;
  stats: WeeklyReportStats;
}): WeeklyReportRecord {
  const now = new Date().toISOString();
  const settings = getSettings();
  const id = randomUUID();

  getDb()
    .prepare(
      `INSERT INTO weekly_reports (
        id, week_start, week_end, report_content, stats, ai_provider, ai_model, created_at
      ) VALUES (
        @id, @week_start, @week_end, @report_content, @stats, @ai_provider, @ai_model, @created_at
      )`
    )
    .run({
      id,
      week_start: input.weekStart,
      week_end: input.weekEnd,
      report_content: JSON.stringify(input.reportContent),
      stats: JSON.stringify(input.stats),
      ai_provider: settings.aiProvider ?? "openai",
      ai_model: settings.aiModel,
      created_at: now
    });

  const row = getDb()
    .prepare("SELECT * FROM weekly_reports WHERE id = ?")
    .get(id) as WeeklyReportRow;

  return mapWeeklyReportRow(row);
}

export function getWeeklyReport(id: string): WeeklyReportRecord | null {
  const row = getDb()
    .prepare("SELECT * FROM weekly_reports WHERE id = ?")
    .get(id) as WeeklyReportRow | undefined;

  return row ? mapWeeklyReportRow(row) : null;
}

export function listWeeklyReports(): WeeklyReportRecord[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM weekly_reports ORDER BY week_start DESC, created_at DESC"
    )
    .all() as WeeklyReportRow[];

  return rows.map(mapWeeklyReportRow);
}

export function updateWeeklyReport(input: {
  id: string;
  reportContent: WeeklyReportContent | null;
}): WeeklyReportRecord | null {
  const result = getDb()
    .prepare("UPDATE weekly_reports SET report_content = ? WHERE id = ?")
    .run(input.reportContent ? JSON.stringify(input.reportContent) : null, input.id);

  if (result.changes === 0) {
    return null;
  }

  const row = getDb()
    .prepare("SELECT * FROM weekly_reports WHERE id = ?")
    .get(input.id) as WeeklyReportRow;

  return mapWeeklyReportRow(row);
}

export function deleteWeeklyReport(id: string): boolean {
  const result = getDb()
    .prepare("DELETE FROM weekly_reports WHERE id = ?")
    .run(id);

  return result.changes > 0;
}
