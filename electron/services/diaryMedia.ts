import { createHash, randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { app, nativeImage, net, protocol } from "electron";
import {
  createDiaryAttachment,
  deleteDiaryAttachment,
  getDiaryAttachmentsByStoragePaths,
  listDiaryAttachmentsByDiaryId,
  type DiaryAttachmentRecord,
  type DiaryAttachmentSource
} from "./database";

const MEDIA_PROTOCOL = "smart-diary-media";
const MEDIA_HOST = "local";
const MEDIA_ROOT_DIR = "images";
const MAX_IMAGE_EDGE = 1920;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

type RawImageBytes = ArrayBuffer | Uint8Array | Buffer;

export type DiaryImageUploadInput = {
  diaryId: string;
  fileName?: string;
  mimeType?: string;
  source: DiaryAttachmentSource;
  data: RawImageBytes;
};

export type DiaryImageUploadResult = {
  attachment: DiaryAttachmentRecord;
  src: string;
};

type EncodedImage = {
  buffer: Buffer;
  mimeType: string;
  fileExt: string;
  width: number;
  height: number;
};

type MediaVariant = "preview" | "original";

let protocolRegistered = false;

function normalizeStoragePath(storagePath: string) {
  return storagePath.replace(/\\/g, "/").replace(/^\/+/, "");
}

function getUserDataPath() {
  return app.getPath("userData");
}

function getImagesRootPath() {
  return path.join(getUserDataPath(), MEDIA_ROOT_DIR);
}

function toAbsoluteStoragePath(storagePath: string) {
  const normalized = normalizeStoragePath(storagePath);
  const normalizedPosix = path.posix.normalize(normalized);
  if (
    !normalizedPosix ||
    normalizedPosix === "." ||
    normalizedPosix.startsWith("..") ||
    !normalizedPosix.startsWith(`${MEDIA_ROOT_DIR}/`)
  ) {
    throw new Error("Invalid attachment storage path.");
  }
  const targetPath = path.join(getUserDataPath(), ...normalizedPosix.split("/"));
  const resolvedTarget = path.resolve(targetPath);
  const resolvedRoot = path.resolve(getImagesRootPath());
  if (
    resolvedTarget !== resolvedRoot &&
    !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new Error("Attachment path escapes images root.");
  }
  return resolvedTarget;
}

function ensureDirectory(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function toStoragePathFromAbsolute(absolutePath: string) {
  const relative = path
    .relative(getUserDataPath(), absolutePath)
    .split(path.sep)
    .join("/");
  return normalizeStoragePath(relative);
}

function resolveOriginalStoragePathFromPreview(previewStoragePath: string) {
  const previewAbsolutePath = toAbsoluteStoragePath(previewStoragePath);
  const previewFileName = path.basename(previewAbsolutePath);
  const match = previewFileName.match(/^(.*)\.preview\.[^.]+$/);
  if (!match) {
    return null;
  }
  const namePrefix = `${match[1]}.original.`;
  const parentDir = path.dirname(previewAbsolutePath);
  if (!fs.existsSync(parentDir)) {
    return null;
  }
  const originalFile = fs
    .readdirSync(parentDir, { withFileTypes: true })
    .find((entry) => entry.isFile() && entry.name.startsWith(namePrefix));
  if (!originalFile) {
    return null;
  }
  const originalAbsolutePath = path.join(parentDir, originalFile.name);
  return toStoragePathFromAbsolute(originalAbsolutePath);
}

function resolveStoragePathByVariant(storagePath: string, variant: MediaVariant) {
  if (variant !== "original") {
    return storagePath;
  }
  return resolveOriginalStoragePathFromPreview(storagePath) ?? storagePath;
}

function deleteFileIfExists(storagePath: string) {
  const absolutePath = toAbsoluteStoragePath(storagePath);
  if (fs.existsSync(absolutePath)) {
    fs.unlinkSync(absolutePath);
  }
}

export function toDiaryMediaUrl(storagePath: string, variant: MediaVariant = "preview") {
  const normalized = normalizeStoragePath(storagePath);
  const baseUrl = `${MEDIA_PROTOCOL}://${MEDIA_HOST}/${encodeURI(normalized)}`;
  if (variant === "original") {
    return `${baseUrl}?variant=original`;
  }
  return baseUrl;
}

function parseMediaRequest(requestUrl: string): { storagePath: string; variant: MediaVariant } | null {
  const parsed = new URL(requestUrl);
  if (parsed.protocol !== `${MEDIA_PROTOCOL}:`) {
    return null;
  }
  const pathname = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
  if (!pathname) {
    return null;
  }
  const variant = parsed.searchParams.get("variant") === "original" ? "original" : "preview";
  return {
    storagePath: normalizeStoragePath(pathname),
    variant
  };
}

function toBuffer(raw: RawImageBytes) {
  if (Buffer.isBuffer(raw)) {
    return raw;
  }
  if (raw instanceof ArrayBuffer) {
    return Buffer.from(raw);
  }
  if (ArrayBuffer.isView(raw)) {
    return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  }
  throw new Error("Unsupported image payload.");
}

function inferFileExtByMime(mimeType: string) {
  if (mimeType === "image/png") {
    return "png";
  }
  if (mimeType === "image/webp") {
    return "webp";
  }
  if (mimeType === "image/jpeg") {
    return "jpg";
  }
  return "jpg";
}

function pickBestImageEncoding(image: Electron.NativeImage, preferredMime?: string): EncodedImage {
  const originalSize = image.getSize();
  const maxEdge = Math.max(originalSize.width, originalSize.height);
  const scaledImage =
    maxEdge > MAX_IMAGE_EDGE
      ? image.resize({
          width:
            originalSize.width >= originalSize.height
              ? MAX_IMAGE_EDGE
              : Math.max(1, Math.round((originalSize.width * MAX_IMAGE_EDGE) / originalSize.height)),
          height:
            originalSize.height > originalSize.width
              ? MAX_IMAGE_EDGE
              : Math.max(1, Math.round((originalSize.height * MAX_IMAGE_EDGE) / originalSize.width)),
          quality: "best"
        })
      : image;

  const size = scaledImage.getSize();

  const pngBuffer = scaledImage.toPNG();
  const jpegQualities = [86, 78, 70, 62, 54];
  const jpegCandidates = jpegQualities.map((quality) => ({
    buffer: scaledImage.toJPEG(quality),
    mimeType: "image/jpeg",
    fileExt: "jpg",
    width: size.width,
    height: size.height
  }));

  const pngCandidate: EncodedImage = {
    buffer: pngBuffer,
    mimeType: "image/png",
    fileExt: "png",
    width: size.width,
    height: size.height
  };

  const preferPng = preferredMime === "image/png";
  const ordered = preferPng ? [pngCandidate, ...jpegCandidates] : [...jpegCandidates, pngCandidate];
  const acceptable = ordered.find((item) => item.buffer.byteLength <= MAX_IMAGE_BYTES);
  if (!acceptable) {
    throw new Error("Image is too large after compression. Please use a smaller image.");
  }
  return acceptable;
}

function normalizeImageExt(ext: string) {
  const normalized = ext.trim().toLowerCase().replace(/^\./, "");
  if (normalized === "jpeg") {
    return "jpg";
  }
  if (
    normalized === "jpg" ||
    normalized === "png" ||
    normalized === "webp" ||
    normalized === "gif" ||
    normalized === "bmp" ||
    normalized === "ico"
  ) {
    return normalized;
  }
  return "jpg";
}

function inferOriginalFileExt(mimeType?: string, fileName?: string) {
  if (fileName) {
    const extName = path.extname(fileName).trim();
    if (extName) {
      const fromName = normalizeImageExt(extName);
      return fromName;
    }
  }
  return normalizeImageExt(inferFileExtByMime(mimeType ?? "image/jpeg"));
}

function buildStoragePaths(previewExt: string, originalExt: string) {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const baseName = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const directory = path.posix.join(MEDIA_ROOT_DIR, year, month);
  return {
    previewStoragePath: path.posix.join(
      directory,
      `${baseName}.preview.${normalizeImageExt(previewExt)}`
    ),
    originalStoragePath: path.posix.join(
      directory,
      `${baseName}.original.${normalizeImageExt(originalExt)}`
    )
  };
}

function normalizeMimeType(mimeType?: string, fileName?: string) {
  const normalized = (mimeType ?? "").trim().toLowerCase();
  if (normalized.startsWith("image/")) {
    return normalized;
  }
  if (fileName?.toLowerCase().endsWith(".png")) {
    return "image/png";
  }
  if (fileName?.toLowerCase().endsWith(".webp")) {
    return "image/webp";
  }
  return "image/jpeg";
}

export function registerDiaryMediaProtocol() {
  if (protocolRegistered) {
    return;
  }
  protocol.handle(MEDIA_PROTOCOL, async (request) => {
    const mediaRequest = parseMediaRequest(request.url);
    if (!mediaRequest) {
      return new Response("Bad request", { status: 400 });
    }
    let absolutePath: string;
    try {
      const resolvedStoragePath = resolveStoragePathByVariant(
        mediaRequest.storagePath,
        mediaRequest.variant
      );
      absolutePath = toAbsoluteStoragePath(resolvedStoragePath);
    } catch {
      return new Response("Forbidden", { status: 403 });
    }
    if (!fs.existsSync(absolutePath)) {
      return new Response("Not found", { status: 404 });
    }
    return net.fetch(pathToFileURL(absolutePath).toString());
  });
  protocolRegistered = true;
}

export function getDiaryImagesRootPath() {
  const root = getImagesRootPath();
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true });
  }
  return root;
}

