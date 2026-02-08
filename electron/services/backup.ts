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
import { getDiaryImagesRootPath } from "./diaryMedia";
import { decryptBuffer, encryptBuffer } from "./encryption";

const AI_KEY_SETTING = "ai_api_key";
const BACKUP_VERSION = 2;

type BackupArchive = {
  version: typeof BACKUP_VERSION;
  createdAt: string;
  databaseBase64: string;
  images: Array<{
    path: string;
    dataBase64: string;
  }>;
};

function buildDefaultBackupName() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");
  return `smart-diary-backup-${year}${month}${day}-${hour}${minute}.sdbak`;
}

function scrubApiKey(databasePath: string) {
  const tempDb = new Database(databasePath);
  tempDb.prepare("UPDATE settings SET value = NULL WHERE key = ?").run(AI_KEY_SETTING);
  tempDb.close();
}

function normalizeArchivePath(inputPath: string) {
  const normalized = path.posix.normalize(inputPath).replace(/^\/+/, "");
  if (!normalized || normalized === "." || normalized.startsWith("..")) {
    throw new Error("Invalid attachment path in backup archive.");
  }
  return normalized;
}

function listRelativeFiles(rootDir: string, currentDir = rootDir): string[] {
  if (!fs.existsSync(currentDir)) {
    return [];
  }

  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      result.push(...listRelativeFiles(rootDir, absolutePath));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const relativePath = path.relative(rootDir, absolutePath).split(path.sep).join("/");
    result.push(normalizeArchivePath(relativePath));
  }
  return result;
}

function copyDirectory(sourceDir: string, targetDir: string) {
  if (!fs.existsSync(sourceDir)) {
    return;
  }
  fs.mkdirSync(targetDir, { recursive: true });
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, targetPath);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    fs.copyFileSync(sourcePath, targetPath);
  }
}

function buildArchiveFromLocal(tempDbPath: string): BackupArchive {
  const imagesRoot = getDiaryImagesRootPath();
  const imageFiles = listRelativeFiles(imagesRoot);
  const images = imageFiles.map((relativePath) => {
    const absolutePath = path.join(imagesRoot, ...relativePath.split("/"));
    const data = fs.readFileSync(absolutePath);
    return {
      path: relativePath,
      dataBase64: data.toString("base64")
    };
  });

  const dbBuffer = fs.readFileSync(tempDbPath);
  return {
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    databaseBase64: dbBuffer.toString("base64"),
    images
  };
}

function parseArchive(buffer: Buffer): BackupArchive | null {
  try {
    const parsed = JSON.parse(buffer.toString("utf8")) as Partial<BackupArchive>;
    if (
      parsed?.version !== BACKUP_VERSION ||
      typeof parsed.databaseBase64 !== "string" ||
      !Array.isArray(parsed.images)
    ) {
      return null;
    }
    return {
      version: BACKUP_VERSION,
      createdAt:
        typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString(),
      databaseBase64: parsed.databaseBase64,
      images: parsed.images
        .filter(
          (item): item is { path: string; dataBase64: string } =>
            typeof item?.path === "string" && typeof item?.dataBase64 === "string"
        )
        .map((item) => ({
          path: normalizeArchivePath(item.path),
          dataBase64: item.dataBase64
        }))
    };
  } catch {
    return null;
  }
}

function restoreFromArchive(archive: BackupArchive) {
  const tempDbPath = path.join(app.getPath("temp"), `smart-diary-import-${Date.now()}.sqlite`);
  const tempImagesRoot = path.join(
    app.getPath("temp"),
    `smart-diary-import-images-${Date.now()}`
  );

  fs.writeFileSync(tempDbPath, Buffer.from(archive.databaseBase64, "base64"));
  scrubApiKey(tempDbPath);
  fs.mkdirSync(tempImagesRoot, { recursive: true });

  for (const image of archive.images) {
    const relativePath = normalizeArchivePath(image.path);
    const absolutePath = path.join(tempImagesRoot, ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, Buffer.from(image.dataBase64, "base64"));
  }

  closeDatabase();
  fs.copyFileSync(tempDbPath, getDatabasePath());

  const imagesRoot = getDiaryImagesRootPath();
  fs.rmSync(imagesRoot, { recursive: true, force: true });
  fs.mkdirSync(imagesRoot, { recursive: true });
  copyDirectory(tempImagesRoot, imagesRoot);

  fs.rmSync(tempImagesRoot, { recursive: true, force: true });
  fs.unlinkSync(tempDbPath);
  initDatabase();
  setSettings({ aiApiKey: null });
}

function restoreFromLegacyDatabase(decryptedDatabase: Buffer) {
  const tempDbPath = path.join(app.getPath("temp"), `smart-diary-import-${Date.now()}.sqlite`);
  fs.writeFileSync(tempDbPath, decryptedDatabase);
  scrubApiKey(tempDbPath);

  closeDatabase();
  fs.copyFileSync(tempDbPath, getDatabasePath());
  fs.unlinkSync(tempDbPath);
  initDatabase();
  setSettings({ aiApiKey: null });
}

export async function exportDatabaseBackup(): Promise<{ path: string } | null> {
  const defaultPath = path.join(app.getPath("documents"), buildDefaultBackupName());
  const result = await dialog.showSaveDialog({
    title: "导出备份",
    defaultPath,
    filters: [{ name: "Smart Diary Backup", extensions: ["sdbak"] }]
  });
  if (result.canceled || !result.filePath) {
    return null;
  }

  const tempPath = path.join(app.getPath("temp"), `smart-diary-backup-${Date.now()}.sqlite`);
  await backupDatabaseFile(tempPath);
  scrubApiKey(tempPath);

  const archive = buildArchiveFromLocal(tempPath);
  const serialized = Buffer.from(JSON.stringify(archive), "utf8");
  const encrypted = encryptBuffer(serialized);
  fs.writeFileSync(result.filePath, encrypted);
  fs.unlinkSync(tempPath);

  return { path: result.filePath };
}

export async function importDatabaseBackup(): Promise<{ path: string } | null> {
  const result = await dialog.showOpenDialog({
    title: "导入备份",
    filters: [{ name: "Smart Diary Backup", extensions: ["sdbak", "sqlite", "db"] }],
    properties: ["openFile"]
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const filePath = result.filePaths[0];
  const buffer = fs.readFileSync(filePath);
  const decrypted = decryptBuffer(buffer);
  const archive = parseArchive(decrypted);
  const expectsArchive = filePath.toLowerCase().endsWith(".sdbak");

  if (archive) {
    restoreFromArchive(archive);
    return { path: filePath };
  }
  if (expectsArchive) {
    throw new Error("Invalid Smart Diary backup file.");
  }

  restoreFromLegacyDatabase(decrypted);
  return { path: filePath };
}
