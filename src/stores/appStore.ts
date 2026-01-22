import { create } from "zustand";
import type { DiaryMode } from "../types/database";

export type AppMode = DiaryMode;

interface AppState {
  appMode: AppMode;
  setAppMode: (mode: AppMode) => void;
}

export const useAppStore = create<AppState>((set) => ({
  appMode: "traditional",
  setAppMode: (appMode) => set({ appMode })
}));