export function storeDiaryImage(input: DiaryImageUploadInput): DiaryImageUploadResult {
  const raw = toBuffer(input.data);
  if (raw.byteLength === 0) {
    throw new Error("Image payload is empty.");
  }
  if (raw.byteLength > MAX_IMAGE_BYTES) {
    throw new Error("Image exceeds 10MB limit.");
  }

  const image = nativeImage.createFromBuffer(raw);
  if (image.isEmpty()) {
    throw new Error("Unsupported image format.");
  }

  const preferredMime = normalizeMimeType(input.mimeType, input.fileName);
  const encoded = pickBestImageEncoding(image, preferredMime);
  const originalFileExt = inferOriginalFileExt(preferredMime, input.fileName);
  const storagePaths = buildStoragePaths(
    encoded.fileExt || inferFileExtByMime(encoded.mimeType),
    originalFileExt
  );
  const previewAbsolutePath = toAbsoluteStoragePath(storagePaths.previewStoragePath);
  const originalAbsolutePath = toAbsoluteStoragePath(storagePaths.originalStoragePath);
  ensureDirectory(previewAbsolutePath);
  ensureDirectory(originalAbsolutePath);
  fs.writeFileSync(previewAbsolutePath, encoded.buffer);
  fs.writeFileSync(originalAbsolutePath, raw);

  const sha256 = createHash("sha256").update(raw).digest("hex");
  try {
    const attachment = createDiaryAttachment({
      diaryId: input.diaryId,
      storagePath: storagePaths.previewStoragePath,
      mimeType: encoded.mimeType,
      fileExt: encoded.fileExt || inferFileExtByMime(encoded.mimeType),
      sizeBytes: encoded.buffer.byteLength,
      width: encoded.width,
      height: encoded.height,
      sha256,
      source: input.source
    });
    return {
      attachment,
      src: toDiaryMediaUrl(storagePaths.previewStoragePath, "preview")
    };
  } catch (err) {
    if (fs.existsSync(previewAbsolutePath)) {
      fs.unlinkSync(previewAbsolutePath);
    }
    if (fs.existsSync(originalAbsolutePath)) {
      fs.unlinkSync(originalAbsolutePath);
    }
    throw err;
  }
}

