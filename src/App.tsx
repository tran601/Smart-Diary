import {
  Alert,
  Button,
  Calendar,
  DatePicker,
  Empty,
  Input,
  Layout,
  List,
  message,
  Modal,
  Select,
  Segmented,
  Space,
  Spin,
  Tabs,
  Tag,
  Typography,
  Tooltip
} from "antd";
import { CloseOutlined } from "@ant-design/icons";
import type { CalendarProps } from "antd";
import calendarLocale from "antd/es/calendar/locale/zh_CN";
import dayjs, { type Dayjs } from "dayjs";
import "dayjs/locale/zh-cn";
import ReactQuill from "react-quill";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { installNetworkGuard } from "./services/networkGuard";
import { backupService } from "./services/backup.service";
import { settingsService } from "./services/settings.service";
import { useAppStore } from "./stores/appStore";
import { useDiaryStore } from "./stores/diaryStore";
import { useConversationStore } from "./stores/conversationStore";
import { useTaskStore } from "./stores/taskStore";
import { useWeeklyReportStore } from "./stores/weeklyReportStore";
import type {
  Task,
  TaskPriority,
  TaskStatus,
  TaskUpdateInput,
  WeeklyReport,
  AppSettingsPublic,
  DiaryMode,
  ExtractedInfo
} from "./types/database";
import "react-quill/dist/quill.snow.css";
import "./styles/app.css";

// 引导步骤图片
import onboardingStep1 from "./assets/onboarding/step1-settings-v2.png";
import onboardingStep2 from "./assets/onboarding/step2-conversation-v2.png";
import onboardingStep3 from "./assets/onboarding/step3-report-v2.png";

dayjs.locale("zh-cn");

const { Header, Content, Sider } = Layout;
const { Title, Text } = Typography;

// 引导步骤配置
const ONBOARDING_STEPS = [
  {
    title: "步骤一：配置 AI 服务",
    image: onboardingStep1,
    descriptions: [
      "1. 点击顶部「设置」标签进入设置页面",
      "2. 在「AI 设置」区域配置您的 API Key、Base URL 和模型 ID",
      "3. 点击「保存 AI 设置」完成配置",
      "完成配置后即可使用 AI 功能！"
    ]
  },
  {
    title: "步骤二：AI 对话功能",
    image: onboardingStep2,
    descriptions: [
      "与 AI 进行对话，AI 可以在对话过程中实时判断待办事项",
      "点击「生成日记」按钮，AI 会根据聊天记录自动生成当日日记",
      "在底部输入框中输入消息，点击「发送」开始对话"
    ]
  },
  {
    title: "步骤三：周报智能生成",
    image: onboardingStep3,
    descriptions: [
      "点击顶部「周报」标签进入周报页面",
      "选择开始时间和结束时间来设定周区间",
      "点击「统计」查看该时间段的日记和任务统计",
      "点击「生成周报」按钮，AI 会自动汇总生成周报"
    ]
  }
];

const MODE_OPTIONS: { label: string; value: DiaryMode; className: string }[] = [
  { label: "Traditional", value: "traditional", className: "mode-item-traditional" },
  { label: "AI", value: "ai", className: "mode-item-ai" }
];

const TASK_PRIORITY_OPTIONS: { label: string; value: TaskPriority }[] = [
  { label: "低", value: "low" },
  { label: "中", value: "medium" },
  { label: "高", value: "high" },
  { label: "紧急", value: "urgent" }
];

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "低",
  medium: "中",
  high: "高",
  urgent: "紧急"
};

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  low: "green",
  medium: "blue",
  high: "orange",
  urgent: "red"
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  not_started: "待办",
  in_progress: "进行中",
  completed: "已完成"
};

const STATUS_COLORS: Partial<Record<TaskStatus, string>> = {
  in_progress: "blue",
  completed: "green"
};

const AI_NOTICE_STORAGE_KEY = "smartdiary_ai_notice_collapsed";
const CHAT_STYLE_STORAGE_KEY = "smartdiary_chat_style";


const THEME_OPTIONS: { label: string; value: AppSettingsPublic["theme"] }[] = [
  { label: "浅色", value: "light" },
  { label: "深色", value: "dark" }
];

const CHAT_STYLE_OPTIONS = [
  {
    label: "简洁风格",
    value: "concise",
    prompt:
      "你是简洁高效的日记助理。回答尽量精简，用短句，最多 2-3 句。以总结与确认为主，尽量不提问。只有在信息明显缺失时才提 1 个问题。"
  },
  {
    label: "温柔风格",
    value: "gentle",
    prompt:
      "你是温柔耐心的日记陪伴者。语气柔和，表达理解与共情，更多倾听与复述，不急于追问。除非对话停滞，否则尽量不提问。"
  },
  {
    label: "暖心风格",
    value: "warm",
    prompt:
      "你是暖心的关怀者。语言温暖积极，强调支持与安慰，避免说教。先回应情绪与感受，少提问，多给予陪伴式回应。"
  },
  {
    label: "成长教练",
    value: "coach",
    prompt:
      "你是理性清晰的成长教练。帮助用户梳理事实与情绪，给出 1-2 条可执行的小建议。优先给出反馈与建议，尽量不追问，只有需要澄清时才提 1 个问题。"
  }
];

