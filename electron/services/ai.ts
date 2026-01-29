import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { getSettings } from "./database";

type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

type DiaryDraft = {
  title: string;
  content: string;
  rawText: string;
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

type ExistingTask = {
  title: string;
  status: string;
  deadline?: string | null;
};

type WeeklyReportContent = {
  title: string;
  summary: string;
  highlights: string[];
  improvements: string[];
  nextWeekPlan: string[];
};

const CHAT_SYSTEM_PROMPT_BASE =
  "You are a calm journaling assistant. Respond briefly and ask gentle follow-up questions.\n" +
  "You have access to the current date and time, which will be provided below.";

const DIARY_SYSTEM_PROMPT_BASE =
  "You are a journaling assistant. Based on the conversation, write a diary draft in Chinese.\n" +
  "Requirements:\n" +
  "1) First line must be '标题: <short title>'.\n" +
  "2) Then write 2-5 short paragraphs, covering key events and highlights.\n" +
  "3) Plain text only, no markdown and no JSON.";

function buildDiarySystemPrompt(stylePrompt?: string): string {
  const styleBlock = stylePrompt?.trim()
    ? `\n\nWriting Style:\n${stylePrompt.trim()}`
    : "";
  return DIARY_SYSTEM_PROMPT_BASE + styleBlock;
}

const EXTRACT_SYSTEM_PROMPT_BASE =
  "You are an assistant that extracts structured information from a conversation.\n" +
  "The current date/time context will be provided below. Use it to calculate precise due dates when the user mentions relative times like '明天', '下周一', '后天' etc.\n" +
  "You will also receive a list of existing tasks (including completed). Do NOT output any todo that duplicates an existing task.\n" +
  "Return ONLY valid JSON with the following schema:\n" +
  "{\n" +
  '  "events": ["..."],\n' +
  '  "people": ["..."],\n' +
  '  "locations": ["..."],\n' +
  '  "todos": [\n' +
  '    {"title": "...", "dueDate": "YYYY-MM-DD or 未知", "priority": "low|medium|high|urgent", "notes": ""}\n' +
  "  ]\n" +
  "}\n" +
  "IMPORTANT: If the user did NOT mention any time constraint or deadline for a todo, set dueDate to \"未知\".\n" +
  "If information is missing, use empty arrays and omit optional fields.\n" +
  "Do not include any extra keys or commentary.";

const WEEKLY_REPORT_SYSTEM_PROMPT =
  "You are a journaling assistant that writes a weekly report in Chinese.\n" +
  "Return ONLY valid JSON with the following schema:\n" +
  "{\n" +
  '  "title": "string",\n' +
  '  "summary": "string",\n' +
  '  "highlights": ["..."],\n' +
  '  "improvements": ["..."],\n' +
  '  "nextWeekPlan": ["..."]\n' +
  "}\n" +
  "Keep each list item short. Do not include any extra keys or commentary.";

let client: OpenAI | null = null;
let cachedApiKey: string | null = null;
let cachedBaseUrl: string | null = null;

function resolveApiKey() {
  const settings = getSettings();
  const storedKey = settings.aiApiKey?.trim();
  if (storedKey && storedKey.length > 0) {
    return storedKey;
  }
  const envKey = process.env.OPENAI_API_KEY?.trim();
  return envKey && envKey.length > 0 ? envKey : null;
}

function resolveModel() {
  const settings = getSettings();
  const storedModel = settings.aiModel?.trim();
  if (storedModel && storedModel.length > 0) {
    return storedModel;
  }
  const envModel = process.env.OPENAI_MODEL?.trim();
  if (envModel && envModel.length > 0) {
    return envModel;
  }
  return "gpt-4";
}

function resolveBaseUrl() {
  const settings = getSettings();
  const storedUrl = settings.aiBaseUrl?.trim();
  if (storedUrl && storedUrl.length > 0) {
    return storedUrl;
  }
  const envUrl = (process.env.OPENAI_BASE_URL ?? process.env.OPENAI_API_BASE)?.trim();
  return envUrl && envUrl.length > 0 ? envUrl : null;
}

function getClient() {
  const apiKey = resolveApiKey();
  if (!apiKey) {
    throw new Error("Missing OpenAI API key.");
  }
  const baseUrl = resolveBaseUrl();
  if (!client || cachedApiKey !== apiKey || cachedBaseUrl !== baseUrl) {
    client = baseUrl ? new OpenAI({ apiKey, baseURL: baseUrl }) : new OpenAI({ apiKey });
    cachedApiKey = apiKey;
    cachedBaseUrl = baseUrl;
  }
  return client;
}

async function createChatCompletion(
  messages: ChatCompletionMessageParam[],
  temperature: number
) {
  const model = resolveModel();
  const completion = await getClient().chat.completions.create({
    model,
    temperature,
    messages
  });
  const content = completion.choices[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("Empty response from AI.");
  }
  return content;
}

function toOpenAiMessages(messages: ChatMessage[], systemPrompt: string) {
  const filtered = messages
    .map((message) => ({
      role: message.role,
      content: message.content.trim()
    }))
    .filter((message) => message.content.length > 0);

  const openAiMessages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...filtered
  ];

  return openAiMessages;
}

