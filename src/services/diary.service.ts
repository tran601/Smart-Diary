import type {
  DiaryAttachment,
  Diary,
  DiaryCreateInput,
  DiaryImageUploadInput,
  DiaryImageUploadResult,
  DiaryUpdateInput
} from "../types/database";

export const diaryService = {
  create: (input: DiaryCreateInput) => window.api.diary.create(input),
  update: (id: string, input: DiaryUpdateInput) =>
    window.api.diary.update(id, input),
  get: (id: string) => window.api.diary.get(id),
  list: () => window.api.diary.list(),
  delete: (id: string) => window.api.diary.delete(id),
  uploadImage: (input: DiaryImageUploadInput) => window.api.diary.uploadImage(input),
  listAttachments: (diaryId: string) => window.api.diary.listAttachments(diaryId),
  deleteAttachment: (attachmentId: string) => window.api.diary.deleteAttachment(attachmentId)
};

export type { Diary, DiaryAttachment, DiaryImageUploadInput, DiaryImageUploadResult };
