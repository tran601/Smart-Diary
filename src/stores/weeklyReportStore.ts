import { create } from "zustand";
import type {
  WeeklyReport,
  WeeklyReportStats,
  WeeklyReportUpdateInput
} from "../types/database";
import { weeklyReportService } from "../services/weeklyReport.service";

interface WeeklyReportState {
  reports: WeeklyReport[];
  activeReport: WeeklyReport | null;
  weekStart: string;
  weekEnd: string;
  stats: WeeklyReportStats | null;
  isLoading: boolean;
  isGenerating: boolean;
  isSaving: boolean;
  error: string | null;
  setWeekRange: (weekStart: string, weekEnd: string) => void;
  loadStats: () => Promise<void>;
  loadReports: () => Promise<void>;
  selectReport: (id: string) => Promise<void>;
  generateReport: () => Promise<WeeklyReport | null>;
  updateReport: (id: string, input: WeeklyReportUpdateInput) => Promise<WeeklyReport | null>;
  deleteReport: (id: string) => Promise<void>;
  clearError: () => void;
}

function toErrorMessage(err: unknown) {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getCurrentWeekRange() {
  const now = new Date();
  const day = now.getDay() || 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - day + 1);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(0, 0, 0, 0);
  return {
    weekStart: formatLocalDate(monday),
    weekEnd: formatLocalDate(sunday)
  };
}

const DEFAULT_RANGE = getCurrentWeekRange();

export const useWeeklyReportStore = create<WeeklyReportState>((set, get) => ({
  reports: [],
  activeReport: null,
  weekStart: DEFAULT_RANGE.weekStart,
  weekEnd: DEFAULT_RANGE.weekEnd,
  stats: null,
  isLoading: false,
  isGenerating: false,
  isSaving: false,
  error: null,
  setWeekRange: (weekStart, weekEnd) => set({ weekStart, weekEnd }),
  loadStats: async () => {
    const { weekStart, weekEnd } = get();
    if (!weekStart || !weekEnd) {
      return;
    }
    set({ isLoading: true });
    try {
      const stats = await weeklyReportService.stats(weekStart, weekEnd);
      set({ stats });
    } catch (err) {
      set({ error: toErrorMessage(err) });
    } finally {
      set({ isLoading: false });
    }
  },
  loadReports: async () => {
    set({ isLoading: true });
    try {
      const reports = await weeklyReportService.list();
      const active = get().activeReport;
      if (active) {
        const updatedActive = reports.find((item) => item.id === active.id);
        set({
          reports,
          activeReport: updatedActive ?? active
        });
      } else {
        set({
          reports,
          activeReport: reports[0] ?? null
        });
      }
    } catch (err) {
      set({ error: toErrorMessage(err) });
    } finally {
      set({ isLoading: false });
    }
  },
  selectReport: async (id) => {
    set({ isLoading: true });
    try {
      const report = await weeklyReportService.get(id);
      if (!report) {
        set({ error: "Report not found." });
        return;
      }
      set({ activeReport: report });
    } catch (err) {
      set({ error: toErrorMessage(err) });
    } finally {
      set({ isLoading: false });
    }
  },
  generateReport: async () => {
    const { weekStart, weekEnd } = get();
    if (!weekStart || !weekEnd) {
      set({ error: "Select a week range first." });
      return null;
    }
    set({ isGenerating: true });
    try {
      const report = await weeklyReportService.generate(weekStart, weekEnd);
      const reports = [report, ...get().reports.filter((item) => item.id !== report.id)];
      set({ reports, activeReport: report });
      return report;
    } catch (err) {
      set({ error: toErrorMessage(err) });
      return null;
    } finally {
      set({ isGenerating: false });
    }
  },
  updateReport: async (id, input) => {
    set({ isSaving: true });
    try {
      const updated = await weeklyReportService.update(id, input);
      if (!updated) {
        set({ error: "Report not found." });
        return null;
      }
      const reports = get().reports.map((item) =>
        item.id === id ? updated : item
      );
      set({ reports, activeReport: updated });
      return updated;
    } catch (err) {
      set({ error: toErrorMessage(err) });
      return null;
    } finally {
      set({ isSaving: false });
    }
  },
  deleteReport: async (id) => {
    set({ isSaving: true });
    try {
      const removed = await weeklyReportService.delete(id);
      if (!removed) {
        set({ error: "Report not found." });
        return;
      }
      const reports = get().reports.filter((item) => item.id !== id);
      const active = get().activeReport;
      const nextActive = active?.id === id ? (reports[0] ?? null) : active;
      set({ reports, activeReport: nextActive });
    } catch (err) {
      set({ error: toErrorMessage(err) });
    } finally {
      set({ isSaving: false });
    }
  },
  clearError: () => set({ error: null })
}));
