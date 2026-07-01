import path from "path";
import fs from "fs/promises";
import { v4 as uuidv4 } from "uuid";

const UPLOAD_DIR = path.join(process.cwd(), "download");
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export async function ensureUploadDir() {
  try {
    await fs.access(UPLOAD_DIR);
  } catch {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
  }
}

export function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function saveUploadedFile(file: File): Promise<{ filePath: string; originalName: string; size: number }> {
  await ensureUploadDir();

  if (file.size > MAX_FILE_SIZE) {
    throw new Error("File size exceeds 50MB limit");
  }

  const ext = path.extname(file.name);
  const uniqueName = `${uuidv4()}${ext}`;
  const filePath = path.join(UPLOAD_DIR, uniqueName);

  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(filePath, buffer);

  return { filePath, originalName: sanitizeFilename(file.name), size: file.size };
}

export async function getFileBuffer(filePath: string): Promise<Buffer> {
  return await fs.readFile(filePath);
}

export async function deleteFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    // ignore
  }
}
