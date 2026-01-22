import type { Diary, ExtractedInfo, Task } from "../types/database";

export const aiService = {
  chat: (conversationId: string): Promise<{ content: string }> =>
    window.api.ai.chat(conversationId),
  onChatChunk: (callback: (data: { conversationId: string; chunk: string }) => void) =>
    window.api.ai.onChatChunk(callback),
  onChatDone: (callback: (data: { conversationId: string }) => void) =>
    window.api.ai.onChatDone(callback),
  offChatListeners: () => window.api.ai.offChatListeners(),
  generateDiaryDraft: (conversationId: string): Promise<Diary> =>
    window.api.ai.generateDiary(conversationId),
  extractInfo: (
    conversationId: string
  ): Promise<{ extractedInfo: ExtractedInfo; tasks: Task[] }> =>
    window.api.ai.extractInfo(conversationId),
  detectTodos: (conversationId: string): Promise<ExtractedInfo> =>
    window.api.ai.detectTodos(conversationId)
};
