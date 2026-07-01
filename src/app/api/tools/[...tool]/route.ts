import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, readFile, stat, unlink } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

import {
  toolMerge,
  toolColumns,
  toolDuplicates,
  toolConvert,
  toolStats,
  toolSort,
  toolFilter,
  toolReplace,
  toolTranspose,
  toolPivot,
  toolValidate,
  toolAttendance,
  toolPreview,
  toolDownloadExcel,
  toolDownloadImages,
  toolHistoryGet,
  toolHistoryDelete,
  toolErrorsGet,
  logError,
} from "@/lib/tools";
import { DOWNLOAD_DIR } from "@/lib/excel";

const UPLOAD_DIR = path.join(process.cwd(), "tmp-uploads");

async function ensureUploadDir() {
  try {
    await mkdir(UPLOAD_DIR, { recursive: true });
  } catch {}
}

interface SavedFile {
  tempPath: string;
  originalName: string;
  size: number;
}

async function saveUploadedFile(file: File): Promise<SavedFile> {
  await ensureUploadDir();
  const buffer = Buffer.from(await file.arrayBuffer());
  const uid = randomUUID().slice(0, 8);
  const ext = path.extname(file.name) || ".xlsx";
  const tempName = `upload_${uid}${ext}`;
  const tempPath = path.join(UPLOAD_DIR, tempName);
  await writeFile(tempPath, buffer);
  return { tempPath, originalName: file.name, size: buffer.length };
}

async function cleanupFiles(files: SavedFile[]) {
  for (const f of files) {
    try { await unlink(f.tempPath); } catch {}
  }
}

// ─── POST handler ────────────────────────────────────────────────────────────
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tool: string[] }> }
) {
  const { tool: toolParts } = await params;
  const toolName = toolParts.join("/");

  try {
    const contentType = request.headers.get("content-type") || "";
    let args: Record<string, unknown> = {};

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const savedFiles: SavedFile[] = [];

      for (const [key, value] of formData.entries()) {
        if (value instanceof File) {
          const saved = await saveUploadedFile(value);
          savedFiles.push(saved);

          if (key === "files") {
            if (!args.files) args.files = [];
            (args.files as string[]).push(saved.tempPath);
          } else if (key === "file") {
            args.filepath = saved.tempPath;
            args.originalName = saved.originalName;
          }
        } else {
          let parsedValue: unknown = value;
          if (typeof value === "string" && (value.startsWith("[") || value.startsWith("{"))) {
            try { parsedValue = JSON.parse(value); } catch {}
          }
          args[key] = parsedValue;
        }
      }

      // Merge tool: ensure files array
      if (toolName === "merge" && savedFiles.length >= 2) {
        args.files = savedFiles.map((f) => f.tempPath);
      }

      const result = await dispatchTool(toolName, args);
      await cleanupFiles(savedFiles);
      return NextResponse.json(result);
    } else if (contentType.includes("application/json")) {
      const body = await request.json();
      args = { ...body };
      const result = await dispatchTool(toolName, args);
      return NextResponse.json(result);
    } else {
      return NextResponse.json({ error: "Unsupported content type" }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[POST /api/tools/${toolName}]`, error);
    await logError(toolName, message, error instanceof Error ? (error.stack || "") : "");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── GET handler ─────────────────────────────────────────────────────────────
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tool: string[] }> }
) {
  const { tool: toolParts } = await params;
  const toolName = toolParts.join("/");
  const url = new URL(request.url);

  try {
    if (toolName === "download") {
      const filename = url.searchParams.get("file");
      if (!filename) {
        return NextResponse.json({ error: "Filename is required" }, { status: 400 });
      }
      const safeName = path.basename(filename);
      const filePath = path.join(DOWNLOAD_DIR, safeName);
      try {
        await stat(filePath);
      } catch {
        return NextResponse.json({ error: "File not found" }, { status: 404 });
      }
      const buffer = await readFile(filePath);
      const ext = path.extname(safeName).toLowerCase();
      let contentType = "application/octet-stream";
      if (ext === ".xlsx") {
        contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      } else if (ext === ".csv") {
        contentType = "text/csv";
      }
      return new NextResponse(buffer, {
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": `attachment; filename="${safeName}"`,
          "Content-Length": buffer.length.toString(),
        },
      });
    } else if (toolName === "preview") {
      const filename = url.searchParams.get("file") || "";
      const rows = parseInt(url.searchParams.get("rows") || "50", 10);
      const result = await toolPreview({ file: filename, rows });
      return NextResponse.json(result);
    } else if (toolName === "history") {
      const result = await toolHistoryGet();
      return NextResponse.json(result);
    } else if (toolName === "errors") {
      const result = await toolErrorsGet();
      return NextResponse.json(result);
    } else {
      return NextResponse.json({ error: `Unknown GET endpoint: ${toolName}` }, { status: 404 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[GET /api/tools/${toolName}]`, error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── DELETE handler ──────────────────────────────────────────────────────────
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tool: string[] }> }
) {
  const { tool: toolParts } = await params;
  const toolName = toolParts.join("/");
  const url = new URL(request.url);

  try {
    if (toolName === "history") {
      const id = url.searchParams.get("id") || "";
      const result = await toolHistoryDelete({ id });
      return NextResponse.json(result);
    }
    return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── Tool dispatcher ─────────────────────────────────────────────────────────
async function dispatchTool(
  tool: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (tool) {
    case "merge":
      return toolMerge(args as any);
    case "columns":
      return toolColumns(args as any);
    case "duplicates":
      return toolDuplicates(args as any);
    case "convert":
      return toolConvert(args as any);
    case "stats":
      return toolStats(args as any);
    case "sort":
      return toolSort(args as any);
    case "filter":
      return toolFilter(args as any);
    case "replace":
      return toolReplace(args as any);
    case "transpose":
      return toolTranspose(args as any);
    case "pivot":
      return toolPivot(args as any);
    case "validate":
      return toolValidate(args as any);
    case "attendance":
      return toolAttendance(args as any);
    case "preview":
      return toolPreview(args as any);
    case "download-excel":
      return toolDownloadExcel(args as any);
    case "download-images":
      return toolDownloadImages(args as any);
    case "history_get":
      return toolHistoryGet();
    case "history_delete":
      return toolHistoryDelete(args as any);
    case "errors_get":
      return toolErrorsGet();
    default:
      return { error: `Unknown tool: ${tool}` };
  }
}
