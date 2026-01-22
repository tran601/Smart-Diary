import type { AppSettings, AppSettingsPublic } from "../types/database";

export const settingsService = {
  get: (): Promise<AppSettingsPublic> => window.api.settings.get(),
  set: (input: Partial<AppSettings>): Promise<AppSettingsPublic> =>
    window.api.settings.set(input)
};
