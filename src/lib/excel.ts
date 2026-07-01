/**
 * Pure TypeScript Excel/CSV file I/O helpers.
 * Uses SheetJS (xlsx) and PapaParse — no Python dependency.
 */

import * as XLSX from "xlsx";
import Papa from "papaparse";
import { promises as fs } from "fs";
import path from "path";

export const DOWNLOAD_DIR = path.join(process.cwd(), "download");

export async function ensureDownloadDir(): Promise<void> {
  await fs.mkdir(DOWNLOAD_DIR, { recursive: true });
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** A row is a flat object keyed by column name. Values are always strings. */
export type Row = Record<string, string>;
export type Sheet = {
  name: string;
  columns: string[];
  rows: Row[];
};

/**
 * Read an Excel (.xlsx/.xls) or CSV file into rows.
 * All values are coerced to strings to mirror the Python `dtype=str` behavior.
 */
export async function readFileToRows(
  filepath: string,
  delimiter: string = ",",
): Promise<Sheet[]> {
  const ext = path.extname(filepath).toLowerCase();
  const buffer = await fs.readFile(filepath);

  if (ext === ".csv" || ext === ".tsv") {
    const text = buffer.toString("utf-8");
    const delim = ext === ".tsv" ? "\t" : delimiter;
    const parsed = Papa.parse<Record<string, string>>(text, {
      header: true,
      delimiter: delim,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      transform: (val) => (val == null ? "" : String(val)),
    });
    const columns = parsed.meta.fields || [];
    const rows = (parsed.data || []).map((r) => {
      const out: Row = {};
      for (const c of columns) out[c] = r[c] ?? "";
      return out;
    });
    return [{ name: "Sheet1", columns, rows }];
  }

  // Excel
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
  return wb.SheetNames.map((sheetName) => {
    const ws = wb.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json<string[]>(ws, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false,
    }) as string[][];
    if (aoa.length === 0) return { name: sheetName, columns: [], rows: [] };
    const columns = aoa[0].map((c) => String(c ?? ""));
    const rows: Row[] = [];
    for (let i = 1; i < aoa.length; i++) {
      const row: Row = {};
      for (let j = 0; j < columns.length; j++) {
        row[columns[j]] = aoa[i] && aoa[i][j] != null ? String(aoa[i][j]) : "";
      }
      rows.push(row);
    }
    return { name: sheetName, columns, rows };
  });
}

/** Save rows to a file (xlsx or csv). Returns filename, filepath, size, mime. */
export async function saveRowsToFile(
  rows: Row[],
  baseName: string,
  suffix: string,
  outputFormat: "xlsx" | "csv" = "xlsx",
  delimiter: string = ",",
): Promise<{ filename: string; filepath: string; size: number; mime: string }> {
  await ensureDownloadDir();
  const uid = Math.random().toString(36).slice(2, 10);
  const safeBase = sanitizeFilename(baseName) || "output";
  const cleanSuffix = suffix ? `_${suffix}` : "";

  let filename: string;
  let filepath: string;
  let mime: string;
  let buffer: Buffer;

  if (outputFormat === "csv") {
    filename = `${safeBase}${cleanSuffix}_${uid}.csv`;
    filepath = path.join(DOWNLOAD_DIR, filename);
    mime = "text/csv";
    const text = Papa.unparse(rows, { delimiter });
    buffer = Buffer.from(text, "utf-8");
  } else {
    filename = `${safeBase}${cleanSuffix}_${uid}.xlsx`;
    filepath = path.join(DOWNLOAD_DIR, filename);
    mime =
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{}]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const out = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    buffer = Buffer.from(out);
  }

  await fs.writeFile(filepath, buffer);
  const size = buffer.length;
  return { filename, filepath, size, mime };
}

/** Save multiple sheets to a single xlsx file. */
export async function saveSheetsToFile(
  sheets: { name: string; rows: Row[] }[],
  baseName: string,
  suffix: string,
): Promise<{ filename: string; filepath: string; size: number; mime: string }> {
  await ensureDownloadDir();
  const uid = Math.random().toString(36).slice(2, 10);
  const safeBase = sanitizeFilename(baseName) || "output";
  const filename = `${safeBase}_${suffix}_${uid}.xlsx`;
  const filepath = path.join(DOWNLOAD_DIR, filename);
  const mime =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const ws = XLSX.utils.json_to_sheet(sheet.rows.length ? sheet.rows : [{}]);
    // Sheet name max 31 chars, no special chars
    const safeName = (sheet.name || "Sheet").replace(/[\\/?*[\]:]/g, "_").slice(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, safeName);
  }
  const out = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const buffer = Buffer.from(out);
  await fs.writeFile(filepath, buffer);
  return { filename, filepath, size: buffer.length, mime };
}

/** Convert a value to a number, or NaN if not numeric. */
export function toNum(v: unknown): number {
  if (v == null || v === "") return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/** Check if a string value is numeric. */
export function isNumeric(v: unknown): boolean {
  return Number.isFinite(toNum(v));
}

/** Round a number to N decimals, returning a number. */
export function round(v: number, decimals = 4): number {
  const f = Math.pow(10, decimals);
  return Math.round(v * f) / f;
}

/** Mean of an array of numbers. */
export function mean(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** Standard deviation (sample) of an array of numbers. */
export function stdDev(nums: number[]): number {
  if (nums.length < 2) return 0;
  const m = mean(nums);
  const variance =
    nums.reduce((acc, n) => acc + Math.pow(n - m, 2), 0) / (nums.length - 1);
  return Math.sqrt(variance);
}

/** Median of an array of numbers. */
export function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Quantile (0-1) of an array of numbers. */
export function quantile(nums: number[], q: number): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined
    ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
    : sorted[base];
}

/** Count occurrences of each distinct value, returning top N. */
export function topValues(rows: Row[], column: string, n: number = 5) {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const v = String(r[column] ?? "");
    if (v === "") continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([value, count]) => ({ value, count }));
}

/** Convert rows to plain objects for JSON serialization (strings only). */
export function rowsToDicts(rows: Row[]): Row[] {
  return rows.map((r) => {
    const out: Row = {};
    for (const [k, v] of Object.entries(r)) out[k] = v == null ? "" : String(v);
    return out;
  });
}
