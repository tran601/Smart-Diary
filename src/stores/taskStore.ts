import { create } from "zustand";
import type { Task, TaskCreateInput, TaskUpdateInput } from "../types/database";
import { taskService } from "../services/task.service";

interface TaskState {
  tasks: Task[];
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  loadTasks: () => Promise<void>;
  createTask: (input: TaskCreateInput) => Promise<Task | null>;
  updateTask: (id: string, input: TaskUpdateInput) => Promise<void>;
  completeTask: (id: string) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  clearError: () => void;
}

function toErrorMessage(err: unknown) {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  isLoading: false,
  isSaving: false,
  error: null,
  loadTasks: async () => {
    set({ isLoading: true });
    try {
      const tasks = await taskService.list();
      set({ tasks });
    } catch (err) {
      set({ error: toErrorMessage(err) });
    } finally {
      set({ isLoading: false });
    }
  },
  createTask: async (input) => {
    set({ isSaving: true });
    try {
      const created = await taskService.create(input);
      set({ tasks: [created, ...get().tasks] });
      return created;
    } catch (err) {
      set({ error: toErrorMessage(err) });
      return null;
    } finally {
      set({ isSaving: false });
    }
  },
  updateTask: async (id, input) => {
    set({ isSaving: true });
    try {
      const updated = await taskService.update(id, input);
      if (!updated) {
        set({ error: "Task not found." });
        return;
      }
      const tasks = get().tasks.map((task) =>
        task.id === id ? updated : task
      );
      set({ tasks });
    } catch (err) {
      set({ error: toErrorMessage(err) });
    } finally {
      set({ isSaving: false });
    }
  },
  completeTask: async (id) => {
    set({ isSaving: true });
    try {
      const updated = await taskService.complete(id);
      if (!updated) {
        set({ error: "Task not found." });
        return;
      }
      const tasks = get().tasks.map((task) =>
        task.id === id ? updated : task
      );
      set({ tasks });
    } catch (err) {
      set({ error: toErrorMessage(err) });
    } finally {
      set({ isSaving: false });
    }
  },
  deleteTask: async (id) => {
    set({ isSaving: true });
    try {
      const removed = await taskService.delete(id);
      if (!removed) {
        set({ error: "Task not found." });
        return;
      }
      const tasks = get().tasks.filter((task) => task.id !== id);
      set({ tasks });
    } catch (err) {
      set({ error: toErrorMessage(err) });
    } finally {
      set({ isSaving: false });
    }
  },
  clearError: () => set({ error: null })
}));
