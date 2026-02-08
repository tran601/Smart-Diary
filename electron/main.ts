import { app, BrowserWindow, ipcMain } from "electron";
import path from "path";
import {
  appendConversationMessage,
  archiveConversation,
  closeDatabase,
  createConversation,
  createDiary,
  createTask,
  createWeeklyReport,
  completeTask,
  deleteDiary,
  deleteTask,
  getConversation,
  getDiary,
  getSettings,
  getWeeklyReport,
  getWeeklyReportSourceData,
  getWeeklyReportStats,
  initDatabase,
  linkConversationToDiary,
  listConversations,
  listDiaries,
  listDiaryAttachments,
  listWeeklyReports,
  deleteWeeklyReport,
  updateWeeklyReport,
  listTasks,
  setSettings,
  updateConversationExtractedInfo,
  updateDiary,
  updateTask
} from "./services/database";
import {
  generateAssistantReplyStream,
  generateDiaryDraft,
  generateExtractedInfo,
  generateWeeklyReport
} from "./services/ai";
import {
  cleanupDiaryImagesByDiaryId,
  registerDiaryMediaProtocol,
  removeDiaryAttachmentFile,
  storeDiaryImage,
  toDiaryMediaUrl,
  type DiaryImageUploadInput
} from "./services/diaryMedia";
import { exportDatabaseBackup, importDatabaseBackup } from "./services/backup";

let mainWindow: BrowserWindow | null = null;

const isSmokeTest = process.env.SMART_DIARY_SMOKE === "1";
const isOfflineCheck = process.env.SMART_DIARY_OFFLINE_CHECK === "1";
const isAutomationRun = isSmokeTest || isOfflineCheck;
const OFFLINE_BLOCK_MESSAGE = "Traditional mode does not allow network access.";

const devServerUrl = process.env.VITE_DEV_SERVER_URL || "http://localhost:5173";

type WeeklySummaryInput = {
  weekStart: string;
  weekEnd: string;
  stats: ReturnType<typeof getWeeklyReportStats>;
  diaries: ReturnType<typeof getWeeklyReportSourceData>["diaries"];
  tasks: ReturnType<typeof getWeeklyReportSourceData>["tasks"];
};

type TodoPriority = "low" | "medium" | "high" | "urgent";

type ExtractedTodo = {
  title: string;
  dueDate?: string;
  priority?: TodoPriority;
  notes?: string;
};

function isAttachmentSource(value: unknown): value is DiaryImageUploadInput["source"] {
  return value === "upload" || value === "drag" || value === "paste";
}

function parseDiaryImageUploadInput(input: unknown): DiaryImageUploadInput {
  const payload = input as Partial<DiaryImageUploadInput> | null | undefined;
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid upload payload.");
  }
  if (typeof payload.diaryId !== "string" || !payload.diaryId.trim()) {
    throw new Error("Diary ID is required for image upload.");
  }
  if (!isAttachmentSource(payload.source)) {
    throw new Error("Invalid image upload source.");
  }
  if (
    !payload.data ||
    !(
      payload.data instanceof ArrayBuffer ||
      ArrayBuffer.isView(payload.data) ||
      Buffer.isBuffer(payload.data)
    )
  ) {
    throw new Error("Image bytes are missing.");
  }

  return {
    diaryId: payload.diaryId,
    fileName: typeof payload.fileName === "string" ? payload.fileName : undefined,
    mimeType: typeof payload.mimeType === "string" ? payload.mimeType : undefined,
    source: payload.source,
    data: payload.data
  };
}

