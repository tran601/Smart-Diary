import type {
  Diary,
  DiaryCreateInput,
  DiaryUpdateInput
} from "../types/database";

export const diaryService = {
  create: (input: DiaryCreateInput) => window.api.diary.create(input),
  update: (id: string, input: DiaryUpdateInput) =>
    window.api.diary.update(id, input),
  get: (id: string) => window.api.diary.get(id),
  list: () => window.api.diary.list(),
  delete: (id: string) => window.api.diary.delete(id)
};

export type { Diary };
