import { contextBridge, ipcRenderer } from "electron";

const api = {
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    set: (input: Record<string, unknown>) =>
      ipcRenderer.invoke("settings:set", input)
  },
  diary: {
    create: (input: Record<string, unknown>) =>
      ipcRenderer.invoke("diary:create", input),
    update: (id: string, input: Record<string, unknown>) =>
      ipcRenderer.invoke("diary:update", id, input),
    get: (id: string) => ipcRenderer.invoke("diary:get", id),
    list: () => ipcRenderer.invoke("diary:list"),
    delete: (id: string) => ipcRenderer.invoke("diary:delete", id),
    uploadImage: (input: Record<string, unknown>) =>
      ipcRenderer.invoke("diary:uploadImage", input),
    listAttachments: (diaryId: string) =>
      ipcRenderer.invoke("diary:listAttachments", diaryId),
    deleteAttachment: (attachmentId: string) =>
      ipcRenderer.invoke("diary:deleteAttachment", attachmentId)
  },
  conversation: {
    create: () => ipcRenderer.invoke("conversation:create"),
    appendMessage: (id: string, message: Record<string, unknown>) =>
      ipcRenderer.invoke("conversation:appendMessage", id, message),
    get: (id: string) => ipcRenderer.invoke("conversation:get", id),
    list: () => ipcRenderer.invoke("conversation:list"),
    delete: (id: string) => ipcRenderer.invoke("conversation:delete", id),
    updateExtractedInfo: (id: string, extractedInfo: Record<string, unknown>) =>
      ipcRenderer.invoke("conversation:updateExtractedInfo", id, extractedInfo)
  },
  ai: {
    chat: (conversationId: string, stylePrompt?: string) =>
      ipcRenderer.invoke("ai:chat", conversationId, stylePrompt),
    onChatChunk: (callback: (data: { conversationId: string; chunk: string }) => void) =>
      ipcRenderer.on("ai:chat:chunk", (_event, data) => callback(data)),
    onChatDone: (callback: (data: { conversationId: string }) => void) =>
      ipcRenderer.on("ai:chat:done", (_event, data) => callback(data)),
    offChatListeners: () => {
      ipcRenderer.removeAllListeners("ai:chat:chunk");
      ipcRenderer.removeAllListeners("ai:chat:done");
    },
    generateDiary: (conversationId: string, stylePrompt?: string) =>
      ipcRenderer.invoke("ai:generateDiary", conversationId, stylePrompt),
    detectTodos: (conversationId: string) =>
      ipcRenderer.invoke("ai:detectTodos", conversationId)
  },
  task: {
    list: () => ipcRenderer.invoke("task:list"),
    create: (input: Record<string, unknown>) =>
      ipcRenderer.invoke("task:create", input),
    update: (id: string, input: Record<string, unknown>) =>
      ipcRenderer.invoke("task:update", id, input),
    complete: (id: string) => ipcRenderer.invoke("task:complete", id),
    delete: (id: string) => ipcRenderer.invoke("task:delete", id)
  },
  backup: {
    export: () => ipcRenderer.invoke("backup:export"),
    import: () => ipcRenderer.invoke("backup:import")
  },
  weeklyReport: {
    stats: (weekStart: string, weekEnd: string) =>
      ipcRenderer.invoke("weekly-report:stats", weekStart, weekEnd),
    generate: (weekStart: string, weekEnd: string) =>
      ipcRenderer.invoke("weekly-report:generate", weekStart, weekEnd),
    list: () => ipcRenderer.invoke("weekly-report:list"),
    get: (id: string) => ipcRenderer.invoke("weekly-report:get", id),
    update: (id: string, input: Record<string, unknown>) =>
      ipcRenderer.invoke("weekly-report:update", id, input),
    delete: (id: string) => ipcRenderer.invoke("weekly-report:delete", id)
  }
};

contextBridge.exposeInMainWorld("api", api);
