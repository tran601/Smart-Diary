export type DiaryMode = "traditional" | "ai";

export type ISODateString = string;

export interface Diary {
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
  createdAt: ISODateString;
  updatedAt: ISODateString;
  isDeleted: boolean;
}

export interface DiaryCreateInput {
  date?: string;
  title?: string;
  content: string;
  stressLevel?: number;
  weather?: string;
  tags?: string[];
  mode: DiaryMode;
  conversationId?: string;
  isGenerated?: boolean;
}

export interface DiaryUpdateInput {
  title?: string;
  content?: string;
  stressLevel?: number;
  weather?: string;
  tags?: string[];
  isEdited?: boolean;
}

export type DiaryAttachmentSource = "upload" | "drag" | "paste";

export interface DiaryAttachment {
  id: string;
  diaryId: string;
  storagePath: string;
  mimeType: string;
  fileExt: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  sha256: string;
  source: DiaryAttachmentSource;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  isDeleted: boolean;
}

export interface DiaryImageUploadInput {
  diaryId: string;
  fileName?: string;
  mimeType?: string;
  source: DiaryAttachmentSource;
  data: ArrayBuffer;
}

export interface DiaryImageUploadResult {
  attachment: DiaryAttachment;
  src: string;
}

export interface DiaryFilter {
  mode?: DiaryMode;
  tags?: string[];
  dateRange?: {
    start: string;
    end: string;
  };
  keyword?: string;
}

export type MessageRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: ISODateString;
}

export interface ExtractedInfo {
  events: string[];
  people: string[];
  locations: string[];
  todos: {
    title: string;
    dueDate?: ISODateString;
    priority?: TaskPriority;
    notes?: string;
  }[];
  dismissedTodos?: string[];
}

export interface Conversation {
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
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export type ConversationState =
  | "greeting"
  | "exploring_events"
  | "deep_dive"
  | "supplementing"
  | "ready_to_summarize"
  | "refining";

export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type TaskStatus = "not_started" | "in_progress" | "completed";

export interface Task {
  id: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  deadline: ISODateString | null;
  completionNote: string | null;
  completedAt: ISODateString | null;
  conversationId: string | null;
  diaryId: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  isDeleted: boolean;
}

export interface TaskCreateInput {
  title: string;
  description?: string;
  priority?: TaskPriority;
  deadline?: ISODateString;
  conversationId?: string;
}

export interface TaskUpdateInput {
  title?: string;
  description?: string | null;
  priority?: TaskPriority;
  deadline?: ISODateString | null;
  status?: TaskStatus;
  completionNote?: string | null;
}

export interface WeeklyReportStats {
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
}

export interface WeeklyReportContent {
  title: string;
  summary: string;
  highlights: string[];
  improvements: string[];
  nextWeekPlan: string[];
}

export interface WeeklyReportUpdateInput {
  reportContent: WeeklyReportContent;
}

export interface WeeklyReport {
  id: string;
  weekStart: string;
  weekEnd: string;
  reportContent: WeeklyReportContent | null;
  stats: WeeklyReportStats;
  aiProvider: string | null;
  aiModel: string | null;
  createdAt: ISODateString;
}

export interface AppSettings {
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
}

export interface AppSettingsPublic {
  appMode: DiaryMode;
  firstLaunch: boolean;
  theme: "light" | "dark";
  aiProvider: "openai" | "claude" | "deepseek" | "local" | null;
  aiApiKey: string | null;
  aiBaseUrl: string | null;
  aiModel: string;
  aiApiKeySet: boolean;
  encryptionEnabled: boolean;
  autoBackup: boolean;
  backupIntervalDays: number;
}
