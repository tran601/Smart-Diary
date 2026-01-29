import { create } from "zustand";
import type { ChatMessage, Conversation, Diary, ExtractedInfo } from "../types/database";
import { conversationService } from "../services/conversation.service";
import { aiService } from "../services/ai.service";

interface ConversationState {
  conversations: Conversation[];
  activeConversation: Conversation | null;
  messageInput: string;
  isLoading: boolean;
  isSending: boolean;
  isGenerating: boolean;
  isDetectingTodo: boolean;
  error: string | null;
  loadConversations: () => Promise<void>;
  createConversation: () => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  sendMessage: (stylePrompt?: string) => Promise<void>;
  generateDiaryDraft: (stylePrompt?: string) => Promise<Diary | null>;
  detectTodos: () => Promise<ExtractedInfo | null>;
  dismissTodoSuggestion: (todoKey: string) => Promise<void>;
  updateConversationExtractedInfo: (
    id: string,
    extractedInfo: ExtractedInfo
  ) => Promise<Conversation | null>;
  setMessageInput: (value: string) => void;
  clearError: () => void;
}

function toErrorMessage(err: unknown) {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

function createMessage(role: ChatMessage["role"], content: string): ChatMessage {
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    id,
    role,
    content,
    timestamp: new Date().toISOString()
  };
}

function normalizeExtractedInfo(info?: ExtractedInfo): ExtractedInfo {
  return {
    events: info?.events ?? [],
    people: info?.people ?? [],
    locations: info?.locations ?? [],
    todos: info?.todos ?? [],
    dismissedTodos: info?.dismissedTodos ?? []
  };
}

