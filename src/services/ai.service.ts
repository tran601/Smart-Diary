import type { Diary, ExtractedInfo } from "../types/database";

export const aiService = {
  chat: (
    conversationId: string,
    stylePrompt?: string
  ): Promise<{ content: string }> => window.api.ai.chat(conversationId, stylePrompt),
  onChatChunk: (callback: (data: { conversationId: string; chunk: string }) => void) =>
    window.api.ai.onChatChunk(callback),
  onChatDone: (callback: (data: { conversationId: string }) => void) =>
    window.api.ai.onChatDone(callback),
  offChatListeners: () => window.api.ai.offChatListeners(),
  generateDiaryDraft: (conversationId: string, stylePrompt?: string): Promise<Diary> =>
    window.api.ai.generateDiary(conversationId, stylePrompt),
  detectTodos: (conversationId: string): Promise<ExtractedInfo> =>
    window.api.ai.detectTodos(conversationId)
};