function stripHtml(input: string) {
  return input.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function truncateText(input: string, maxLength: number) {
  if (input.length <= maxLength) {
    return input;
  }
  return `${input.slice(0, maxLength).trim()}...`;
}

const TODO_PRIORITIES = new Set<TodoPriority>([
  "low",
  "medium",
  "high",
  "urgent"
]);

function normalizeTodoPriority(value?: string | null): TodoPriority {
  if (value && TODO_PRIORITIES.has(value as TodoPriority)) {
    return value as TodoPriority;
  }
  return "medium";
}

function normalizeTodoDueDate(value?: string | null) {
  if (!value) {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed === "未知") {
    return "";
  }
  return trimmed;
}

function buildTodoKey(title: string, dueDate: string, priority: TodoPriority) {
  return `${title.trim()}|${dueDate}|${priority}`;
}

function buildTodoTitleKey(title: string) {
  return title.trim().toLowerCase();
}

function buildExistingTaskKeySet(tasks: ReturnType<typeof listTasks>) {
  const keys = new Set<string>();
  for (const task of tasks) {
    const title = task.title?.trim();
    if (!title) {
      continue;
    }
    const dueDate = normalizeTodoDueDate(task.deadline);
    const priority = normalizeTodoPriority(task.priority);
    keys.add(buildTodoKey(title, dueDate, priority));
  }
  return keys;
}

function buildExistingTaskTitleKeySet(tasks: ReturnType<typeof listTasks>) {
  const keys = new Set<string>();
  for (const task of tasks) {
    const title = task.title?.trim();
    if (!title) {
      continue;
    }
    keys.add(buildTodoTitleKey(title));
  }
  return keys;
}

function dedupeExtractedTodos(
  todos: ExtractedTodo[],
  existingKeys: Set<string>,
  existingTitleKeys: Set<string>
) {
  const seen = new Set(existingKeys);
  const seenTitles = new Set(existingTitleKeys);
  const next: ExtractedTodo[] = [];
  for (const todo of todos) {
    const title = todo.title?.trim();
    if (!title) {
      continue;
    }
    const dueDate = normalizeTodoDueDate(todo.dueDate);
    const priority = normalizeTodoPriority(todo.priority);
    const key = buildTodoKey(title, dueDate, priority);
    const titleKey = buildTodoTitleKey(title);
    if (seen.has(key) || seenTitles.has(titleKey)) {
      continue;
    }
    seen.add(key);
    seenTitles.add(titleKey);
    next.push({
      title,
      dueDate: dueDate || undefined,
      priority,
      notes: todo.notes?.trim() || undefined
    });
  }
  return next;
}

function buildWeeklySummary(input: WeeklySummaryInput) {
  const lines: string[] = [];
  lines.push(`周区间：${input.weekStart} 至 ${input.weekEnd}`);
  lines.push(
    `日记数：${input.stats.diaryCount}，总字数：${input.stats.totalWords}，完成任务：${input.stats.taskStats.completed}/${input.stats.taskStats.total}`
  );

  if (input.stats.topTags.length > 0) {
    lines.push(`常用标签：${input.stats.topTags.join("，")}`);
  }

  if (input.diaries.length > 0) {
    lines.push("日记摘要：");
    input.diaries.slice(0, 20).forEach((diary) => {
      const content = diary.content ? stripHtml(diary.content) : "";
      const preview = truncateText(content, 300);
      const tags = diary.tags.length > 0 ? diary.tags.join(", ") : "无";
      lines.push(
        `- ${diary.date} | ${diary.title ?? "Untitled"} | tags:${tags} | ${preview}`
      );
    });
    if (input.diaries.length > 20) {
      lines.push(`（还有 ${input.diaries.length - 20} 篇日记未展开）`);
    }
  } else {
    lines.push("本周暂无日记。");
  }

  if (input.tasks.length > 0) {
    lines.push("任务清单：");
    input.tasks.slice(0, 30).forEach((task) => {
      const deadline = task.deadline ?? "无截止日期";
      lines.push(
        `- ${task.title} | status:${task.status} | priority:${task.priority} | deadline:${deadline}`
      );
    });
    if (input.tasks.length > 30) {
      lines.push(`（还有 ${input.tasks.length - 30} 条任务未展开）`);
    }
  } else {
    lines.push("本周暂无任务。");
  }

  return lines.join("\n");
}

function createMainWindow(options?: { show?: boolean }) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: options?.show ?? true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (app.isPackaged || isAutomationRun) {
    const indexHtml = path.join(app.getAppPath(), "dist", "index.html");
    mainWindow.loadFile(indexHtml);
  } else {
    mainWindow.loadURL(devServerUrl);
    if (!isAutomationRun) {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function registerIpcHandlers() {
  const ensureAiMode = () => {
    const settings = getSettings();
    if (settings.appMode !== "ai") {
      throw new Error("AI mode is required.");
    }
  };

  const toPublicSettings = (settings: ReturnType<typeof getSettings>) => {
    const storedKey = settings.aiApiKey?.trim();
    const apiKeySet = Boolean(storedKey && storedKey.length > 0);

    return {
      appMode: settings.appMode,
      firstLaunch: settings.firstLaunch,
      theme: settings.theme,
      aiProvider: settings.aiProvider,
      aiBaseUrl: settings.aiBaseUrl,
      aiApiKey: settings.aiApiKey,
      aiModel: settings.aiModel,
      aiApiKeySet: apiKeySet,
      encryptionEnabled: settings.encryptionEnabled,
      autoBackup: settings.autoBackup,
      backupIntervalDays: settings.backupIntervalDays
    };
  };

  ipcMain.handle("settings:get", () => toPublicSettings(getSettings()));
  ipcMain.handle("settings:set", (_event, input) =>
    toPublicSettings(setSettings(input ?? {}))
  );
  ipcMain.handle("diary:create", (_event, input) => createDiary(input));
  ipcMain.handle("diary:update", (_event, id, input) =>
    updateDiary(id, input ?? {})
  );
  ipcMain.handle("diary:get", (_event, id) => getDiary(id));
  ipcMain.handle("diary:list", () => listDiaries());
  ipcMain.handle("diary:delete", (_event, id) => {
    const deleted = deleteDiary(id);
    if (deleted) {
      cleanupDiaryImagesByDiaryId(id);
    }
    return deleted;
  });
  ipcMain.handle("diary:uploadImage", (_event, input) => {
    const uploadInput = parseDiaryImageUploadInput(input);
    const diary = getDiary(uploadInput.diaryId);
    if (!diary) {
      throw new Error("Diary not found.");
    }
    return storeDiaryImage(uploadInput);
  });
  ipcMain.handle("diary:listAttachments", (_event, diaryId: string) =>
    listDiaryAttachments(diaryId).map((item) => ({
      ...item,
      src: toDiaryMediaUrl(item.storagePath)
    }))
  );
  ipcMain.handle("diary:deleteAttachment", (_event, attachmentId: string) =>
    removeDiaryAttachmentFile(attachmentId)
  );

  ipcMain.handle("conversation:create", () => {
    ensureAiMode();
    return createConversation();
  });
  ipcMain.handle("conversation:appendMessage", (_event, id, message) => {
    ensureAiMode();
    return appendConversationMessage(id, message);
  });
  ipcMain.handle("conversation:get", (_event, id) => {
    ensureAiMode();
    return getConversation(id);
  });
  ipcMain.handle("conversation:list", () => {
    ensureAiMode();
    return listConversations();
  });
  ipcMain.handle("conversation:delete", (_event, id) => {
    ensureAiMode();
    return archiveConversation(id);
  });
  ipcMain.handle("conversation:updateExtractedInfo", (_event, id, extractedInfo) => {
    ensureAiMode();
    updateConversationExtractedInfo(id, extractedInfo);
    return getConversation(id);
  });

  ipcMain.handle("ai:chat", async (event, conversationId, stylePrompt) => {
    ensureAiMode();
    const conversation = getConversation(conversationId);
    if (!conversation) {
      throw new Error("Conversation not found.");
    }
    let fullContent = "";
    for await (const chunk of generateAssistantReplyStream(
      conversation.messages,
      stylePrompt
    )) {
      fullContent += chunk;
      event.sender.send("ai:chat:chunk", { conversationId, chunk });
    }
    event.sender.send("ai:chat:done", { conversationId });
    return { content: fullContent };
  });
  ipcMain.handle("ai:generateDiary", async (_event, conversationId, stylePrompt) => {
    ensureAiMode();
    const conversation = getConversation(conversationId);
    if (!conversation) {
      throw new Error("Conversation not found.");
    }
    const draft = await generateDiaryDraft(conversation.messages, stylePrompt);
    const diary = createDiary({
      title: draft.title,
      content: draft.content,
      mode: "ai",
      conversationId,
      isGenerated: true
    });
    linkConversationToDiary(conversationId, diary.id);
    return diary;
  });

  ipcMain.handle("ai:detectTodos", async (_event, conversationId) => {
    ensureAiMode();
    const conversation = getConversation(conversationId);
    if (!conversation) {
      throw new Error("Conversation not found.");
    }
    const taskRecords = listTasks();
    const existingTasks = taskRecords.map((task) => ({
      title: task.title,
      status: task.status,
      deadline: task.deadline
    }));
    const existingTaskKeys = buildExistingTaskKeySet(taskRecords);
    const existingTaskTitleKeys = buildExistingTaskTitleKeySet(taskRecords);
    const extractedInfo = await generateExtractedInfo(
      conversation.messages,
      existingTasks
    );
    const filteredTodos = dedupeExtractedTodos(
      extractedInfo.todos as ExtractedTodo[],
      existingTaskKeys,
      existingTaskTitleKeys
    );
    const dismissedTodos = conversation.extractedInfo?.dismissedTodos ?? [];
    return { ...extractedInfo, todos: filteredTodos, dismissedTodos };
  });

  ipcMain.handle("task:list", () => listTasks());
  ipcMain.handle("task:create", (_event, input) => createTask(input));
  ipcMain.handle("task:update", (_event, id, input) =>
    updateTask(id, input ?? {})
  );
  ipcMain.handle("task:complete", (_event, id) => completeTask(id));
  ipcMain.handle("task:delete", (_event, id) => deleteTask(id));

  ipcMain.handle("backup:export", async () => exportDatabaseBackup());
  ipcMain.handle("backup:import", async () => importDatabaseBackup());

  ipcMain.handle("weekly-report:stats", (_event, weekStart, weekEnd) =>
    getWeeklyReportStats(weekStart, weekEnd)
  );
  ipcMain.handle("weekly-report:list", () => listWeeklyReports());
  ipcMain.handle("weekly-report:get", (_event, id) => getWeeklyReport(id));
  ipcMain.handle("weekly-report:update", (_event, id, input) =>
    updateWeeklyReport({ id, reportContent: input?.reportContent ?? null })
  );
  ipcMain.handle("weekly-report:delete", (_event, id) => deleteWeeklyReport(id));
  ipcMain.handle("weekly-report:generate", async (_event, weekStart, weekEnd) => {
    ensureAiMode();
    const stats = getWeeklyReportStats(weekStart, weekEnd);
    const source = getWeeklyReportSourceData(weekStart, weekEnd);
    const summary = buildWeeklySummary({
      weekStart,
      weekEnd,
      stats,
      diaries: source.diaries,
      tasks: source.tasks
    });
    const reportContent = await generateWeeklyReport({
      weekStart,
      weekEnd,
      summary
    });
    return createWeeklyReport({
      weekStart,
      weekEnd,
      reportContent,
      stats
    });
  });
}

async function runSmokeTest() {
  try {
    const created = createDiary({
      title: `Smoke ${new Date().toISOString()}`,
      content: "<p>Smoke test</p>",
      mode: "traditional"
    });
    const updated = updateDiary(created.id, {
      content: "<p>Smoke updated</p>",
      isEdited: true
    });
    if (!updated) {
      throw new Error("Failed to update diary.");
    }
    closeDatabase();
    initDatabase();
    const reloaded = getDiary(created.id);
    if (!reloaded) {
      throw new Error("Diary missing after restart.");
    }
    console.log("[SMOKE] PASS");
    app.exit(0);
  } catch (error) {
    console.error("[SMOKE] FAIL", error);
    app.exit(1);
  }
}

function waitForLoad(window: BrowserWindow) {
  return new Promise<void>((resolve, reject) => {
    window.webContents.once("did-finish-load", () => resolve());
    window.webContents.once("did-fail-load", (_event, code, desc) =>
      reject(new Error(`Failed to load: ${code} ${desc}`))
    );
  });
}

async function runOfflineCheck() {
  const previousMode = getSettings().appMode;
  try {
    setSettings({ appMode: "traditional" });
    createMainWindow({ show: false });
    if (!mainWindow) {
      throw new Error("Window not created.");
    }
    await waitForLoad(mainWindow);
    const result = await mainWindow.webContents.executeJavaScript(
      `new Promise((resolve) => {
        setTimeout(() => {
          fetch("https://example.com")
            .then(() => resolve("network-allowed"))
            .catch((err) => resolve(err?.message || String(err)));
        }, 1200);
      })`
    );
    if (typeof result === "string" && result.includes(OFFLINE_BLOCK_MESSAGE)) {
      console.log("[OFFLINE_CHECK] PASS");
      setSettings({ appMode: previousMode });
      app.exit(0);
      return;
    }
    throw new Error(`Unexpected result: ${String(result)}`);
  } catch (error) {
    console.error("[OFFLINE_CHECK] FAIL", error);
    setSettings({ appMode: previousMode });
    app.exit(1);
  }
}

app.whenReady().then(() => {
  try {
    registerDiaryMediaProtocol();
    initDatabase();
  } catch (error) {
    console.error("Failed to initialize database", error);
    app.quit();
    return;
  }

  registerIpcHandlers();
  if (isSmokeTest) {
    runSmokeTest();
    return;
  }
  if (isOfflineCheck) {
    runOfflineCheck();
    return;
  }
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  closeDatabase();
});
