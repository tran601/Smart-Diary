export const backupService = {
  exportDatabase: (): Promise<{ path: string } | null> =>
    window.api.backup.export(),
  importDatabase: (): Promise<{ path: string } | null> =>
    window.api.backup.import()
};
