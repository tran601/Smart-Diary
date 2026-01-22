import type {
  WeeklyReport,
  WeeklyReportStats,
  WeeklyReportUpdateInput
} from "../types/database";

export const weeklyReportService = {
  stats: (weekStart: string, weekEnd: string): Promise<WeeklyReportStats> =>
    window.api.weeklyReport.stats(weekStart, weekEnd),
  generate: (weekStart: string, weekEnd: string): Promise<WeeklyReport> =>
    window.api.weeklyReport.generate(weekStart, weekEnd),
  list: (): Promise<WeeklyReport[]> => window.api.weeklyReport.list(),
  get: (id: string): Promise<WeeklyReport | null> =>
    window.api.weeklyReport.get(id),
  update: (id: string, input: WeeklyReportUpdateInput): Promise<WeeklyReport | null> =>
    window.api.weeklyReport.update(id, input),
  delete: (id: string): Promise<boolean> => window.api.weeklyReport.delete(id)
};
