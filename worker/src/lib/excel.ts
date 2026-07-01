import * as XLSX from 'xlsx';
import Papa from 'papaparse';

export type Row = Record<string, string>;
export type Sheet = {
  name: string;
  columns: string[];
  rows: Row[];
};

/**
 * Read an Excel or CSV file from a buffer into rows.
 */
export function readBufferToRows(
  buffer: ArrayBuffer,
  filename: string,
  delimiter: string = ','
): Sheet[] {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  
  if (ext === 'csv' || ext === 'tsv') {
    const text = new TextDecoder().decode(buffer);
    const delim = ext === 'tsv' ? '\t' : delimiter;
    const parsed = Papa.parse<Record<string, string>>(text, {
      header: true,
      delimiter: delim,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      transform: (val) => (val == null ? '' : String(val)),
    });
    const columns = parsed.meta.fields || [];
    const rows = (parsed.data || []).map((r) => {
      const out: Row = {};
      for (const c of columns) out[c] = r[c] ?? '';
      return out;
    });
    return [{ name: 'Sheet1', columns, rows }];
  }

  // Excel
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false });
  return wb.SheetNames.map((sheetName) => {
    const ws = wb.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json<string[]>(ws, {
      header: 1,
      raw: false,
      defval: '',
      blankrows: false,
    }) as string[][];
    if (aoa.length === 0) return { name: sheetName, columns: [], rows: [] };
    const columns = aoa[0].map((c) => String(c ?? ''));
    const rows: Row[] = [];
    for (let i = 1; i < aoa.length; i++) {
      const row: Row = {};
      for (let j = 0; j < columns.length; j++) {
        row[columns[j]] = aoa[i] && aoa[i][j] != null ? String(aoa[i][j]) : '';
      }
      rows.push(row);
    }
    return { name: sheetName, columns, rows };
  });
}

/**
 * Save rows to a buffer (xlsx or csv).
 */
export function saveRowsToBuffer(
  rows: Row[],
  outputFormat: 'xlsx' | 'csv' = 'xlsx',
  delimiter: string = ','
): { buffer: ArrayBuffer; mime: string; extension: string } {
  if (outputFormat === 'csv') {
    const text = Papa.unparse(rows, { delimiter });
    const encoded = new TextEncoder().encode(text);
    return { buffer: encoded.buffer as ArrayBuffer, mime: 'text/csv', extension: 'csv' };
  }

  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{}]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return {
    buffer: out,
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extension: 'xlsx',
  };
}

/**
 * Save multiple sheets to a single xlsx buffer.
 */
export function saveSheetsToBuffer(
  sheets: { name: string; rows: Row[] }[]
): { buffer: ArrayBuffer; mime: string; extension: string } {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const ws = XLSX.utils.json_to_sheet(sheet.rows.length ? sheet.rows : [{}]);
    const safeName = (sheet.name || 'Sheet').replace(/[\\/?*[\]:]/g, '_').slice(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, safeName);
  }
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return {
    buffer: out,
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extension: 'xlsx',
  };
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function toNum(v: unknown): number {
  if (v == null || v === '') return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

export function isNumeric(v: unknown): boolean {
  return Number.isFinite(toNum(v));
}

export function round(v: number, decimals = 4): number {
  const f = Math.pow(10, decimals);
  return Math.round(v * f) / f;
}

export function mean(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function stdDev(nums: number[]): number {
  if (nums.length < 2) return 0;
  const m = mean(nums);
  const variance = nums.reduce((acc, n) => acc + Math.pow(n - m, 2), 0) / (nums.length - 1);
  return Math.sqrt(variance);
}

export function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

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

export function topValues(rows: Row[], column: string, n: number = 5) {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const v = String(r[column] ?? '');
    if (v === '') continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([value, count]) => ({ value, count }));
}

export function rowsToDicts(rows: Row[]): Row[] {
  return rows.map((r) => {
    const out: Row = {};
    for (const [k, v] of Object.entries(r)) out[k] = v == null ? '' : String(v);
    return out;
  });
}
