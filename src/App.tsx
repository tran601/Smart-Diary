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
  ExtractedInfo,
  Mood
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
      "点击「提取信息」按钮，AI 会根据聊天记录生成待办事项",
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

const MOOD_LABELS: Record<Mood, string> = {
  happy: "开心",
  sad: "难过",
  anxious: "焦虑",
  angry: "生气",
  calm: "平静",
  tired: "疲惫",
  excited: "兴奋"
};

const THEME_OPTIONS: { label: string; value: AppSettingsPublic["theme"] }[] = [
  { label: "浅色", value: "light" },
  { label: "深色", value: "dark" }
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

const EMPTY_EDITOR_CONTENT = "<p><br></p>";

function formatDiaryDate(date: string) {
  return dayjs(date).format("YYYY/MM/DD ddd");
}

type TodoSuggestion = ExtractedInfo["todos"][number];

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

  useEffect(() => {
    setDeadline(task.deadline ?? "");
    setPriority(task.priority);
  }, [task.deadline, task.priority]);

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
      actions={actions}
    >
      <div className="task-main">
        <div className="task-head">
          <div className="task-title-block">
            <Text strong className="task-title">
              {task.title}
            </Text>
            {task.description ? (
              <Text type="secondary" className="task-desc">
                {task.description}
              </Text>
            ) : null}
          </div>
          <div className="task-tags">
            <Tag color={PRIORITY_COLORS[priority]}>{PRIORITY_LABELS[priority]}</Tag>
            <Tag color={statusColor}>{STATUS_LABELS[task.status]}</Tag>
          </div>
        </div>
        <div className="task-meta-row">
          <Text type="secondary" className="task-meta-label">
            截止
          </Text>
          <Text className="task-meta-value">{deadlineLabel}</Text>
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
    isExtracting,
    error: conversationError,
    loadConversations,
    createConversation,
    selectConversation,
    deleteConversation,
    sendMessage,
    generateDiaryDraft,
    extractInfo,
    detectTodos,
    dismissTodoSuggestion,
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
  const [todoQueue, setTodoQueue] = useState<TodoSuggestion[]>([]);
  const [todoDraft, setTodoDraft] = useState<{
    title: string;
    priority: TaskPriority;
    dueDate: string;
  } | null>(null);
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
  const dismissedTodoKeys = useMemo(
    () => new Set(activeConversation?.extractedInfo?.dismissedTodos ?? []),
    [activeConversation?.extractedInfo?.dismissedTodos]
  );
  const existingTaskKeys = useMemo(() => {
    const keys = new Set<string>();
    tasks.forEach((task) => {
      keys.add(buildTodoKeyFromTask(task));
    });
    return keys;
  }, [tasks]);
  const pendingTodo = todoQueue[0] ?? null;
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

  useEffect(() => {
    setTodoQueue([]);
  }, [activeConversation?.id]);

  // 当消息更新或切换到对话标签时自动滚动到底部
  useEffect(() => {
    if (chatMessagesRef.current && activeConversation?.messages.length) {
      chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
    }
  }, [activeConversation?.messages, activeTab]);

  useEffect(() => {
    if (!pendingTodo) {
      setTodoDraft(null);
      return;
    }
    setTodoDraft({
      title: pendingTodo.title ?? "",
      priority: normalizeTodoPriority(pendingTodo.priority),
      dueDate: normalizeTodoDueDate(pendingTodo.dueDate)
    });
  }, [pendingTodo]);

  const enqueueTodoSuggestions = useCallback((todos: TodoSuggestion[]) => {
    if (!todos.length) {
      return;
    }
    setTodoQueue((prev) => {
      const seen = new Set(prev.map(buildTodoKeyFromTodo));
      const next = [...prev];
      todos.forEach((todo) => {
        const title = todo.title?.trim() ?? "";
        if (!title) {
          return;
        }
        const key = buildTodoKeyFromTodo(todo);
        if (!seen.has(key)) {
          seen.add(key);
          next.push(todo);
        }
      });
      return next;
    });
  }, []);

  const filterTodoSuggestions = useCallback(
    (todos: TodoSuggestion[]) =>
      todos.filter((todo) => {
        const title = todo.title?.trim() ?? "";
        if (!title) {
          return false;
        }
        const key = buildTodoKeyFromTodo(todo);
        if (dismissedTodoKeys.has(key) || existingTaskKeys.has(key)) {
          return false;
        }
        return true;
      }),
    [dismissedTodoKeys, existingTaskKeys]
  );

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
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSavingMode(false);
    }
  };

  const handleSaveAppearance = async () => {
    setIsSavingAppearance(true);
    try {
      const nextSettings = await settingsService.set({ theme: themeInput });
      applySettings(nextSettings);
      message.success("已保存外观设置");
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
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
    await sendMessage();
    const detected = await detectTodos();
    if (!detected?.todos?.length) {
      return;
    }
    const suggestions = filterTodoSuggestions(detected.todos);
    enqueueTodoSuggestions(suggestions);
  }, [
    messageInput,
    sendMessage,
    detectTodos,
    filterTodoSuggestions,
    enqueueTodoSuggestions
  ]);

  const handleConfirmTodo = useCallback(async () => {
    if (!pendingTodo || !todoDraft) {
      return;
    }
    const title = todoDraft.title.trim();
    if (!title) {
      message.error("事项不能为空");
      return;
    }
    const deadline = normalizeTodoDueDate(todoDraft.dueDate);
    const priority = todoDraft.priority;
    const created = await createTask({
      title,
      description: pendingTodo.notes,
      priority,
      deadline: deadline || undefined,
      conversationId: activeConversation?.id
    });
    if (created) {
      message.success("已加入待办");
      setTodoQueue((prev) => prev.slice(1));
    } else {
      message.error("保存待办失败");
    }
  }, [activeConversation?.id, createTask, pendingTodo, todoDraft]);

  const handleDismissTodo = useCallback(async () => {
    if (!pendingTodo) {
      return;
    }
    const key = buildTodoKeyFromTodo(pendingTodo);
    if (key.trim()) {
      await dismissTodoSuggestion(key);
    }
    setTodoQueue((prev) => prev.slice(1));
  }, [dismissTodoSuggestion, pendingTodo]);

  const handleExtractInfo = useCallback(async () => {
    const result = await extractInfo();
    if (result) {
      await loadTasks();
      message.success(`已提取 ${result.tasks.length} 个任务`);
    }
  }, [extractInfo, loadTasks]);

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
    const diary = await generateDiaryDraft();
    if (diary) {
      await loadDiaries();
      await selectDiary(diary.id);
      setActiveTab("diary");
      message.success("已生成日记草稿");
    }
  }, [generateDiaryDraft, loadDiaries, selectDiary]);

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
        {appMode === "ai" ? (
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
                              const moodLabel = diary.mood
                                ? MOOD_LABELS[diary.mood]
                                : "未记录";
                              const stressLabel =
                                typeof diary.stressLevel === "number"
                                  ? `${diary.stressLevel}`
                                  : "未记录";
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
                                    <div className="diary-item-meta">
                                      <span
                                        className={`diary-pill mood-${diary.mood ?? "unknown"}`}
                                      >
                                        <span className="diary-pill-label">心情</span>
                                        <span className="diary-pill-value">
                                          {moodLabel}
                                        </span>
                                      </span>
                                      <span className="diary-pill diary-pill-neutral">
                                        <span className="diary-pill-label">压力</span>
                                        <span className="diary-pill-value">
                                          {stressLabel}
                                        </span>
                                      </span>
                                    </div>
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
                          记录每一天的心情与故事
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
                    <Text strong>外观</Text>
                    <Space wrap>
                      <Select
                        value={themeInput}
                        options={THEME_OPTIONS}
                        onChange={(value) =>
                          setThemeInput(value as AppSettingsPublic["theme"])
                        }
                      />
                      <Button onClick={handleSaveAppearance} loading={isSavingAppearance}>
                        保存设置
                      </Button>
                    </Space>
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
                          </div>
                          <Space>
                            <Button
                              onClick={handleExtractInfo}
                              loading={isExtracting}
                              disabled={!activeConversation}
                            >
                              提取信息
                            </Button>
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
                        {pendingTodo ? (
                          <Modal
                            title="发现待办事项"
                            open={Boolean(pendingTodo)}
                            onOk={handleConfirmTodo}
                            onCancel={handleDismissTodo}
                            okText="确认"
                            cancelText="取消"
                            okButtonProps={{
                              loading: isTaskSaving,
                              disabled: !todoDraft?.title.trim()
                            }}
                          >
                            <div className="todo-modal-form">
                              <div className="todo-modal-row">
                                <Text strong className="todo-modal-label">
                                  事项
                                </Text>
                                <Input
                                  className="todo-modal-control"
                                  value={todoDraft?.title ?? ""}
                                  placeholder="请输入事项"
                                  onChange={(event) =>
                                    setTodoDraft((prev) =>
                                      prev
                                        ? { ...prev, title: event.target.value }
                                        : {
                                          title: event.target.value,
                                          priority: "medium",
                                          dueDate: ""
                                        }
                                    )
                                  }
                                />
                              </div>
                              <div className="todo-modal-row">
                                <Text strong className="todo-modal-label">
                                  优先级
                                </Text>
                                <Select
                                  className="todo-modal-control"
                                  value={todoDraft?.priority ?? "medium"}
                                  options={TASK_PRIORITY_OPTIONS}
                                  onChange={(value) =>
                                    setTodoDraft((prev) =>
                                      prev
                                        ? { ...prev, priority: value as TaskPriority }
                                        : {
                                          title: pendingTodo.title ?? "",
                                          priority: value as TaskPriority,
                                          dueDate: normalizeTodoDueDate(pendingTodo.dueDate)
                                        }
                                    )
                                  }
                                />
                              </div>
                              <div className="todo-modal-row">
                                <Text strong className="todo-modal-label">
                                  截止时间
                                </Text>
                                <div className="todo-modal-control todo-modal-inline">
                                  <DatePicker
                                    className="todo-modal-date"
                                    value={
                                      todoDraft?.dueDate
                                        ? dayjs(todoDraft.dueDate, "YYYY-MM-DD")
                                        : null
                                    }
                                    placeholder="年/月/日"
                                    onChange={(value) =>
                                      setTodoDraft((prev) => {
                                        const nextValue = value
                                          ? value.format("YYYY-MM-DD")
                                          : "";
                                        if (prev) {
                                          return { ...prev, dueDate: nextValue };
                                        }
                                        return {
                                          title: pendingTodo.title ?? "",
                                          priority: normalizeTodoPriority(
                                            pendingTodo.priority
                                          ),
                                          dueDate: nextValue
                                        };
                                      })
                                    }
                                  />
                                  {!todoDraft?.dueDate ? (
                                    <Text type="secondary">未知</Text>
                                  ) : null}
                                </div>
                              </div>
                              {pendingTodo.notes ? (
                                <div className="todo-modal-row todo-modal-notes">
                                  <Text strong className="todo-modal-label">
                                    备注
                                  </Text>
                                  <Text>{pendingTodo.notes}</Text>
                                </div>
                              ) : null}
                            </div>
                          </Modal>
                        ) : null}
                      </Content>
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
