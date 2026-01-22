import type { Task, TaskCreateInput, TaskUpdateInput } from "../types/database";

export const taskService = {
  list: (): Promise<Task[]> => window.api.task.list(),
  create: (input: TaskCreateInput): Promise<Task> => window.api.task.create(input),
  update: (id: string, input: TaskUpdateInput): Promise<Task | null> =>
    window.api.task.update(id, input),
  complete: (id: string): Promise<Task | null> => window.api.task.complete(id),
  delete: (id: string): Promise<boolean> => window.api.task.delete(id)
};