function extractTitleAndBody(text: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const nonEmptyLines = lines.filter((line) => line.length > 0);
  if (nonEmptyLines.length === 0) {
    return { title: "AI Draft", body: "" };
  }
  const first = nonEmptyLines[0];
  const match = first.match(/^(标题|Title)\s*[:：]\s*(.+)$/i);
  if (match) {
    const title = match[2].trim() || "AI Draft";
    const body = nonEmptyLines.slice(1).join("\n");
    return { title, body };
  }
  return { title: "AI Draft", body: nonEmptyLines.join("\n") };
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function textToHtml(text: string) {
  const escaped = escapeHtml(text);
  const paragraphs = escaped
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => `<p>${line}</p>`)
    .join("");
  return paragraphs || "<p><br></p>";
}

function extractJson(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Failed to parse extracted info.");
  }
  return text.slice(start, end + 1);
}

function normalizeExtractedInfo(payload: Partial<ExtractedInfo>): ExtractedInfo {
  const normalizeDueDate = (value?: string) => {
    if (!value) {
      return undefined;
    }
    const trimmed = String(value).trim();
    if (!trimmed || trimmed === "未知") {
      return undefined;
    }
    return trimmed;
  };

  return {
    events: Array.isArray(payload.events) ? payload.events.filter(Boolean) : [],
    people: Array.isArray(payload.people) ? payload.people.filter(Boolean) : [],
    locations: Array.isArray(payload.locations)
      ? payload.locations.filter(Boolean)
      : [],
    todos: Array.isArray(payload.todos)
      ? payload.todos
        .filter((todo) => todo && typeof todo.title === "string")
        .map((todo) => ({
          title: todo.title.trim(),
          dueDate: normalizeDueDate(todo.dueDate ? String(todo.dueDate) : undefined),
          priority: todo.priority as ExtractedTodo["priority"],
          notes: todo.notes ? String(todo.notes).trim() : undefined
        }))
        .filter((todo) => todo.title.length > 0)
      : []
  };
}

function normalizeWeeklyReportContent(
  payload: Partial<WeeklyReportContent>
): WeeklyReportContent {
  return {
    title: payload.title?.trim() || "每周周报",
    summary: payload.summary?.trim() || "",
    highlights: Array.isArray(payload.highlights)
      ? payload.highlights.map((item) => String(item).trim()).filter(Boolean)
      : [],
    improvements: Array.isArray(payload.improvements)
      ? payload.improvements.map((item) => String(item).trim()).filter(Boolean)
      : [],
    nextWeekPlan: Array.isArray(payload.nextWeekPlan)
      ? payload.nextWeekPlan.map((item) => String(item).trim()).filter(Boolean)
      : []
  };
}

function buildChatSystemPrompt(stylePrompt?: string): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const second = now.getSeconds();
  const weekday = WEEKDAYS_CN[now.getDay()];
  const dateContext = `当前时间：${year}年${month}月${day}日 ${hour}时${minute}分${second}秒，${weekday}。`;
  const styleBlock = stylePrompt?.trim()
    ? `\n\nStyle:\n${stylePrompt.trim()}`
    : "";
  return CHAT_SYSTEM_PROMPT_BASE + styleBlock + "\n\n" + dateContext;
}

