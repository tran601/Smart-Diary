import { create } from "zustand";
import type { Diary, DiaryMode } from "../types/database";
import { diaryService } from "../services/diary.service";

interface DiaryState {
  diaries: Diary[];
  activeDiary: Diary | null;
  title: string;
  editorContent: string;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  loadDiaries: () => Promise<void>;
  selectDiary: (id: string) => Promise<void>;
  createDiary: (
    mode: DiaryMode,
    date?: string,
    input?: { title?: string; content?: string }
  ) => Promise<Diary | null>;
  clearActiveDiary: () => void;
  saveDiary: () => Promise<boolean>;
  deleteDiary: (id: string) => Promise<void>;
  setTitle: (title: string) => void;
  setEditorContent: (content: string) => void;
  clearError: () => void;
}

const EMPTY_CONTENT = "<p><br></p>";

function toErrorMessage(err: unknown) {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

export const useDiaryStore = create<DiaryState>((set, get) => ({
  diaries: [],
  activeDiary: null,
  title: "",
  editorContent: "",
  isLoading: false,
  isSaving: false,
  error: null,
  loadDiaries: async () => {
    set({ isLoading: true });
    try {
      const diaries = await diaryService.list();
      const active = get().activeDiary;
      if (active) {
        const updatedActive = diaries.find((item) => item.id === active.id);
        if (updatedActive) {
          set({
            diaries,
            activeDiary: updatedActive,
            title: updatedActive.title ?? "",
            editorContent: updatedActive.content ?? ""
          });
          return;
        }
      }
      set({ diaries });
    } catch (err) {
      set({ error: toErrorMessage(err) });
    } finally {
      set({ isLoading: false });
    }
  },
  selectDiary: async (id) => {
    set({ isLoading: true });
    try {
      const diary = await diaryService.get(id);
      if (!diary) {
        set({ error: "Diary not found or already deleted." });
        return;
      }
      set({
        activeDiary: diary,
        title: diary.title ?? "",
        editorContent: diary.content ?? ""
      });
    } catch (err) {
      set({ error: toErrorMessage(err) });
    } finally {
      set({ isLoading: false });
    }
  },
  createDiary: async (mode, date, input) => {
    set({ isSaving: true });
    try {
      const title = input?.title ?? "";
      const content = input?.content ?? EMPTY_CONTENT;
      const created = await diaryService.create({
        title,
        content,
        mode,
        date
      });
      const diaries = await diaryService.list();
      set({
        diaries,
        activeDiary: created,
        title: created.title ?? "",
        editorContent: created.content ?? ""
      });
      return created;
    } catch (err) {
      set({ error: toErrorMessage(err) });
      return null;
    } finally {
      set({ isSaving: false });
    }
  },
  clearActiveDiary: () => set({ activeDiary: null, title: "", editorContent: "" }),
  saveDiary: async () => {
    const { activeDiary, title, editorContent } = get();
    if (!activeDiary) {
      set({ error: "Select or create a diary first." });
      return false;
    }
    set({ isSaving: true });
    try {
      const updated = await diaryService.update(activeDiary.id, {
        title: title.trim() || "Untitled",
        content: editorContent || EMPTY_CONTENT,
        isEdited: true
      });
      if (!updated) {
        set({ error: "Save failed. The diary was deleted." });
        return false;
      }
      const diaries = await diaryService.list();
      set({
        diaries,
        activeDiary: updated,
        title: updated.title ?? "",
        editorContent: updated.content ?? ""
      });
      return true;
    } catch (err) {
      set({ error: toErrorMessage(err) });
      return false;
    } finally {
      set({ isSaving: false });
    }
  },
  deleteDiary: async (id) => {
    set({ isSaving: true });
    try {
      await diaryService.delete(id);
      const diaries = await diaryService.list();
      const active = get().activeDiary;
      if (active?.id === id) {
        set({ activeDiary: null, title: "", editorContent: "" });
      }
      set({ diaries });
    } catch (err) {
      set({ error: toErrorMessage(err) });
    } finally {
      set({ isSaving: false });
    }
  },
  setTitle: (title) => set({ title }),
  setEditorContent: (content) => set({ editorContent: content }),
  clearError: () => set({ error: null })
}));