function upsertConversation(
  conversations: Conversation[],
  updated: Conversation
) {
  const existingIndex = conversations.findIndex((item) => item.id === updated.id);
  const next = [...conversations];
  if (existingIndex === -1) {
    next.unshift(updated);
  } else {
    next.splice(existingIndex, 1, updated);
  }
  return next;
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  conversations: [],
  activeConversation: null,
  messageInput: "",
  isLoading: false,
  isSending: false,
  isGenerating: false,
  isDetectingTodo: false,
  error: null,
  loadConversations: async () => {
    set({ isLoading: true });
    try {
      const conversations = await conversationService.list();
      const active = get().activeConversation;
      if (active) {
        const updatedActive = conversations.find((item) => item.id === active.id);
        set({
          conversations,
          activeConversation: updatedActive ?? active
        });
      } else {
        set({
          conversations,
          activeConversation: conversations[0] ?? null
        });
      }
    } catch (err) {
      set({ error: toErrorMessage(err) });
    } finally {
      set({ isLoading: false });
    }
  },
  createConversation: async () => {
    set({ isLoading: true });
    try {
      const created = await conversationService.create();
      const conversations = upsertConversation(get().conversations, created);
      set({
        conversations,
        activeConversation: created,
        messageInput: ""
      });
    } catch (err) {
      set({ error: toErrorMessage(err) });
    } finally {
      set({ isLoading: false });
    }
  },
  selectConversation: async (id) => {
    set({ isLoading: true });
    try {
      const conversation = await conversationService.get(id);
      if (!conversation) {
        set({ error: "Conversation not found." });
        return;
      }
      set({ activeConversation: conversation });
    } catch (err) {
      set({ error: toErrorMessage(err) });
    } finally {
      set({ isLoading: false });
    }
  },
  deleteConversation: async (id) => {
    set({ isLoading: true });
    try {
      const removed = await conversationService.delete(id);
      if (!removed) {
        set({ error: "Conversation not found." });
        return;
      }
      const nextConversations = get().conversations.filter(
        (conversation) => conversation.id !== id
      );
      const active = get().activeConversation;
      const nextActive =
        active?.id === id ? (nextConversations[0] ?? null) : active;
      set({
        conversations: nextConversations,
        activeConversation: nextActive,
        messageInput: active?.id === id ? "" : get().messageInput
      });
    } catch (err) {
      set({ error: toErrorMessage(err) });
    } finally {
      set({ isLoading: false });
    }
  },
  sendMessage: async (stylePrompt) => {
    const { activeConversation, messageInput } = get();
    const content = messageInput.trim();
    if (!content) {
      return;
    }
    set({ isSending: true });
    try {
      let conversation = activeConversation;
      if (!conversation) {
        const created = await conversationService.create();
        conversation = created;
        set({
          activeConversation: created,
          conversations: upsertConversation(get().conversations, created)
        });
      }

      const userMessage = createMessage("user", content);
      const updatedConversation = await conversationService.appendMessage(
        conversation.id,
        userMessage
      );
      if (!updatedConversation) {
        set({ error: "Conversation not found." });
        return;
      }

      // Create placeholder assistant message for streaming
      const assistantMessage = createMessage("assistant", "");
      const conversationWithPlaceholder: Conversation = {
        ...updatedConversation,
        messages: [...updatedConversation.messages, assistantMessage],
        messageCount: updatedConversation.messageCount + 1
      };

      set({
        activeConversation: conversationWithPlaceholder,
        messageInput: "",
        conversations: upsertConversation(get().conversations, conversationWithPlaceholder)
      });

      // Set up streaming listeners
      let streamedContent = "";
      const conversationId = conversation.id;

      aiService.onChatChunk((data) => {
        if (data.conversationId === conversationId) {
          streamedContent += data.chunk;
          const currentActive = get().activeConversation;
          if (currentActive && currentActive.id === conversationId) {
            const updatedMessages = [...currentActive.messages];
            const lastIndex = updatedMessages.length - 1;
            if (lastIndex >= 0 && updatedMessages[lastIndex].role === "assistant") {
              updatedMessages[lastIndex] = {
                ...updatedMessages[lastIndex],
                content: streamedContent
              };
              const updatedActive: Conversation = {
                ...currentActive,
                messages: updatedMessages
              };
              set({
                activeConversation: updatedActive,
                conversations: upsertConversation(get().conversations, updatedActive)
              });
            }
          }
        }
      });

      // Wait for chat to complete and persist final message
      const reply = await aiService.chat(conversationId, stylePrompt);
      aiService.offChatListeners();

      // Persist the final assistant message
      const finalAssistantMessage = createMessage("assistant", reply.content);
      const afterReply = await conversationService.appendMessage(
        conversationId,
        finalAssistantMessage
      );
      if (afterReply) {
        set({
          activeConversation: afterReply,
          conversations: upsertConversation(get().conversations, afterReply)
        });
      }
    } catch (err) {
      aiService.offChatListeners();
      set({ error: toErrorMessage(err) });
    } finally {
      set({ isSending: false });
    }
  },
  generateDiaryDraft: async (stylePrompt?: string) => {
    const { activeConversation } = get();
    if (!activeConversation) {
      set({ error: "Select a conversation first." });
      return null;
    }
    set({ isGenerating: true });
    try {
      const diary = await aiService.generateDiaryDraft(activeConversation.id, stylePrompt);
      return diary;
    } catch (err) {
      set({ error: toErrorMessage(err) });
      return null;
    } finally {
      set({ isGenerating: false });
    }
  },
  detectTodos: async () => {
    const { activeConversation } = get();
    if (!activeConversation) {
      set({ error: "Select a conversation first." });
      return null;
    }
    set({ isDetectingTodo: true });
    try {
      const extracted = await aiService.detectTodos(activeConversation.id);
      return extracted;
    } catch (err) {
      set({ error: toErrorMessage(err) });
      return null;
    } finally {
      set({ isDetectingTodo: false });
    }
  },
  dismissTodoSuggestion: async (todoKey) => {
    const { activeConversation } = get();
    if (!activeConversation) {
      set({ error: "Select a conversation first." });
      return;
    }
    const currentInfo = normalizeExtractedInfo(activeConversation.extractedInfo);
    const dismissed = currentInfo.dismissedTodos ?? [];
    if (dismissed.includes(todoKey)) {
      return;
    }
    const nextInfo = {
      ...currentInfo,
      dismissedTodos: [...dismissed, todoKey]
    };
    try {
      const updated = await conversationService.updateExtractedInfo(
        activeConversation.id,
        nextInfo
      );
      if (!updated) {
        set({ error: "Conversation not found." });
        return;
      }
      set({
        activeConversation: updated,
        conversations: upsertConversation(get().conversations, updated)
      });
    } catch (err) {
      set({ error: toErrorMessage(err) });
    }
  },
  updateConversationExtractedInfo: async (id, extractedInfo) => {
    try {
      const updated = await conversationService.updateExtractedInfo(id, extractedInfo);
      if (!updated) {
        set({ error: "Conversation not found." });
        return null;
      }
      const active = get().activeConversation;
      set({
        activeConversation: active?.id === id ? updated : active,
        conversations: upsertConversation(get().conversations, updated)
      });
      return updated;
    } catch (err) {
      set({ error: toErrorMessage(err) });
      return null;
    }
  },
  setMessageInput: (value) => set({ messageInput: value }),
  clearError: () => set({ error: null })
}));