export async function generateAssistantReply(
  messages: ChatMessage[],
  stylePrompt?: string
) {
  if (messages.length === 0) {
    throw new Error("Conversation is empty.");
  }
  const systemPrompt = buildChatSystemPrompt(stylePrompt);
  const openAiMessages = toOpenAiMessages(messages, systemPrompt);
  return createChatCompletion(openAiMessages, 0.7);
}

export async function* generateAssistantReplyStream(
  messages: ChatMessage[],
  stylePrompt?: string
): AsyncGenerator<string, void, unknown> {
  if (messages.length === 0) {
    throw new Error("Conversation is empty.");
  }
  const model = resolveModel();
  const systemPrompt = buildChatSystemPrompt(stylePrompt);
  const openAiMessages = toOpenAiMessages(messages, systemPrompt);
  const stream = await getClient().chat.completions.create({
    model,
    temperature: 0.7,
    messages: openAiMessages,
    stream: true
  });
  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) {
      yield content;
    }
  }
}

export async function generateDiaryDraft(
  messages: ChatMessage[],
  stylePrompt?: string
): Promise<DiaryDraft> {
  if (messages.length === 0) {
    throw new Error("Conversation is empty.");
  }
  const systemPrompt = buildDiarySystemPrompt(stylePrompt);
  const openAiMessages = toOpenAiMessages(messages, systemPrompt);
  const rawText = await createChatCompletion(openAiMessages, 0.4);
  if (!rawText) {
    throw new Error("Empty response from AI.");
  }
  const { title, body } = extractTitleAndBody(rawText);
  return {
    title,
    content: textToHtml(body),
    rawText
  };
}

function formatExistingTasks(tasks: ExistingTask[]) {
  const lines = tasks
    .filter((task) => task.title?.trim())
    .slice(0, 50)
    .map((task, index) => {
      const deadline = task.deadline?.trim() || "unknown";
      const status = task.status || "unknown";
      return `${index + 1}. ${task.title.trim()} | ${deadline} | ${status}`;
    });
  if (lines.length === 0) {
    return "";
  }
  return `\n\nExisting tasks (do NOT duplicate):\n${lines.join("\n")}`;
}

const WEEKDAYS_CN = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function buildExtractSystemPrompt(existingTasks: ExistingTask[] = []): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const hour = now.getHours();
  const weekday = WEEKDAYS_CN[now.getDay()];
  const dateContext = `当前时间：${year}年${month}月${day}日 ${hour}点，${weekday}。`;
  const taskContext = formatExistingTasks(existingTasks);
  return EXTRACT_SYSTEM_PROMPT_BASE + taskContext + "\n\n" + dateContext;
}

export async function generateExtractedInfo(
  messages: ChatMessage[],
  existingTasks: ExistingTask[] = []
): Promise<ExtractedInfo> {
  if (messages.length === 0) {
    throw new Error("Conversation is empty.");
  }
  // 只提取用户消息中的待办事项，忽略 AI 回复
  const userMessages = messages.filter((m) => m.role === "user");
  if (userMessages.length === 0) {
    throw new Error("No user messages found.");
  }
  const systemPrompt = buildExtractSystemPrompt(existingTasks);
  const openAiMessages = toOpenAiMessages(userMessages, systemPrompt);
  const rawText = await createChatCompletion(openAiMessages, 0.2);
  if (!rawText) {
    throw new Error("Empty response from AI.");
  }
  const jsonText = extractJson(rawText);
  const parsed = JSON.parse(jsonText) as Partial<ExtractedInfo>;
  return normalizeExtractedInfo(parsed);
}

export async function generateWeeklyReport(input: {
  weekStart: string;
  weekEnd: string;
  summary: string;
}): Promise<WeeklyReportContent> {
  const summary = input.summary.trim();
  if (!summary) {
    throw new Error("Weekly summary is empty.");
  }
  const rawText = await createChatCompletion(
    [
      { role: "system", content: WEEKLY_REPORT_SYSTEM_PROMPT },
      {
        role: "user",
        content: `周区间：${input.weekStart} 至 ${input.weekEnd}\n${summary}`
      }
    ],
    0.3
  );
  if (!rawText) {
    throw new Error("Empty response from AI.");
  }
  const jsonText = extractJson(rawText);
  const parsed = JSON.parse(jsonText) as Partial<WeeklyReportContent>;
  return normalizeWeeklyReportContent(parsed);
}