function stripHtmlText(input: string) {
  return input
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasDiaryContent(content: string | null) {
  if (!content) {
    return false;
  }
  return stripHtmlText(content).length > 0;
}

function joinLines(items: string[]) {
  return items.join("\n");
}

function splitLines(input: string) {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
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

const EMPTY_EDITOR_CONTENT = "<p><br></p>";

function formatDiaryDate(date: string) {
  return dayjs(date).format("YYYY/MM/DD ddd");
}

type TodoSuggestion = ExtractedInfo["todos"][number];

type TodoEditDraft = {
  title: string;
  priority: TaskPriority;
  dueDate: string;
  notes: string;
};

type TodoCardItem = {
  key: string;
  conversationId: string;
  conversationDate: string;
  conversationPreview: string;
  todo: TodoSuggestion;
  index: number;
};

function normalizeTodoSuggestion(todo: TodoSuggestion): TodoSuggestion | null {
  const title = todo.title?.trim() ?? "";
  if (!title) {
    return null;
  }
  const dueDate = normalizeTodoDueDate(todo.dueDate);
  const priority = normalizeTodoPriority(todo.priority);
  const notes = todo.notes?.trim() ?? "";
  return {
    title,
    dueDate: dueDate || undefined,
    priority,
    notes: notes || undefined
  };
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

function normalizeTodoPriority(value?: TaskPriority): TaskPriority {
  if (value === "low" || value === "medium" || value === "high" || value === "urgent") {
    return value;
  }
  return "medium";
}

function buildTodoKey(title: string, dueDate: string, priority: TaskPriority) {
  return `${title.trim()}|${dueDate}|${priority}`;
}

function buildTodoTitleKey(title: string) {
  return title.trim().toLowerCase();
}

function extractTitleKeyFromTodoKey(key: string) {
  const title = key.split("|")[0] ?? key;
  return buildTodoTitleKey(title);
}

function buildTodoKeyFromTodo(todo: TodoSuggestion) {
  const title = todo.title?.trim() ?? "";
  const dueDate = normalizeTodoDueDate(todo.dueDate);
  const priority = normalizeTodoPriority(todo.priority);
  return buildTodoKey(title, dueDate, priority);
}

function buildTodoKeyFromTask(task: Task) {
  const title = task.title?.trim() ?? "";
  const dueDate = normalizeTodoDueDate(task.deadline ?? "");
  const priority = normalizeTodoPriority(task.priority);
  return buildTodoKey(title, dueDate, priority);
}

function buildTodoTitleKeyFromTodo(todo: TodoSuggestion) {
  return buildTodoTitleKey(todo.title ?? "");
}

function buildTodoTitleKeyFromTask(task: Task) {
  return buildTodoTitleKey(task.title ?? "");
}

type TaskRowProps = {
  task: Task;
  isSaving: boolean;
  onUpdate: (id: string, input: TaskUpdateInput) => Promise<void>;
  onComplete: (id: string) => Promise<void>;
  onDelete: (id: string) => void;
};

function TaskRow({ task, isSaving, onUpdate, onComplete, onDelete }: TaskRowProps) {
  const [deadline, setDeadline] = useState(task.deadline ?? "");
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [descriptionDraft, setDescriptionDraft] = useState(task.description ?? "");

  useEffect(() => {
    setDeadline(task.deadline ?? "");
    setPriority(task.priority);
  }, [task.deadline, task.priority]);

  useEffect(() => {
    setTitleDraft(task.title);
    setDescriptionDraft(task.description ?? "");
  }, [task.title, task.description]);

  // 自动保存：当优先级或截止时间变化时
  useEffect(() => {
    // 跳过初始化和已完成任务
    if (task.status === "completed") return;
    // 检查是否有变化
    const deadlineNormalized = deadline.trim() || null;
    if (priority !== task.priority || deadlineNormalized !== task.deadline) {
      const timer = setTimeout(() => {
        void onUpdate(task.id, {
          priority,
          deadline: deadlineNormalized
        });
      }, 500); // 防抖 500ms
      return () => clearTimeout(timer);
    }
  }, [priority, deadline, task.id, task.priority, task.deadline, task.status, onUpdate]);

  // 自动保存：标题与备注
  useEffect(() => {
    if (task.status === "completed") return;
    const nextTitle = titleDraft.trim();
    if (!nextTitle) {
      return;
    }
    const nextDescription = descriptionDraft.trim();
    const nextNormalizedDescription = nextDescription ? nextDescription : null;
    const needsUpdate =
      nextTitle !== task.title ||
      (task.description ?? null) !== nextNormalizedDescription;
    if (!needsUpdate) return;
    const timer = setTimeout(() => {
      void onUpdate(task.id, {
        title: nextTitle,
        description: nextNormalizedDescription
      });
    }, 600);
    return () => clearTimeout(timer);
  }, [
    titleDraft,
    descriptionDraft,
    task.id,
    task.title,
    task.description,
    task.status,
    onUpdate
  ]);

  const statusColor = STATUS_COLORS[task.status];
  const actions: React.ReactNode[] = [];
  const deadlineLabel = deadline.trim() ? deadline : "未设置";

  if (task.status !== "completed") {
    actions.push(
      <Button
        key="complete"
        size="small"
        type="primary"
        onClick={() => onComplete(task.id)}
        loading={isSaving}
      >
        完成
      </Button>
    );
  }
  actions.push(
    <Button
      key="delete"
      size="small"
      danger
      onClick={() => onDelete(task.id)}
      loading={isSaving}
    >
      删除
    </Button>
  );

  return (
    <List.Item
      className={
        task.status === "completed" ? "task-item completed" : "task-item"
      }
    >
      <div className="task-main">
        <div className="task-head">
          <div className="task-title-block">
            <Input.TextArea
              value={titleDraft}
              placeholder="任务标题"
              onChange={(event) => setTitleDraft(event.target.value)}
              className="task-title-input"
              autoSize={{ minRows: 1, maxRows: 2 }}
              disabled={task.status === "completed"}
            />
          </div>
          <div className="task-head-meta">
            <div className="task-tags">
              <Tag color={PRIORITY_COLORS[priority]}>{PRIORITY_LABELS[priority]}</Tag>
              <Tag color={statusColor}>{STATUS_LABELS[task.status]}</Tag>
            </div>
            <Text type="secondary" className="task-deadline-inline">
              截止 {deadlineLabel}
            </Text>
          </div>
        </div>
        <div className="task-notes-row">
          <div className="task-notes">
            <div className="task-notes-label">
              <Text type="secondary">备注</Text>
              <Text type="secondary" className="task-notes-hint">
                可选
              </Text>
            </div>
            <Input.TextArea
              value={descriptionDraft}
              placeholder="补充说明..."
              autoSize={{ minRows: 1, maxRows: 3 }}
              onChange={(event) => setDescriptionDraft(event.target.value)}
              className="task-notes-input"
              disabled={task.status === "completed"}
            />
          </div>
          <div className="task-actions">
            {task.status !== "completed" && (
              <Button
                size="small"
                type="primary"
                onClick={() => onComplete(task.id)}
                loading={isSaving}
              >
                完成
              </Button>
            )}
            <Button
              size="small"
              danger
              onClick={() => onDelete(task.id)}
              loading={isSaving}
            >
              删除
            </Button>
          </div>
        </div>
        <div className="task-controls">
          <span className="task-control-group">
            <Text type="secondary">优先级</Text>
            <Select
              value={priority}
              options={TASK_PRIORITY_OPTIONS}
              onChange={(value) => setPriority(value as TaskPriority)}
              disabled={task.status === "completed"}
            />
          </span>
          <span className="task-control-group">
            <Text type="secondary">截止时间</Text>
            <Input
              type="date"
              value={deadline}
              onChange={(event) => setDeadline(event.target.value)}
              disabled={task.status === "completed"}
            />
          </span>
        </div>
      </div>
    </List.Item>
  );
}

type ReportListProps = {
  items: string[];
};

function ReportList({ items }: ReportListProps) {
  if (!items || items.length === 0) {
    return <Text type="secondary">暂无</Text>;
  }
  return (
    <ul className="report-list">
      {items.map((item, index) => (
        <li key={`${item}-${index}`}>{item}</li>
      ))}
    </ul>
  );
}
export default function App() {
  const { appMode, setAppMode } = useAppStore();
  const {
    diaries,
    activeDiary,
    title,
    editorContent,
    isLoading: isDiaryLoading,
    isSaving: isDiarySaving,
    error: diaryError,
    loadDiaries,
    selectDiary,
    createDiary,
    clearActiveDiary,
    saveDiary,
    deleteDiary,
    setTitle,
    setEditorContent,
    clearError: clearDiaryError
  } = useDiaryStore();
  const {
    conversations,
    activeConversation,
    messageInput,
    isLoading: isConversationLoading,
    isSending,
    isGenerating,
    error: conversationError,
    loadConversations,
    createConversation,
    selectConversation,
    deleteConversation,
    sendMessage,
    generateDiaryDraft,
    detectTodos,
    updateConversationExtractedInfo,
    setMessageInput,
    clearError: clearConversationError
  } = useConversationStore();
  const {
    tasks,
    isLoading: isTaskLoading,
    isSaving: isTaskSaving,
    error: taskError,
    loadTasks,
    createTask,
    updateTask,
    completeTask,
    deleteTask,
    clearError: clearTaskError
  } = useTaskStore();
  const {
    reports,
    activeReport,
    weekStart,
    weekEnd,
    stats: reportStats,
    isLoading: isReportLoading,
    isGenerating: isReportGenerating,
    isSaving: isReportSaving,
    error: reportError,
    setWeekRange,
    loadStats,
    loadReports,
    selectReport,
    generateReport,
    updateReport,
    deleteReport,
    clearError: clearReportError
  } = useWeeklyReportStore();

  const [settings, setSettings] = useState<AppSettingsPublic | null>(null);
  const [themeInput, setThemeInput] = useState<AppSettingsPublic["theme"]>("light");
  const [aiKeyInput, setAiKeyInput] = useState("");
  const [aiBaseUrlInput, setAiBaseUrlInput] = useState("");
  const [aiModelInput, setAiModelInput] = useState("");
  const [isSettingsLoading, setIsSettingsLoading] = useState(false);
  const [isSavingAppearance, setIsSavingAppearance] = useState(false);
  const [isSavingAiSettings, setIsSavingAiSettings] = useState(false);
  const [isSavingMode, setIsSavingMode] = useState(false);
  const [lastBackupPath, setLastBackupPath] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [activeTab, setActiveTab] = useState("diary");
  const [diarySearch, setDiarySearch] = useState("");
  const [draftDate, setDraftDate] = useState<string | null>(null);
  const [aiNoticeCollapsed, setAiNoticeCollapsed] = useState(false);
  const [isAiNoticeClosed, setIsAiNoticeClosed] = useState(false);
  const [isCalendarCollapsed, setIsCalendarCollapsed] = useState(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [calendarValue, setCalendarValue] = useState<Dayjs>(() => dayjs());
  const quillRef = useRef<ReactQuill | null>(null);
  const chatMessagesRef = useRef<HTMLDivElement | null>(null);
  const [isEditingReport, setIsEditingReport] = useState(false);
  const [reportDraft, setReportDraft] = useState<{
    title: string;
    summary: string;
    highlights: string;
    improvements: string;
    nextWeekPlan: string;
  } | null>(null);
  const [chatStyle, setChatStyle] = useState(CHAT_STYLE_OPTIONS[0]?.value ?? "concise");
  const [todoEditTarget, setTodoEditTarget] = useState<{
    conversationId: string;
    index: number;
  } | null>(null);
  const [todoEditDraft, setTodoEditDraft] = useState<TodoEditDraft | null>(null);
  const [todoActionKey, setTodoActionKey] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskPriority, setNewTaskPriority] = useState<TaskPriority>("medium");
  const [newTaskDeadline, setNewTaskDeadline] = useState("");

  const pendingTasks = useMemo(
    () => tasks.filter((task) => task.status !== "completed"),
    [tasks]
  );
  const completedTasks = useMemo(
    () => tasks.filter((task) => task.status === "completed"),
    [tasks]
  );
  const existingTaskKeys = useMemo(() => {
    const keys = new Set<string>();
    tasks.forEach((task) => {
      keys.add(buildTodoKeyFromTask(task));
    });
    return keys;
  }, [tasks]);
  const existingTaskTitleKeys = useMemo(() => {
    const keys = new Set<string>();
    tasks.forEach((task) => {
      keys.add(buildTodoTitleKeyFromTask(task));
    });
    return keys;
  }, [tasks]);
  const chatStylePrompt = useMemo(() => {
    const match = CHAT_STYLE_OPTIONS.find((option) => option.value === chatStyle);
    return match?.prompt ?? "";
  }, [chatStyle]);
  const todoCards = useMemo(() => {
    const items: TodoCardItem[] = [];
    conversations.forEach((conversation) => {
      const info = normalizeExtractedInfo(conversation.extractedInfo);
      const dismissed = new Set(info.dismissedTodos ?? []);
      const dismissedTitleKeys = new Set(
        (info.dismissedTodos ?? []).map((key) => extractTitleKeyFromTodoKey(key))
      );
      info.todos.forEach((todo, index) => {
        if (!todo.title?.trim()) {
          return;
        }
        const key = buildTodoKeyFromTodo(todo);
        const titleKey = buildTodoTitleKeyFromTodo(todo);
        if (
          dismissed.has(key) ||
          dismissedTitleKeys.has(titleKey) ||
          existingTaskKeys.has(key) ||
          existingTaskTitleKeys.has(titleKey)
        ) {
          return;
        }
        const lastMessage =
          conversation.messages[conversation.messages.length - 1]?.content ?? "";
        items.push({
          key: `${conversation.id}:${index}`,
          conversationId: conversation.id,
          conversationDate: conversation.date,
          conversationPreview: lastMessage.slice(0, 32),
          todo,
          index
        });
      });
    });
    return items;
  }, [conversations, existingTaskKeys, existingTaskTitleKeys]);
  const diaryByDate = useMemo(() => {
    const map = new Map<string, (typeof diaries)[number]>();
    diaries.forEach((diary) => {
      if (!map.has(diary.date)) {
        map.set(diary.date, diary);
      }
    });
    return map;
  }, [diaries]);
  const diaryHighlightDates = useMemo(() => {
    const set = new Set<string>();
    diaries.forEach((diary) => {
      const title = diary.title?.trim() ?? "";
      if (title.length > 0 || hasDiaryContent(diary.content)) {
        set.add(diary.date);
      }
    });
    return set;
  }, [diaries]);
  const diarySearchValue = diarySearch.trim().toLowerCase();
  const filteredDiaries = useMemo(() => {
    if (!diarySearchValue) {
      return diaries;
    }
    return diaries.filter((diary) => {
      const titleText = diary.title ?? "";
      const contentText = diary.content ? stripHtmlText(diary.content) : "";
      const dateText = diary.date ?? "";
      const haystack = `${titleText} ${contentText} ${dateText}`.toLowerCase();
      return haystack.includes(diarySearchValue);
    });
  }, [diaries, diarySearchValue]);
  const draftWordCount = useMemo(
    () => stripHtmlText(editorContent).length,
    [editorContent]
  );
  const isDrafting = Boolean(draftDate && !activeDiary);
  const editorDateLabel = activeDiary?.date ?? draftDate ?? "";
  const editorWordCount = activeDiary?.wordCount ?? draftWordCount;

  const applySettings = useCallback(
    (nextSettings: AppSettingsPublic) => {
      setSettings(nextSettings);
      setAppMode(nextSettings.appMode);
      setThemeInput(nextSettings.theme);
      setAiKeyInput(nextSettings.aiApiKey ?? "");
      setAiBaseUrlInput(nextSettings.aiBaseUrl ?? "");
      setAiModelInput(nextSettings.aiModel ?? "");
      document.body.dataset.theme = nextSettings.theme;
      setIsOnboardingOpen(nextSettings.firstLaunch);
    },
    [setAppMode]
  );

  useEffect(() => {
    let cancelled = false;
    const loadSettings = async () => {
      setIsSettingsLoading(true);
      try {
        const nextSettings = await settingsService.get();
        if (!cancelled) {
          applySettings(nextSettings);
        }
      } catch (err) {
        message.error(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) {
          setIsSettingsLoading(false);
        }
      }
    };
    void loadSettings();
    return () => {
      cancelled = true;
    };
  }, [applySettings]);

  useEffect(() => {
    void loadDiaries();
  }, [loadDiaries]);

  useEffect(() => {
    if (activeDiary?.date) {
      setCalendarValue(dayjs(activeDiary.date));
    }
  }, [activeDiary?.date]);

  useEffect(() => {
    if (appMode === "ai") {
      void loadConversations();
      void loadTasks();
      void loadReports();
    }
  }, [appMode, loadConversations, loadTasks, loadReports]);

  useEffect(() => {
    installNetworkGuard(appMode, (blockedMessage) => {
      message.warning(blockedMessage);
    });
  }, [appMode]);

  useEffect(() => {
    if (!conversationError) {
      return;
    }
    const timer = window.setTimeout(() => {
      clearConversationError();
    }, 10000);
    return () => window.clearTimeout(timer);
  }, [conversationError, clearConversationError]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(AI_NOTICE_STORAGE_KEY);
      if (stored === "true") {
        setAiNoticeCollapsed(true);
      }
    } catch {
      setAiNoticeCollapsed(false);
    }
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(CHAT_STYLE_STORAGE_KEY);
      if (stored && CHAT_STYLE_OPTIONS.some((option) => option.value === stored)) {
        setChatStyle(stored);
      }
    } catch {
      setChatStyle(CHAT_STYLE_OPTIONS[0]?.value ?? "concise");
    }
  }, []);

  useEffect(() => {
    if (appMode !== "ai" && activeTab !== "diary" && activeTab !== "settings") {
      setActiveTab("diary");
    }
  }, [appMode, activeTab]);

  useEffect(() => {
    if (activeDiary) {
      setDraftDate(null);
    }
  }, [activeDiary?.id]);

  useEffect(() => {
    if (activeTab !== "diary" && draftDate && !activeDiary) {
      setDraftDate(null);
      clearActiveDiary();
    }
  }, [activeTab, activeDiary, clearActiveDiary, draftDate]);

  useEffect(() => {
    if (activeReport?.reportContent) {
      setReportDraft({
        title: activeReport.reportContent.title,
        summary: activeReport.reportContent.summary,
        highlights: joinLines(activeReport.reportContent.highlights),
        improvements: joinLines(activeReport.reportContent.improvements),
        nextWeekPlan: joinLines(activeReport.reportContent.nextWeekPlan)
      });
    } else {
      setReportDraft(null);
    }
    setIsEditingReport(false);
  }, [activeReport?.reportContent]);

  // 当消息更新或切换到对话标签时自动滚动到底部
  useEffect(() => {
    if (chatMessagesRef.current && activeConversation?.messages.length) {
      chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
    }
  }, [activeConversation?.messages, activeTab]);

  const isAiSettingsDisabled = appMode !== "ai";
  const aiModelLabel = settings?.aiModel?.trim() || "未设置";
  const aiBaseUrlLabel = settings?.aiBaseUrl?.trim() || "未设置";
  const aiApiKeyLabel = settings?.aiApiKeySet ? "已设置" : "未设置";
  const reportDraftValue = reportDraft ?? {
    title: "",
    summary: "",
    highlights: "",
    improvements: "",
    nextWeekPlan: ""
  };
  const calendarCellRender: CalendarProps<Dayjs>["fullCellRender"] = (date, info) => {
    if (info.type !== "date") {
      return info.originNode;
    }
    const key = date.format("YYYY-MM-DD");
    const hasDiary = diaryHighlightDates.has(key);
    const isSelected = calendarValue.isSame(date, "day");
    return (
      <div
        className={`calendar-cell${hasDiary ? " has-diary" : ""}${isSelected ? " is-selected" : ""
          }`}
      >
        <div className="calendar-date">{date.date()}</div>
        {hasDiary ? <span className="calendar-dot" /> : null}
      </div>
    );
  };
  const calendarHeaderRender: CalendarProps<Dayjs>["headerRender"] = ({
    value,
    onChange
  }) => {
    const currentYear = value.year();
    const currentMonth = value.month();
    const yearOptions = [];
    for (let offset = -5; offset <= 5; offset += 1) {
      const year = currentYear + offset;
      yearOptions.push({ label: `${year}年`, value: year });
    }
    const monthOptions = Array.from({ length: 12 }, (_, index) => ({
      label: `${index + 1}月`,
      value: index
    }));

    return (
      <div className="calendar-header">
        <Select
          size="small"
          value={currentYear}
          options={yearOptions}
          onChange={(nextYear) => onChange(value.year(nextYear))}
        />
        <Select
          size="small"
          value={currentMonth}
          options={monthOptions}
          onChange={(nextMonth) => onChange(value.month(nextMonth))}
        />
      </div>
    );
  };
  const handleCalendarSelect: CalendarProps<Dayjs>["onSelect"] = (value) => {
    setCalendarValue(value);
    const key = value.format("YYYY-MM-DD");
    const diary = diaryByDate.get(key);
    if (diary) {
      setDraftDate(null);
      void selectDiary(diary.id);
    } else {
      setDraftDate(key);
      clearActiveDiary();
      setTitle("");
      setEditorContent(EMPTY_EDITOR_CONTENT);
    }
  };
  const handleCalendarPanelChange: CalendarProps<Dayjs>["onPanelChange"] = (
    value
  ) => {
    setCalendarValue(value);
  };
  const handleModeChange = async (value: DiaryMode) => {
    setIsSavingMode(true);
    try {
      const nextSettings = await settingsService.set({ appMode: value });
      applySettings(nextSettings);
      // 切换到AI模式时重置提示状态
      if (value === "ai") {
        setIsAiNoticeClosed(false);
        setAiNoticeCollapsed(false);
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSavingMode(false);
    }
  };

  const handleThemeChange = async (value: AppSettingsPublic["theme"]) => {
    setThemeInput(value);
    setIsSavingAppearance(true);
    try {
      const nextSettings = await settingsService.set({ theme: value });
      applySettings(nextSettings);
      message.success("已切换主题");
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
      if (settings) {
        setThemeInput(settings.theme);
      }
    } finally {
      setIsSavingAppearance(false);
    }
  };

  const handleSaveAiSettings = async () => {
    if (isAiSettingsDisabled) {
      return;
    }
    const apiKey = aiKeyInput.trim();
    const baseUrl = aiBaseUrlInput.trim();
    const model = aiModelInput.trim() || "gpt-4";

    setIsSavingAiSettings(true);
    try {
      const nextSettings = await settingsService.set({
        aiApiKey: apiKey.length > 0 ? apiKey : null,
        aiBaseUrl: baseUrl.length > 0 ? baseUrl : null,
        aiModel: model
      });
      applySettings(nextSettings);
      message.success("AI 设置已保存");
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSavingAiSettings(false);
    }
  };

  const handleToggleAiNotice = (collapsed: boolean) => {
    setAiNoticeCollapsed(collapsed);
    try {
      window.localStorage.setItem(
        AI_NOTICE_STORAGE_KEY,
        collapsed ? "true" : "false"
      );
    } catch {
      // ignore storage errors
    }
  };

  const handleCloseAiNotice = () => {
    setIsAiNoticeClosed(true);
  };

  const handleChatStyleChange = (value: string) => {
    setChatStyle(value);
    try {
      window.localStorage.setItem(CHAT_STYLE_STORAGE_KEY, value);
    } catch {
      // ignore storage errors
    }
  };

  const handleStartTodoEdit = useCallback((item: TodoCardItem) => {
    setTodoEditTarget({ conversationId: item.conversationId, index: item.index });
    setTodoEditDraft({
      title: item.todo.title ?? "",
      priority: normalizeTodoPriority(item.todo.priority),
      dueDate: normalizeTodoDueDate(item.todo.dueDate),
      notes: item.todo.notes ?? ""
    });
  }, []);

  const handleCancelTodoEdit = useCallback(() => {
    setTodoEditTarget(null);
    setTodoEditDraft(null);
  }, []);

  const handleSaveTodoEdit = useCallback(async () => {
    if (!todoEditTarget || !todoEditDraft) {
      return;
    }
    const conversation = conversations.find(
      (item) => item.id === todoEditTarget.conversationId
    );
    if (!conversation) {
      message.error("对话不存在");
      return;
    }
    const currentInfo = normalizeExtractedInfo(conversation.extractedInfo);
    const currentTodo = currentInfo.todos[todoEditTarget.index];
    if (!currentTodo) {
      message.info("待办已更新");
      handleCancelTodoEdit();
      return;
    }
    const title = todoEditDraft.title.trim();
    if (!title) {
      message.error("事项不能为空");
      return;
    }
    const updatedTodo: TodoSuggestion = {
      title,
      priority: normalizeTodoPriority(todoEditDraft.priority),
      dueDate: normalizeTodoDueDate(todoEditDraft.dueDate) || undefined,
      notes: todoEditDraft.notes.trim() || undefined
    };
    const nextTodos = [...currentInfo.todos];
    nextTodos[todoEditTarget.index] = updatedTodo;
    setTodoActionKey(`${conversation.id}:${todoEditTarget.index}:save`);
    const updated = await updateConversationExtractedInfo(conversation.id, {
      ...currentInfo,
      todos: nextTodos
    });
    setTodoActionKey(null);
    if (updated) {
      message.success("已更新待办");
      handleCancelTodoEdit();
    }
  }, [
    conversations,
    handleCancelTodoEdit,
    todoEditDraft,
    todoEditTarget,
    updateConversationExtractedInfo
  ]);

  const handleDeleteTodo = useCallback(
    async (item: TodoCardItem) => {
      const conversation = conversations.find(
        (entry) => entry.id === item.conversationId
      );
      if (!conversation) {
        message.error("对话不存在");
        return;
      }
      const currentInfo = normalizeExtractedInfo(conversation.extractedInfo);
      const currentTodo = currentInfo.todos[item.index];
      if (!currentTodo) {
        return;
      }
      const nextTodos = currentInfo.todos.filter((_, idx) => idx !== item.index);
      const nextDismissed = new Set(currentInfo.dismissedTodos ?? []);
      const todoKey = buildTodoKeyFromTodo(currentTodo);
      const titleKey = buildTodoTitleKeyFromTodo(currentTodo);
      if (todoKey.trim()) {
        nextDismissed.add(todoKey);
      }
      if (titleKey.trim()) {
        nextDismissed.add(titleKey);
      }
      setTodoActionKey(`${conversation.id}:${item.index}:delete`);
      await updateConversationExtractedInfo(conversation.id, {
        ...currentInfo,
        todos: nextTodos,
        dismissedTodos: Array.from(nextDismissed)
      });
      setTodoActionKey(null);
      if (
        todoEditTarget?.conversationId === item.conversationId &&
        todoEditTarget.index >= item.index
      ) {
        handleCancelTodoEdit();
      }
      message.success("已删除待办");
    },
    [conversations, handleCancelTodoEdit, todoEditTarget, updateConversationExtractedInfo]
  );

  const handleAddTodo = useCallback(
    async (item: TodoCardItem) => {
      const conversation = conversations.find(
        (entry) => entry.id === item.conversationId
      );
      if (!conversation) {
        message.error("对话不存在");
        return;
      }
      const currentInfo = normalizeExtractedInfo(conversation.extractedInfo);
      const currentTodo = currentInfo.todos[item.index];
      if (!currentTodo) {
        message.info("待办已更新");
        return;
      }
      const isEditing =
        todoEditTarget?.conversationId === item.conversationId &&
        todoEditTarget.index === item.index;
      const draft = isEditing ? todoEditDraft : null;
      const sourceTodo = draft
        ? {
            title: draft.title,
            priority: draft.priority,
            dueDate: draft.dueDate,
            notes: draft.notes
          }
        : currentTodo;
      const title = sourceTodo.title?.trim() ?? "";
      if (!title) {
        message.error("事项不能为空");
        return;
      }
      const deadline = normalizeTodoDueDate(sourceTodo.dueDate);
      const priority = normalizeTodoPriority(sourceTodo.priority);
      setTodoActionKey(`${conversation.id}:${item.index}:add`);
      const created = await createTask({
        title,
        description: sourceTodo.notes?.trim() || undefined,
        priority,
        deadline: deadline || undefined,
        conversationId: conversation.id
      });
      if (created) {
      const nextTodos = currentInfo.todos.filter((_, idx) => idx !== item.index);
      const nextDismissed = new Set(currentInfo.dismissedTodos ?? []);
      const dismissedKey = buildTodoKey(
        title,
        normalizeTodoDueDate(sourceTodo.dueDate),
        normalizeTodoPriority(sourceTodo.priority)
      );
      const dismissedTitleKey = buildTodoTitleKey(title);
      if (dismissedKey.trim()) {
        nextDismissed.add(dismissedKey);
      }
      if (dismissedTitleKey.trim()) {
        nextDismissed.add(dismissedTitleKey);
      }
        await updateConversationExtractedInfo(conversation.id, {
          ...currentInfo,
          todos: nextTodos,
          dismissedTodos: Array.from(nextDismissed)
        });
        message.success("已加入待办");
        if (
          todoEditTarget?.conversationId === item.conversationId &&
          todoEditTarget.index >= item.index
        ) {
          handleCancelTodoEdit();
        }
      } else {
        message.error("保存待办失败");
      }
      setTodoActionKey(null);
    },
    [
      conversations,
      createTask,
      handleCancelTodoEdit,
      todoEditDraft,
      todoEditTarget,
      updateConversationExtractedInfo
    ]
  );

  const mergeDetectedTodos = useCallback(
    async (detected: ExtractedInfo | null) => {
      if (!detected?.todos?.length) {
        return;
      }
      const currentConversation = useConversationStore.getState().activeConversation;
      if (!currentConversation) {
        return;
      }
      const currentInfo = normalizeExtractedInfo(currentConversation.extractedInfo);
      const dismissed = new Set([
        ...(currentInfo.dismissedTodos ?? []),
        ...(detected.dismissedTodos ?? [])
      ]);
      const dismissedTitleKeys = new Set(
        Array.from(dismissed).map((key) => extractTitleKeyFromTodoKey(key))
      );
      const existingKeys = new Set<string>();
      const existingTitleKeys = new Set<string>();
      const nextTodos: TodoSuggestion[] = [];
      currentInfo.todos.forEach((todo) => {
        const normalized = normalizeTodoSuggestion(todo);
        if (!normalized) {
          return;
        }
        const key = buildTodoKeyFromTodo(normalized);
        const titleKey = buildTodoTitleKeyFromTodo(normalized);
        if (!key.trim()) {
          return;
        }
        if (
          dismissed.has(key) ||
          dismissedTitleKeys.has(titleKey) ||
          existingTaskKeys.has(key) ||
          existingTaskTitleKeys.has(titleKey) ||
          existingKeys.has(key) ||
          existingTitleKeys.has(titleKey)
        ) {
          return;
        }
        existingKeys.add(key);
        existingTitleKeys.add(titleKey);
        nextTodos.push(normalized);
      });
      let added = 0;
      detected.todos.forEach((todo) => {
        const normalized = normalizeTodoSuggestion(todo);
        if (!normalized) {
          return;
        }
        const key = buildTodoKeyFromTodo(normalized);
        const titleKey = buildTodoTitleKeyFromTodo(normalized);
        if (!key.trim()) {
          return;
        }
        if (
          dismissed.has(key) ||
          dismissedTitleKeys.has(titleKey) ||
          existingTaskKeys.has(key) ||
          existingTaskTitleKeys.has(titleKey) ||
          existingKeys.has(key) ||
          existingTitleKeys.has(titleKey)
        ) {
          return;
        }
        existingKeys.add(key);
        existingTitleKeys.add(titleKey);
        nextTodos.push(normalized);
        added += 1;
      });
      if (added === 0 && nextTodos.length === currentInfo.todos.length) {
        return;
      }
      await updateConversationExtractedInfo(currentConversation.id, {
        ...currentInfo,
        todos: nextTodos,
        dismissedTodos: Array.from(dismissed)
      });
    },
    [existingTaskKeys, existingTaskTitleKeys, updateConversationExtractedInfo]
  );

  const handleSaveDiary = useCallback(async () => {
    if (activeDiary) {
      const saved = await saveDiary();
      if (saved) {
        message.success("日记已保存");
      }
      return;
    }
    if (!draftDate) {
      message.warning("请选择或新建日记");
      return;
    }
    const created = await createDiary(appMode, draftDate, {
      title: title.trim() || "Untitled",
      content: editorContent || EMPTY_EDITOR_CONTENT
    });
    if (created) {
      setDraftDate(null);
      message.success("日记已保存");
    } else {
      message.error("保存失败");
    }
  }, [activeDiary, appMode, createDiary, draftDate, editorContent, saveDiary, title]);

  const handleDeleteDiary = useCallback(() => {
    if (!activeDiary) {
      if (draftDate) {
        setDraftDate(null);
        clearActiveDiary();
        message.info("已放弃未保存日记");
      }
      return;
    }
    Modal.confirm({
      title: "删除日记？",
      content: "删除后无法恢复。",
      okText: "删除",
      okType: "danger",
      cancelText: "取消",
      onOk: () => deleteDiary(activeDiary.id)
    });
  }, [activeDiary, clearActiveDiary, deleteDiary, draftDate]);

  const handleSendMessage = useCallback(async () => {
    const content = messageInput.trim();
    if (!content) {
      return;
    }
    await sendMessage(chatStylePrompt || undefined);
    const detected = await detectTodos();
    await mergeDetectedTodos(detected);
  }, [chatStylePrompt, detectTodos, mergeDetectedTodos, messageInput, sendMessage]);

  const handleCreateTask = useCallback(async () => {
    const title = newTaskTitle.trim();
    if (!title) {
      message.error("任务标题不能为空");
      return;
    }
    const deadline = normalizeTodoDueDate(newTaskDeadline);
    const created = await createTask({
      title,
      priority: newTaskPriority,
      deadline: deadline || undefined
    });
    if (created) {
      message.success("任务已新增");
      setNewTaskTitle("");
      setNewTaskPriority("medium");
      setNewTaskDeadline("");
    } else {
      message.error("新增任务失败");
    }
  }, [createTask, newTaskDeadline, newTaskPriority, newTaskTitle]);

  const handleGenerateDiary = useCallback(async () => {
    const diary = await generateDiaryDraft(chatStylePrompt || undefined);
    if (diary) {
      await loadDiaries();
      await selectDiary(diary.id);
      setActiveTab("diary");
      message.success("已生成日记草稿");
    }
  }, [chatStylePrompt, generateDiaryDraft, loadDiaries, selectDiary]);

  const handleExportBackup = useCallback(async () => {
    setIsExporting(true);
    try {
      const result = await backupService.exportDatabase();
      if (result?.path) {
        setLastBackupPath(result.path);
        message.success("已导出备份");
      } else {
        message.info("已取消导出");
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setIsExporting(false);
    }
  }, []);

  const handleImportBackup = useCallback(async () => {
    setIsImporting(true);
    try {
      const result = await backupService.importDatabase();
      if (result?.path) {
        setLastBackupPath(result.path);
        await loadDiaries();
        if (appMode === "ai") {
          await loadConversations();
          await loadTasks();
          await loadReports();
        }
        message.success("已导入备份");
      } else {
        message.info("已取消导入");
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setIsImporting(false);
    }
  }, [appMode, loadConversations, loadDiaries, loadReports, loadTasks]);

  const handleDeleteConversation = useCallback(
    (conversationId: string) => {
      Modal.confirm({
        title: "删除对话？",
        content: "删除后无法恢复。",
        okText: "删除",
        okType: "danger",
        cancelText: "取消",
        onOk: () => deleteConversation(conversationId)
      });
    },
    [deleteConversation]
  );

  const handleDeleteTask = useCallback(
    (taskId: string) => {
      Modal.confirm({
        title: "删除任务？",
        content: "删除后无法恢复。",
        okText: "删除",
        okType: "danger",
        cancelText: "取消",
        onOk: () => deleteTask(taskId)
      });
    },
    [deleteTask]
  );

  const handleWeekStartChange = (event: ChangeEvent<HTMLInputElement>) => {
    setWeekRange(event.target.value, weekEnd);
  };

  const handleWeekEndChange = (event: ChangeEvent<HTMLInputElement>) => {
    setWeekRange(weekStart, event.target.value);
  };

  const handleGenerateWeeklyReport = useCallback(async () => {
    const report = await generateReport();
    if (report) {
      message.success("周报已生成");
    }
  }, [generateReport]);

  const handleStartEditReport = () => {
    if (!activeReport?.reportContent) {
      return;
    }
    setIsEditingReport(true);
  };

  const handleCancelEditReport = () => {
    if (activeReport?.reportContent) {
      setReportDraft({
        title: activeReport.reportContent.title,
        summary: activeReport.reportContent.summary,
        highlights: joinLines(activeReport.reportContent.highlights),
        improvements: joinLines(activeReport.reportContent.improvements),
        nextWeekPlan: joinLines(activeReport.reportContent.nextWeekPlan)
      });
    }
    setIsEditingReport(false);
  };

  const handleSaveReport = async () => {
    if (!activeReport || !reportDraft) {
      return;
    }
    const payload = {
      title: reportDraft.title.trim() || "每周周报",
      summary: reportDraft.summary.trim(),
      highlights: splitLines(reportDraft.highlights),
      improvements: splitLines(reportDraft.improvements),
      nextWeekPlan: splitLines(reportDraft.nextWeekPlan)
    };
    const updated = await updateReport(activeReport.id, {
      reportContent: payload
    });
    if (updated) {
      message.success("周报已更新");
      setIsEditingReport(false);
    }
  };

  const handleDeleteReport = () => {
    if (!activeReport) {
      return;
    }
    Modal.confirm({
      title: "删除周报？",
      content: "删除后无法恢复。",
      okText: "删除",
      okType: "danger",
      cancelText: "取消",
      onOk: () => deleteReport(activeReport.id)
    });
  };

  const handleCopyWeeklyReport = useCallback(() => {
    if (!activeReport?.reportContent) {
      message.warning("暂无可复制内容");
      return;
    }
    const content = activeReport.reportContent;
    const lines = [
      content.title,
      `${activeReport.weekStart} ~ ${activeReport.weekEnd}`,
      "",
      `总结：${content.summary}`,
      "",
      "亮点：",
      ...content.highlights.map((item) => `- ${item}`),
      "",
      "改进：",
      ...content.improvements.map((item) => `- ${item}`),
      "",
      "下周计划：",
      ...content.nextWeekPlan.map((item) => `- ${item}`)
    ].join("\n");

    void navigator.clipboard.writeText(lines);
    message.success("已复制周报");
  }, [activeReport]);

  const handleCloseOnboarding = async () => {
    if (!settings?.firstLaunch) {
      setIsOnboardingOpen(false);
      setOnboardingStep(0);
      return;
    }
    try {
      const nextSettings = await settingsService.set({ firstLaunch: false });
      applySettings(nextSettings);
      setIsOnboardingOpen(false);
      setOnboardingStep(0);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  };

  const handleOnboardingPrev = () => {
    setOnboardingStep((prev) => Math.max(0, prev - 1));
  };

  const handleOnboardingNext = () => {
    if (onboardingStep < ONBOARDING_STEPS.length - 1) {
      setOnboardingStep((prev) => prev + 1);
    } else {
      void handleCloseOnboarding();
    }
  };

  const handleOpenOnboarding = () => {
    setOnboardingStep(0);
    setIsOnboardingOpen(true);
  };

  const modeNoticeText =
    appMode === "ai"
      ? "AI 模式：对话内容会发送到 AI API。"
      : "传统模式完全离线，不会发起任何网络请求。";

  const focusEditor = () => {
    const editor = quillRef.current?.getEditor?.();
    if (editor) {
      editor.focus();
      return;
    }
    quillRef.current?.focus?.();
  };

  return (
    <Layout className="app-shell">
      <Header className="app-header">
        <div className="app-header-inner">
          <div className="app-header-left">
            <Title level={3} className="app-title">
              Smart Diary
            </Title>
          </div>
          <Space>
            <Tooltip title={modeNoticeText} placement="bottomRight">
              <div className="mode-switch-wrapper">
                <Segmented
                  className="mode-switch"
                  options={MODE_OPTIONS}
                  value={appMode}
                  onChange={(value) => handleModeChange(value as DiaryMode)}
                  disabled={isSavingMode || isSettingsLoading}
                />
              </div>
            </Tooltip>
          </Space>
        </div>
      </Header>
      <Content className="app-content">
        {appMode === "ai" && !isAiNoticeClosed ? (
          <div className={`ai-notice${aiNoticeCollapsed ? " is-collapsed" : ""}`}>
            <div className="ai-notice-content">
              <Text strong className="ai-notice-title">
                AI 模式提示
              </Text>
              <Text type="secondary" className="ai-notice-desc">
                {aiNoticeCollapsed
                  ? "AI 模式 · 内容将发送至 AI 服务"
                  : "在 AI 模式下，聊天、生成日记、提取任务等内容会发送到 AI 服务进行处理。"}
              </Text>
            </div>
            <div className="ai-notice-actions">
              <Space size={4}>
                {aiNoticeCollapsed ? (
                  <Button
                    type="link"
                    size="small"
                    onClick={() => handleToggleAiNotice(false)}
                  >
                    展开
                  </Button>
                ) : (
                  <Button size="small" onClick={() => handleToggleAiNotice(true)}>
                    我知道了
                  </Button>
                )}
                <Button
                  type="text"
                  size="small"
                  icon={<CloseOutlined />}
                  onClick={handleCloseAiNotice}
                  title="关闭提示"
                />
              </Space>
            </div>
          </div>
        ) : null}
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: "diary",
              label: "日记",
              children: (
                <Layout className="diary-layout">
                  <Sider width={320} className="diary-sider">
                    <div className="diary-sider-header">
                      <div className="diary-sider-title">
                        <Text strong>日记</Text>
                        <Text type="secondary" className="diary-sider-count">
                          {filteredDiaries.length} 篇
                        </Text>
                      </div>
                      <Button
                        size="small"
                        onClick={() => loadDiaries()}
                        loading={isDiaryLoading}
                      >
                        刷新
                      </Button>
                    </div>
                    <div className="diary-sider-search">
                      <Input
                        placeholder="搜索标题、内容或日期"
                        value={diarySearch}
                        onChange={(event) => setDiarySearch(event.target.value)}
                        allowClear
                      />
                    </div>
                    {diaryError ? (
                      <div className="panel-state panel-state--error">
                        <Alert
                          type="error"
                          message={diaryError}
                          showIcon
                          closable
                          onClose={clearDiaryError}
                          className="panel-state-alert"
                        />
                      </div>
                    ) : null}
                    <div className="diary-sider-scroll">
                      <div
                        className={`diary-calendar-block${isCalendarCollapsed ? " is-collapsed" : ""
                          }`}
                      >
                        <div className="diary-calendar-header">
                          <Text type="secondary">日历</Text>
                          <Button
                            size="small"
                            type="link"
                            onClick={() =>
                              setIsCalendarCollapsed((prev) => !prev)
                            }
                          >
                            {isCalendarCollapsed ? "展开" : "收起"}
                          </Button>
                        </div>
                        <div className="diary-calendar">
                          <Calendar
                            fullscreen={false}
                            value={calendarValue}
                            onSelect={handleCalendarSelect}
                            onPanelChange={handleCalendarPanelChange}
                            locale={calendarLocale}
                            fullCellRender={calendarCellRender}
                            headerRender={calendarHeaderRender}
                          />
                        </div>
                      </div>
                      <div className="diary-list-panel">
                        {isDiaryLoading && diaries.length === 0 ? (
                          <div className="panel-state panel-state--loading">
                            <Spin size="small" />
                            <Text type="secondary">加载中...</Text>
                          </div>
                        ) : (
                          <List
                            className="diary-list"
                            dataSource={filteredDiaries}
                            loading={isDiaryLoading}
                            locale={{
                              emptyText: (
                                <div className="panel-state panel-state--empty">
                                  <Empty
                                    description={
                                      diarySearchValue ? "未找到匹配日记" : "暂无日记"
                                    }
                                  />
                                </div>
                              )
                            }}
                            rowKey={(diary) => diary.id}
                            renderItem={(diary) => {
                              const isActive = diary.id === activeDiary?.id;
                              const preview = stripHtmlText(diary.content ?? "");

                              return (
                                <List.Item
                                  className={isActive ? "diary-item active" : "diary-item"}
                                  onClick={() => void selectDiary(diary.id)}
                                >
                                  <div className="diary-item-content">
                                    <div className="diary-item-header">
                                      <Text className="diary-item-date">
                                        {formatDiaryDate(diary.date)}
                                      </Text>
                                      <Text type="secondary" className="diary-item-words">
                                        {diary.wordCount} 字
                                      </Text>
                                    </div>
                                    <Text className="diary-item-title">
                                      {diary.title?.trim() || "未命名"}
                                    </Text>
                                    {preview ? (
                                      <Text type="secondary" className="diary-item-preview">
                                        {preview}
                                      </Text>
                                    ) : null}
                                  </div>
                                </List.Item>
                              );
                            }}
                          />
                        )}
                      </div>
                      <div className="diary-list-footer">
                        <div className="diary-list-footer-icon">📝</div>
                        <Text type="secondary" className="diary-list-footer-text">
                          记录每一天的故事
                        </Text>
                      </div>
                    </div>
                  </Sider>
                  <Content className="editor-panel">
                    <div className="editor-actions">
                      <Space>
                        <Button
                          onClick={handleSaveDiary}
                          loading={isDiarySaving}
                          disabled={!activeDiary && !draftDate}
                        >
                          保存
                        </Button>
                        <Button
                          danger
                          onClick={handleDeleteDiary}
                          loading={isDiarySaving}
                          disabled={!activeDiary && !draftDate}
                        >
                          删除
                        </Button>
                      </Space>
                    </div>
                    {diaryError && !activeDiary ? (
                      <div className="panel-state panel-state--error">
                        <Alert
                          type="error"
                          message={diaryError}
                          showIcon
                          closable
                          onClose={clearDiaryError}
                          className="panel-state-alert"
                        />
                      </div>
                    ) : isDiaryLoading && !activeDiary && !draftDate ? (
                      <div className="panel-state panel-state--loading">
                        <Spin size="small" />
                        <Text type="secondary">加载中...</Text>
                      </div>
                    ) : activeDiary || draftDate ? (
                      <>
                        <div className="editor-toolbar">
                          <Input
                            className="editor-title"
                            value={title}
                            placeholder="日记标题"
                            onChange={(event) => setTitle(event.target.value)}
                          />
                          <Text type="secondary" className="editor-meta">
                            {editorDateLabel} · {editorWordCount} 字
                            {isDrafting ? " · 未保存" : ""}
                          </Text>
                        </div>
                        <div className="editor-body" onClick={focusEditor}>
                          <ReactQuill
                            ref={quillRef}
                            theme="snow"
                            value={editorContent}
                            onChange={(value) => setEditorContent(value)}
                            className="editor-quill"
                          />
                        </div>
                      </>
                    ) : (
                      <div className="panel-state panel-state--empty">
                        <Empty description="请选择或新建日记" />
                      </div>
                    )}
                  </Content>
                </Layout>
              )
            },
            {
              key: "settings",
              label: "设置",
              children: (
                <div className="settings-layout">
                  <div className="settings-section">
                    <div className="settings-row">
                      <Text strong>外观</Text>
                      <Select
                        value={themeInput}
                        options={THEME_OPTIONS}
                        onChange={(value) =>
                          void handleThemeChange(value as AppSettingsPublic["theme"])
                        }
                        disabled={isSavingAppearance}
                        style={{ width: 120 }}
                      />
                    </div>
                  </div>
                  <div className="settings-section">
                    <Text strong>AI 设置</Text>
                    <Text type="secondary">仅在 AI 模式可用；API Key 仅保存在本地。</Text>
                    <Text type="secondary">
                      Base URL 采用 OpenAI 格式，如 https://api.openai.com/v1；部分服务需要 /v1
                      后缀，请按服务商要求填写。
                    </Text>
                    <Text type="secondary">API Key 状态：{aiApiKeyLabel}</Text>
                    <Space direction="vertical" style={{ width: "100%" }}>
                      <Input.Password
                        placeholder="输入 API Key"
                        value={aiKeyInput}
                        onChange={(event) => setAiKeyInput(event.target.value)}
                        disabled={isAiSettingsDisabled}
                      />
                      <Input
                        placeholder="Base URL（如 https://api.openai.com/v1）"
                        value={aiBaseUrlInput}
                        onChange={(event) => setAiBaseUrlInput(event.target.value)}
                        disabled={isAiSettingsDisabled}
                      />
                      <Space wrap style={{ width: "100%" }}>
                        <Input
                          placeholder="模型 ID"
                          value={aiModelInput}
                          onChange={(event) => setAiModelInput(event.target.value)}
                          disabled={isAiSettingsDisabled}
                        />
                        <Button
                          onClick={handleSaveAiSettings}
                          loading={isSavingAiSettings}
                          disabled={isAiSettingsDisabled}
                        >
                          保存 AI 设置
                        </Button>
                      </Space>
                      {isAiSettingsDisabled ? (
                        <Text type="secondary">切换到 AI 模式后可配置。</Text>
                      ) : null}
                    </Space>
                  </div>
                  <div className="settings-section">
                    <Text strong>备份与恢复</Text>
                    <Text type="secondary">
                      备份文件不包含 AI API Key，导入后需重新配置。
                    </Text>
                    <Space wrap>
                      <Button
                        type="primary"
                        onClick={handleExportBackup}
                        loading={isExporting}
                      >
                        导出备份
                      </Button>
                      <Button danger onClick={handleImportBackup} loading={isImporting}>
                        导入备份
                      </Button>
                    </Space>
                    {lastBackupPath ? (
                      <Text type="secondary">最近文件：{lastBackupPath}</Text>
                    ) : null}
                  </div>
                  <div className="settings-section">
                    <Text strong>帮助与关于</Text>
                    <Text type="secondary">
                      Smart Diary 桌面端，数据完全本地保存。
                    </Text>
                    <Button type="primary" onClick={handleOpenOnboarding} style={{ width: "fit-content" }}>
                      重新查看新手引导
                    </Button>
                  </div>
                </div>
              )
            },
            ...(appMode === "ai"
              ? [
                {
                  key: "ai",
                  label: "对话",
                  children: (
                    <Layout className="chat-layout">
                      <Sider width={260} className="chat-sider">
                        <div className="chat-sider-header">
                          <Text strong>对话列表</Text>
                          <Button
                            size="small"
                            onClick={() => createConversation()}
                            loading={isConversationLoading}
                          >
                            新建
                          </Button>
                        </div>
                        <List
                          className="chat-list"
                          dataSource={conversations}
                          loading={isConversationLoading}
                          locale={{ emptyText: "暂无对话" }}
                          renderItem={(conversation) => {
                            const lastMessage =
                              conversation.messages[conversation.messages.length - 1];
                            return (
                              <List.Item
                                className={
                                  conversation.id === activeConversation?.id
                                    ? "chat-item active"
                                    : "chat-item"
                                }
                                onClick={() => selectConversation(conversation.id)}
                                actions={[
                                  <Button
                                    key="delete"
                                    size="small"
                                    danger
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      handleDeleteConversation(conversation.id);
                                    }}
                                  >
                                    删除
                                  </Button>
                                ]}
                              >
                                <List.Item.Meta
                                  title={`对话 ${conversation.date}`}
                                  description={
                                    lastMessage?.content
                                      ? lastMessage.content.slice(0, 40)
                                      : "空对话"
                                  }
                                />
                              </List.Item>
                            );
                          }}
                        />
                      </Sider>
                      <Content className="chat-panel">
                        {conversationError ? (
                          <Alert
                            type="error"
                            message={conversationError}
                            showIcon
                            closable
                            onClose={clearConversationError}
                            className="app-alert"
                          />
                        ) : null}
                        <div className="chat-header">
                          <div className="chat-header-info">
                            <Text strong>对话内容</Text>
                            <Text type="secondary" className="chat-config">
                              模型 ID：{aiModelLabel} ｜ Base URL：{aiBaseUrlLabel} ｜ API Key：
                              {aiApiKeyLabel}
                            </Text>
                            <div className="chat-style">
                              <Text type="secondary">对话风格</Text>
                              <Select
                                value={chatStyle}
                                options={CHAT_STYLE_OPTIONS.map((option) => ({
                                  label: option.label,
                                  value: option.value
                                }))}
                                onChange={handleChatStyleChange}
                                className="chat-style-select"
                              />
                            </div>
                          </div>
                          <Space>
                            <Button
                              type="primary"
                              onClick={handleGenerateDiary}
                              loading={isGenerating}
                              disabled={!activeConversation}
                            >
                              生成日记
                            </Button>
                          </Space>
                        </div>
                        <div className="chat-messages" ref={chatMessagesRef}>
                          {activeConversation ? (
                            activeConversation.messages.length > 0 ? (
                              activeConversation.messages.map((msg) => (
                                <div key={msg.id} className={`chat-message ${msg.role}`}>
                                  <div className="chat-bubble">
                                    <Text>{msg.content}</Text>
                                    <span className="chat-timestamp">
                                      {new Date(msg.timestamp).toLocaleTimeString()}
                                    </span>
                                  </div>
                                </div>
                              ))
                            ) : (
                              <Empty description="开始一段新的对话吧" />
                            )
                          ) : (
                            <Empty description="请选择或新建对话" />
                          )}
                        </div>
                        <div className="chat-input">
                          <Input.TextArea
                            placeholder="输入你的内容..."
                            value={messageInput}
                            onChange={(event) => setMessageInput(event.target.value)}
                            autoSize={{ minRows: 2, maxRows: 6 }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" && !event.shiftKey) {
                                event.preventDefault();
                                void handleSendMessage();
                              }
                            }}
                          />
                          <Button
                            type="primary"
                            onClick={handleSendMessage}
                            loading={isSending}
                            disabled={isSending || messageInput.trim().length === 0}
                          >
                            发送
                          </Button>
                        </div>
                      </Content>
                      <Sider width={300} className="chat-todo-sider">
                        <div className="chat-sider-header">
                          <Text strong>待办事项</Text>
                          <Text type="secondary">{todoCards.length} 项</Text>
                        </div>
                        <List
                          className="chat-todo-list"
                          dataSource={todoCards}
                          rowKey={(item) => item.key}
                          locale={{ emptyText: "暂无待办" }}
                          renderItem={(item) => {
                            const isEditing =
                              todoEditTarget?.conversationId === item.conversationId &&
                              todoEditTarget.index === item.index;
                            const draft = isEditing ? todoEditDraft : null;
                            const priority = normalizeTodoPriority(
                              draft?.priority ?? item.todo.priority
                            );
                            const dueDate = normalizeTodoDueDate(
                              draft?.dueDate ?? item.todo.dueDate
                            );
                            const actionPrefix = `${item.conversationId}:${item.index}`;
                            const isActionLoading = todoActionKey?.startsWith(actionPrefix);
                            return (
                              <List.Item className="chat-todo-item">
                                <div className="todo-card">
                                  <div className="todo-card-header">
                                    {isEditing ? (
                                      <Input
                                        value={draft?.title ?? ""}
                                        placeholder="请输入事项"
                                        onChange={(event) =>
                                          setTodoEditDraft((prev) =>
                                            prev
                                              ? { ...prev, title: event.target.value }
                                              : {
                                                  title: event.target.value,
                                                  priority: "medium",
                                                  dueDate: "",
                                                  notes: ""
                                                }
                                          )
                                        }
                                        className="todo-card-title-input"
                                      />
                                    ) : (
                                      <Text strong className="todo-card-title">
                                        {item.todo.title}
                                      </Text>
                                    )}
                                    <Tag color={PRIORITY_COLORS[priority]}>
                                      {PRIORITY_LABELS[priority]}
                                    </Tag>
                                  </div>
                                  <Text type="secondary" className="todo-card-source">
                                    来自：对话 {item.conversationDate}
                                    {item.conversationPreview
                                      ? ` · ${item.conversationPreview}`
                                      : ""}
                                  </Text>
                                  {isEditing ? (
                                    <div className="todo-card-editor">
                                      <div className="todo-card-field">
                                        <Text type="secondary">优先级</Text>
                                        <Select
                                          value={draft?.priority ?? "medium"}
                                          options={TASK_PRIORITY_OPTIONS}
                                          onChange={(value) =>
                                            setTodoEditDraft((prev) =>
                                              prev
                                                ? {
                                                    ...prev,
                                                    priority: value as TaskPriority
                                                  }
                                                : {
                                                    title: item.todo.title ?? "",
                                                    priority: value as TaskPriority,
                                                    dueDate: normalizeTodoDueDate(
                                                      item.todo.dueDate
                                                    ),
                                                    notes: item.todo.notes ?? ""
                                                  }
                                            )
                                          }
                                          className="todo-card-select"
                                        />
                                      </div>
                                      <div className="todo-card-field">
                                        <Text type="secondary">截止时间</Text>
                                        <DatePicker
                                          value={
                                            draft?.dueDate
                                              ? dayjs(draft.dueDate, "YYYY-MM-DD")
                                              : null
                                          }
                                          placeholder="年/月/日"
                                          onChange={(value) =>
                                            setTodoEditDraft((prev) => {
                                              const nextValue = value
                                                ? value.format("YYYY-MM-DD")
                                                : "";
                                              if (prev) {
                                                return { ...prev, dueDate: nextValue };
                                              }
                                              return {
                                                title: item.todo.title ?? "",
                                                priority: normalizeTodoPriority(
                                                  item.todo.priority
                                                ),
                                                dueDate: nextValue,
                                                notes: item.todo.notes ?? ""
                                              };
                                            })
                                          }
                                          className="todo-card-date"
                                        />
                                        {!draft?.dueDate ? (
                                          <Text type="secondary">未知</Text>
                                        ) : null}
                                      </div>
                                      <div className="todo-card-notes">
                                        <div className="todo-card-notes-label">
                                          <Text type="secondary">备注</Text>
                                          <Text
                                            type="secondary"
                                            className="todo-card-notes-hint"
                                          >
                                            可选
                                          </Text>
                                        </div>
                                        <Input.TextArea
                                          value={draft?.notes ?? ""}
                                          placeholder="备注（可选）"
                                          autoSize={{ minRows: 2, maxRows: 4 }}
                                          onChange={(event) =>
                                            setTodoEditDraft((prev) =>
                                              prev
                                                ? { ...prev, notes: event.target.value }
                                                : {
                                                    title: item.todo.title ?? "",
                                                    priority: normalizeTodoPriority(
                                                      item.todo.priority
                                                    ),
                                                    dueDate: normalizeTodoDueDate(
                                                      item.todo.dueDate
                                                    ),
                                                    notes: event.target.value
                                                  }
                                            )
                                          }
                                          className="todo-card-notes-input"
                                        />
                                      </div>
                                    </div>
                                  ) : (
                                    <>
                                      <div className="todo-card-meta">
                                        <Text type="secondary">截止</Text>
                                        <Text>{dueDate || "未知"}</Text>
                                      </div>
                                      {item.todo.notes ? (
                                        <div className="todo-card-notes">
                                          <div className="todo-card-notes-label">
                                            <Text type="secondary">备注</Text>
                                          </div>
                                          <Text className="todo-card-notes-text">
                                            {item.todo.notes}
                                          </Text>
                                        </div>
                                      ) : null}
                                    </>
                                  )}
                                  <div className="todo-card-actions">
                                    {isEditing ? (
                                      <>
                                        <Button
                                          size="small"
                                          type="primary"
                                          onClick={handleSaveTodoEdit}
                                          loading={isActionLoading}
                                          disabled={!draft?.title.trim()}
                                        >
                                          保存
                                        </Button>
                                        <Button size="small" onClick={handleCancelTodoEdit}>
                                          取消
                                        </Button>
                                      </>
                                    ) : (
                                      <Button
                                        size="small"
                                        onClick={() => handleStartTodoEdit(item)}
                                      >
                                        修改
                                      </Button>
                                    )}
                                    <Button
                                      size="small"
                                      onClick={() => void handleAddTodo(item)}
                                      loading={isTaskSaving || isActionLoading}
                                      disabled={Boolean(isEditing && !draft?.title.trim())}
                                    >
                                      添加
                                    </Button>
                                    <Button
                                      size="small"
                                      danger
                                      onClick={() => void handleDeleteTodo(item)}
                                      loading={isActionLoading}
                                    >
                                      删除
                                    </Button>
                                  </div>
                                </div>
                              </List.Item>
                            );
                          }}
                        />
                      </Sider>
                    </Layout>
                  )
                },
                {
                  key: "tasks",
                  label: "任务",
                  children: (
                    <div className="task-layout">
                      {taskError ? (
                        <Alert
                          type="error"
                          message={taskError}
                          showIcon
                          closable
                          onClose={clearTaskError}
                          className="app-alert"
                        />
                      ) : null}
                      <div className="task-header">
                        <Text strong>任务列表</Text>
                        <Button
                          size="small"
                          onClick={() => loadTasks()}
                          loading={isTaskLoading}
                        >
                          刷新
                        </Button>
                      </div>
                      <div className="task-create">
                        <div className="task-create-label">
                          <Text strong>新增任务</Text>
                          <Text type="secondary">快速添加</Text>
                        </div>
                        <Input
                          placeholder="任务标题"
                          value={newTaskTitle}
                          onChange={(event) => setNewTaskTitle(event.target.value)}
                          onPressEnter={() => void handleCreateTask()}
                          className="task-create-title"
                        />
                        <Select
                          value={newTaskPriority}
                          options={TASK_PRIORITY_OPTIONS}
                          onChange={(value) => setNewTaskPriority(value as TaskPriority)}
                          className="task-create-priority"
                        />
                        <Input
                          type="date"
                          value={newTaskDeadline}
                          onChange={(event) => setNewTaskDeadline(event.target.value)}
                          className="task-create-deadline"
                        />
                        <Button
                          type="primary"
                          onClick={() => void handleCreateTask()}
                          disabled={!newTaskTitle.trim()}
                          loading={isTaskSaving}
                        >
                          新增
                        </Button>
                      </div>
                      <div className="task-sections">
                        <div className="task-section">
                          <div className="task-section-header">
                            <Text strong>待办</Text>
                            <Text type="secondary">{pendingTasks.length} 项</Text>
                          </div>
                          <List
                            className="task-list"
                            dataSource={pendingTasks}
                            loading={isTaskLoading}
                            locale={{ emptyText: "暂无待办" }}
                            rowKey={(task) => task.id}
                            renderItem={(task) => (
                              <TaskRow
                                task={task}
                                isSaving={isTaskSaving}
                                onUpdate={updateTask}
                                onComplete={completeTask}
                                onDelete={handleDeleteTask}
                              />
                            )}
                          />
                        </div>
                        <div className="task-section">
                          <div className="task-section-header">
                            <Text strong>已完成</Text>
                            <Text type="secondary">{completedTasks.length} 项</Text>
                          </div>
                          <List
                            className="task-list"
                            dataSource={completedTasks}
                            loading={isTaskLoading}
                            locale={{ emptyText: "暂无已完成" }}
                            rowKey={(task) => task.id}
                            renderItem={(task) => (
                              <TaskRow
                                task={task}
                                isSaving={isTaskSaving}
                                onUpdate={updateTask}
                                onComplete={completeTask}
                                onDelete={handleDeleteTask}
                              />
                            )}
                          />
                        </div>
                      </div>
                    </div>
                  )
                },
                {
                  key: "weekly",
                  label: "周报",
                  children: (
                    <Layout className="report-layout">
                      <Sider width={300} className="report-sider">
                        <div className="report-sider-header">
                          <Text strong>周报历史</Text>
                          <Button
                            size="small"
                            onClick={() => loadReports()}
                            loading={isReportLoading}
                          >
                            刷新
                          </Button>
                        </div>
                        <List
                          className="report-list-panel"
                          dataSource={reports}
                          loading={isReportLoading}
                          locale={{ emptyText: "暂无周报" }}
                          rowKey={(report) => report.id}
                          renderItem={(report: WeeklyReport) => (
                            <List.Item
                              className={
                                report.id === activeReport?.id
                                  ? "report-item active"
                                  : "report-item"
                              }
                              onClick={() => selectReport(report.id)}
                            >
                              <List.Item.Meta
                                title={
                                  report.reportContent?.title ?? `${report.weekStart} 周报`
                                }
                                description={`${report.weekStart} ~ ${report.weekEnd}`}
                              />
                            </List.Item>
                          )}
                        />
                      </Sider>
                      <Content className="report-panel">
                        {reportError ? (
                          <Alert
                            type="error"
                            message={reportError}
                            showIcon
                            closable
                            onClose={clearReportError}
                            className="app-alert"
                          />
                        ) : null}
                        <div className="report-controls">
                          <Text strong>选择周区间</Text>
                          <Space wrap>
                            <Input
                              type="date"
                              value={weekStart}
                              onChange={handleWeekStartChange}
                            />
                            <Text type="secondary">至</Text>
                            <Input
                              type="date"
                              value={weekEnd}
                              onChange={handleWeekEndChange}
                            />
                            <Button onClick={() => loadStats()} loading={isReportLoading}>
                              统计
                            </Button>
                            <Button
                              type="primary"
                              onClick={handleGenerateWeeklyReport}
                              loading={isReportGenerating}
                              disabled={!weekStart || !weekEnd}
                            >
                              生成周报
                            </Button>
                          </Space>
                        </div>
                        <div className="report-stats">
                          <div className="report-stat">
                            <Text type="secondary">日记数</Text>
                            <Text className="report-stat-value">
                              {reportStats?.diaryCount ?? 0}
                            </Text>
                          </div>
                          <div className="report-stat">
                            <Text type="secondary">总字数</Text>
                            <Text className="report-stat-value">
                              {reportStats?.totalWords ?? 0}
                            </Text>
                          </div>
                          <div className="report-stat">
                            <Text type="secondary">完成任务</Text>
                            <Text className="report-stat-value">
                              {reportStats?.taskStats.completed ?? 0}/
                              {reportStats?.taskStats.total ?? 0}
                            </Text>
                          </div>
                        </div>
                        <div className="report-detail">
                          {activeReport ? (
                            activeReport.reportContent ? (
                              <div className="report-content">
                                <div className="report-content-header">
                                  <div>
                                    {isEditingReport ? (
                                      <Input
                                        value={reportDraftValue.title}
                                        onChange={(event) =>
                                          setReportDraft({
                                            ...reportDraftValue,
                                            title: event.target.value
                                          })
                                        }
                                        placeholder="周报标题"
                                      />
                                    ) : (
                                      <Title level={4} className="report-title">
                                        {activeReport.reportContent.title}
                                      </Title>
                                    )}
                                    <Text type="secondary">
                                      {activeReport.weekStart} ~ {activeReport.weekEnd}
                                    </Text>
                                  </div>
                                  <Space>
                                    {isEditingReport ? (
                                      <>
                                        <Button
                                          type="primary"
                                          onClick={handleSaveReport}
                                          loading={isReportSaving}
                                        >
                                          保存
                                        </Button>
                                        <Button onClick={handleCancelEditReport}>取消</Button>
                                      </>
                                    ) : (
                                      <>
                                        <Button onClick={handleStartEditReport}>编辑</Button>
                                        <Button onClick={handleCopyWeeklyReport}>复制</Button>
                                        <Button danger onClick={handleDeleteReport}>
                                          删除
                                        </Button>
                                      </>
                                    )}
                                  </Space>
                                </div>
                                <div className="report-section">
                                  <Text strong>总结</Text>
                                  {isEditingReport ? (
                                    <Input.TextArea
                                      value={reportDraftValue.summary}
                                      onChange={(event) =>
                                        setReportDraft({
                                          ...reportDraftValue,
                                          summary: event.target.value
                                        })
                                      }
                                      autoSize={{ minRows: 3, maxRows: 6 }}
                                    />
                                  ) : (
                                    <Text className="report-text">
                                      {activeReport.reportContent.summary}
                                    </Text>
                                  )}
                                </div>
                                <div className="report-section">
                                  <Text strong>亮点</Text>
                                  {isEditingReport ? (
                                    <Input.TextArea
                                      value={reportDraftValue.highlights}
                                      onChange={(event) =>
                                        setReportDraft({
                                          ...reportDraftValue,
                                          highlights: event.target.value
                                        })
                                      }
                                      autoSize={{ minRows: 3, maxRows: 6 }}
                                      placeholder="每行一条"
                                    />
                                  ) : (
                                    <ReportList items={activeReport.reportContent.highlights} />
                                  )}
                                </div>
                                <div className="report-section">
                                  <Text strong>改进</Text>
                                  {isEditingReport ? (
                                    <Input.TextArea
                                      value={reportDraftValue.improvements}
                                      onChange={(event) =>
                                        setReportDraft({
                                          ...reportDraftValue,
                                          improvements: event.target.value
                                        })
                                      }
                                      autoSize={{ minRows: 3, maxRows: 6 }}
                                      placeholder="每行一条"
                                    />
                                  ) : (
                                    <ReportList items={activeReport.reportContent.improvements} />
                                  )}
                                </div>
                                <div className="report-section">
                                  <Text strong>下周计划</Text>
                                  {isEditingReport ? (
                                    <Input.TextArea
                                      value={reportDraftValue.nextWeekPlan}
                                      onChange={(event) =>
                                        setReportDraft({
                                          ...reportDraftValue,
                                          nextWeekPlan: event.target.value
                                        })
                                      }
                                      autoSize={{ minRows: 3, maxRows: 6 }}
                                      placeholder="每行一条"
                                    />
                                  ) : (
                                    <ReportList items={activeReport.reportContent.nextWeekPlan} />
                                  )}
                                </div>
                              </div>
                            ) : (
                              <Empty description="周报内容为空" />
                            )
                          ) : (
                            <Empty description="请选择一份周报" />
                          )}
                        </div>
                      </Content>
                    </Layout>
                  )
                }
              ]
              : [])
          ]}
        />
      </Content>
      <Modal
        title="欢迎使用 Smart Diary"
        open={isOnboardingOpen}
        onCancel={handleCloseOnboarding}
        width={700}
        footer={null}
        className="onboarding-modal"
      >
        <div className="onboarding-content">
          {/* 步骤指示器 */}
          <div className="onboarding-steps-indicator">
            {ONBOARDING_STEPS.map((_, index) => (
              <span
                key={index}
                className={`onboarding-step-dot${index === onboardingStep ? " active" : ""}${index < onboardingStep ? " completed" : ""}`}
              />
            ))}
          </div>

          {/* 当前步骤内容 */}
          <div className="onboarding-step">
            <Title level={4} className="onboarding-step-title">
              {ONBOARDING_STEPS[onboardingStep].title}
            </Title>
            <div className="onboarding-image-container">
              <img
                src={ONBOARDING_STEPS[onboardingStep].image}
                alt={ONBOARDING_STEPS[onboardingStep].title}
                className="onboarding-image"
              />
            </div>
            <div className="onboarding-descriptions">
              {ONBOARDING_STEPS[onboardingStep].descriptions.map((desc, index) => (
                <Text key={index} className="onboarding-description">
                  {desc}
                </Text>
              ))}
            </div>
          </div>

          {/* 导航按钮 */}
          <div className="onboarding-footer">
            <Button
              onClick={handleOnboardingPrev}
              disabled={onboardingStep === 0}
            >
              上一步
            </Button>
            <Text type="secondary" className="onboarding-step-count">
              {onboardingStep + 1} / {ONBOARDING_STEPS.length}
            </Text>
            <Button type="primary" onClick={handleOnboardingNext}>
              {onboardingStep === ONBOARDING_STEPS.length - 1 ? "开始使用" : "下一步"}
            </Button>
          </div>
        </div>
      </Modal>
    </Layout>
  );
}
