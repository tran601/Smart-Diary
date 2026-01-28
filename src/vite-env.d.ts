/// <reference types="vite/client" />

import type {
  AppSettings,
  AppSettingsPublic,
  ChatMessage,
  Diary,
  DiaryCreateInput,
  DiaryUpdateInput,
  Conversation,
  ExtractedInfo,
  Task,
  TaskCreateInput,
  TaskUpdateInput,
  WeeklyReport,
  WeeklyReportStats,
  WeeklyReportUpdateInput
} from "./types/database";

export { };

declare global {
  interface Window {
    api: {
      settings: {
        get: () => Promise<AppSettingsPublic>;
        set: (input: Partial<AppSettings>) => Promise<AppSettingsPublic>;
      };
      diary: {
        create: (input: DiaryCreateInput) => Promise<Diary>;
        update: (id: string, input: DiaryUpdateInput) => Promise<Diary | null>;
        get: (id: string) => Promise<Diary | null>;
        list: () => Promise<Diary[]>;
        delete: (id: string) => Promise<boolean>;
      };
      conversation: {
        create: () => Promise<Conversation>;
        appendMessage: (
          id: string,
          message: ChatMessage
        ) => Promise<Conversation | null>;
        get: (id: string) => Promise<Conversation | null>;
        list: () => Promise<Conversation[]>;
        delete: (id: string) => Promise<boolean>;
        updateExtractedInfo: (
          id: string,
          extractedInfo: ExtractedInfo
        ) => Promise<Conversation | null>;
      };
      ai: {
        chat: (conversationId: string, stylePrompt?: string) => Promise<{ content: string }>;
        onChatChunk: (callback: (data: { conversationId: string; chunk: string }) => void) => void;
        onChatDone: (callback: (data: { conversationId: string }) => void) => void;
        offChatListeners: () => void;
        generateDiary: (conversationId: string) => Promise<Diary>;
        detectTodos: (conversationId: string) => Promise<ExtractedInfo>;
      };
      task: {
        list: () => Promise<Task[]>;
        create: (input: TaskCreateInput) => Promise<Task>;
        update: (id: string, input: TaskUpdateInput) => Promise<Task | null>;
        complete: (id: string) => Promise<Task | null>;
        delete: (id: string) => Promise<boolean>;
      };
      backup: {
        export: () => Promise<{ path: string } | null>;
        import: () => Promise<{ path: string } | null>;
      };
      weeklyReport: {
        stats: (weekStart: string, weekEnd: string) => Promise<WeeklyReportStats>;
        generate: (weekStart: string, weekEnd: string) => Promise<WeeklyReport>;
        list: () => Promise<WeeklyReport[]>;
        get: (id: string) => Promise<WeeklyReport | null>;
        update: (id: string, input: WeeklyReportUpdateInput) => Promise<WeeklyReport | null>;
        delete: (id: string) => Promise<boolean>;
      };
    };
  }
}