export function removeDiaryAttachmentFile(attachmentId: string) {
  const attachment = deleteDiaryAttachment(attachmentId);
  if (!attachment) {
    return null;
  }

  const activeReferences = getDiaryAttachmentsByStoragePaths([attachment.storagePath]);
  if (activeReferences.length > 0) {
    return attachment;
  }

  deleteFileIfExists(attachment.storagePath);
  const originalStoragePath = resolveOriginalStoragePathFromPreview(attachment.storagePath);
  if (originalStoragePath) {
    deleteFileIfExists(originalStoragePath);
  }
  return attachment;
}

export function cleanupDiaryImagesByDiaryId(diaryId: string) {
  const attachments = listDiaryAttachmentsByDiaryId(diaryId, true);
  const uniqueStoragePaths = new Set(attachments.map((item) => item.storagePath));

  let removed = 0;
  for (const storagePath of uniqueStoragePaths) {
    const activeReferences = getDiaryAttachmentsByStoragePaths([storagePath]);
    if (activeReferences.length > 0) {
      continue;
    }
    deleteFileIfExists(storagePath);
    const originalStoragePath = resolveOriginalStoragePathFromPreview(storagePath);
    if (originalStoragePath) {
      deleteFileIfExists(originalStoragePath);
    }
    removed += 1;
  }

  return removed;
}

export function getAttachmentMaxSizeBytes() {
  return MAX_IMAGE_BYTES;
}
