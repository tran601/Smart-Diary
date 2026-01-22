import type { ChatMessage, Conversation } from "../types/database";

export const conversationService = {
  create: (): Promise<Conversation> => window.api.conversation.create(),
  appendMessage: (
    id: string,
    message: ChatMessage
  ): Promise<Conversation | null> =>
    window.api.conversation.appendMessage(id, message),
  get: (id: string): Promise<Conversation | null> =>
    window.api.conversation.get(id),
  list: (): Promise<Conversation[]> => window.api.conversation.list(),
  delete: (id: string): Promise<boolean> => window.api.conversation.delete(id),
  updateExtractedInfo: (
    id: string,
    extractedInfo: Conversation["extractedInfo"]
  ): Promise<Conversation | null> =>
    window.api.conversation.updateExtractedInfo(id, extractedInfo)
};
