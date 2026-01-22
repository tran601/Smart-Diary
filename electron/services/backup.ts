import fs from "fs";
import path from "path";
import { app, dialog } from "electron";
import Database from "better-sqlite3";
import {
  backupDatabaseFile,
  closeDatabase,
  getDatabasePath,
  initDatabase,
  setSettings
} from "./database";
import { decryptBuffer, encryptBuffer } from "./encryption";

const AI_KEY_SETTING = "ai_api_key";

function buildDefaultBackupName() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `smart-diary-backup-${year}${month}${day}.sqlite`;
}

function scrubApiKey(databasePath: string) {
  const tempDb = new Database(databasePath);
  tempDb.prepare("UPDATE settings SET value = NULL WHERE key = ?").run(AI_KEY_SETTING);
  tempDb.close();
}

export async function exportDatabaseBackup(): Promise<{ path: string } | null> {
  const defaultPath = path.join(app.getPath("documents"), buildDefaultBackupName());
  const result = await dialog.showSaveDialog({
    title: "导出备份",
    defaultPath,
    filters: [{ name: "SQLite", extensions: ["sqlite", "db"] }]
  });
  if (result.canceled || !result.filePath) {
    return null;
  }

  const dbPath = getDatabasePath();
  if (path.resolve(result.filePath) === path.resolve(dbPath)) {
    throw new Error("备份路径不能与当前数据库相同。");
  }

  const tempPath = path.join(
    app.getPath("temp"),
    `smart-diary-backup-${Date.now()}.sqlite`
  );
  await backupDatabaseFile(tempPath);
  scrubApiKey(tempPath);

  const raw = fs.readFileSync(tempPath);
  const encrypted = encryptBuffer(raw);
  fs.writeFileSync(result.filePath, encrypted);
  fs.unlinkSync(tempPath);

  return { path: result.filePath };
}

export async function importDatabaseBackup(): Promise<{ path: string } | null> {
  const result = await dialog.showOpenDialog({
    title: "导入备份",
    filters: [{ name: "SQLite", extensions: ["sqlite", "db"] }],
    properties: ["openFile"]
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const filePath = result.filePaths[0];
  const buffer = fs.readFileSync(filePath);
  const decrypted = decryptBuffer(buffer);

  const tempPath = path.join(
    app.getPath("temp"),
    `smart-diary-import-${Date.now()}.sqlite`
  );
  fs.writeFileSync(tempPath, decrypted);
  scrubApiKey(tempPath);

  closeDatabase();
  fs.copyFileSync(tempPath, getDatabasePath());
  fs.unlinkSync(tempPath);
  initDatabase();
  setSettings({ aiApiKey: null });

  return { path: filePath };
}
