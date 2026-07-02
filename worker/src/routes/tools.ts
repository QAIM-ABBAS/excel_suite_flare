import { Hono } from 'hono';
import { Database } from '../lib/db';
import {
  readBufferToRows,
  saveRowsToBuffer,
  saveSheetsToBuffer,
  sanitizeFilename,
  toNum,
  isNumeric,
  round,
  mean,
  stdDev,
  median,
  quantile,
  topValues,
  rowsToDicts,
  type Row,
  type Sheet,
} from '../lib/excel';

type Bindings = {
  DB: D1Database;
  KV: KVNamespace;
};

export const toolsRouter = new Hono<{ Bindings: Bindings }>();

// In-memory file storage (keyed by temporary ID)
const fileStore = new Map<string, { buffer: ArrayBuffer; name: string; type: string }>();

// Helper to generate unique ID
function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// Helper to generate download filename
function generateFilename(baseName: string, extension: string): string {
  const uid = Math.random().toString(36).slice(2, 10);
  return `${sanitizeFilename(baseName)}_${uid}.${extension}`;
}

// POST handler for all tools
toolsRouter.post('/:tool', async (c) => {
  const toolName = c.req.param('tool');
  const db = new Database(c.env.DB);

  try {
    const contentType = c.req.header('content-type') || '';
    let args: Record<string, unknown> = {};

    if (contentType.includes('multipart/form-data')) {
      const formData = await c.req.formData();
      
      for (const [key, value] of formData.entries()) {
        // Check if value is a File (has arrayBuffer method)
        if (typeof value === 'object' && value !== null && 'arrayBuffer' in value) {
          const file = value as File;
          const buffer = await file.arrayBuffer();
          const fileId = generateId();
          
          // Store in memory temporarily
          fileStore.set(fileId, {
            buffer,
            name: file.name,
            type: file.type,
          });
          
          if (key === 'files') {
            if (!args.files) args.files = [];
            (args.files as string[]).push(fileId);
          } else if (key === 'file') {
            args.fileId = fileId;
            args.originalName = file.name;
          }
        } else {
          let parsedValue: unknown = value;
          if (typeof value === 'string' && (value.startsWith('[') || value.startsWith('{'))) {
            try { parsedValue = JSON.parse(value); } catch {}
          }
          args[key] = parsedValue;
        }
      }
    } else if (contentType.includes('application/json')) {
      const body = await c.req.json();
      args = { ...body };
    } else {
      return c.json({ error: 'Unsupported content type' }, 400);
    }

    const result = await dispatchTool(toolName, args, db, c.env.KV);
    
    // If result is a Response (file download), return it directly
    if (result instanceof Response) {
      return result;
    }
    
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[POST /api/tools/${toolName}]`, error);
    await db.logError(toolName, message, error instanceof Error ? (error.stack || '') : '');
    return c.json({ error: message }, 500);
  }
});

// GET handler for downloading generated files from KV
toolsRouter.get('/download-file/:fileId', async (c) => {
  const fileId = c.req.param('fileId');
  const kv = c.env.KV;
  const stored = await kv.get<{ buffer: string; name: string; type: string }>(fileId, { type: 'json' });
  if (!stored) return c.json({ error: 'File not found or expired' }, 404);

  // Decode base64 back to ArrayBuffer
  const binary = atob(stored.buffer);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  return new Response(bytes.buffer, {
    headers: {
      'Content-Type': stored.type,
      'Content-Disposition': `attachment; filename="${stored.name}"`,
    },
  });
});

// GET handler for history and errors
toolsRouter.get('/:tool', async (c) => {
  const toolName = c.req.param('tool');
  const db = new Database(c.env.DB);

  try {
    if (toolName === 'history') {
      const records = await db.getHistory();
      return c.json({ success: true, records });
    } else if (toolName === 'errors') {
      const records = await db.getErrors();
      return c.json({ success: true, records });
    } else {
      return c.json({ error: `Unknown GET endpoint: ${toolName}` }, 404);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[GET /api/tools/${toolName}]`, error);
    return c.json({ error: message }, 500);
  }
});

// DELETE handler
toolsRouter.delete('/:tool', async (c) => {
  const toolName = c.req.param('tool');
  const db = new Database(c.env.DB);
  const url = new URL(c.req.url);

  try {
    if (toolName === 'history') {
      const id = url.searchParams.get('id') || '';
      if (id) {
        const deleted = await db.deleteHistoryRecord(id);
        if (!deleted) {
          return c.json({ error: 'Record not found' }, 404);
        }
        return c.json({ success: true, message: 'Record deleted' });
      } else {
        const count = await db.clearHistory();
        return c.json({ success: true, message: `Cleared ${count} records` });
      }
    }
    return c.json({ error: 'Method not allowed' }, 405);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

// Tool dispatcher
async function dispatchTool(
  tool: string,
  args: Record<string, unknown>,
  db: Database,
  kv: KVNamespace
): Promise<unknown> {
  switch (tool) {
    case 'merge':
      return toolMerge(args, db);
    case 'columns':
      return toolColumns(args);
    case 'duplicates':
      return toolDuplicates(args, db);
    case 'convert':
      return toolConvert(args, db);
    case 'stats':
      return toolStats(args, db);
    case 'sort':
      return toolSort(args, db);
    case 'filter':
      return toolFilter(args, db);
    case 'replace':
      return toolReplace(args, db);
    case 'transpose':
      return toolTranspose(args, db);
    case 'pivot':
      return toolPivot(args, db);
    case 'validate':
      return toolValidate(args, db);
    case 'attendance':
      return toolAttendance(args);
    case 'download-excel':
      return toolDownloadExcel(args, db, kv);
    case 'download-images':
      return toolDownloadImages(args, db, kv);
    default:
      return { error: `Unknown tool: ${tool}` };
  }
}

// Helper to get file buffer from store
function getFileBuffer(fileId: string): ArrayBuffer | null {
  const file = fileStore.get(fileId);
  if (!file) return null;
  // Clean up after use
  fileStore.delete(fileId);
  return file.buffer;
}

// Helper to get multiple file buffers
function getFileBuffers(fileIds: string[]): ArrayBuffer[] {
  const buffers: ArrayBuffer[] = [];
  for (const id of fileIds) {
    const buf = getFileBuffer(id);
    if (buf) buffers.push(buf);
  }
  return buffers;
}

// Helper to create download response
function createDownloadResponse(buffer: ArrayBuffer, filename: string, mime: string): Response {
  return new Response(buffer, {
    headers: {
      'Content-Type': mime,
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

// ─── Tool: merge ─────────────────────────────────────────────────────────────
async function toolMerge(
  args: { files?: string[]; outputFormat?: string; outputFilename?: string; originalName?: string },
  db: Database
) {
  const fileIds = args.files || [];
  const outputFormat = (args.outputFormat as 'xlsx' | 'csv') || 'xlsx';
  const outputFilename = args.outputFilename || 'merged';

  if (fileIds.length < 2) return { error: 'At least 2 files are required' };

  const buffers = getFileBuffers(fileIds);
  if (buffers.length < 2) return { error: 'Could not read all files' };

  const allSheets: Sheet[] = [];
  const allHeaders: string[][] = [];

  for (let i = 0; i < buffers.length; i++) {
    const sheets = readBufferToRows(buffers[i], `file${i}.xlsx`);
    if (sheets.length > 0 && sheets[0].rows.length > 0) {
      allHeaders.push(sheets[0].columns);
      allSheets.push(sheets[0]);
    }
  }

  if (allSheets.length === 0) return { error: 'All files are empty' };

  // Union of all columns
  const allCols = [...new Set(allSheets.flatMap((s) => s.columns))];
  const mergedRows: Row[] = [];
  for (const s of allSheets) {
    for (const r of s.rows) {
      const row: Row = {};
      for (const c of allCols) row[c] = r[c] ?? '';
      mergedRows.push(row);
    }
  }

  const baseHeaders = allHeaders[0] || [];
  const hasMismatch = allHeaders.some(
    (h) => h.length !== baseHeaders.length || h.join('|') !== baseHeaders.join('|'),
  );

  const { buffer, mime, extension } = saveRowsToBuffer(mergedRows, outputFormat);
  const filename = generateFilename(outputFilename, extension);

  // Record in history
  await db.recordFile(filename, `${outputFilename}.${extension}`, mime, buffer.byteLength, 'merge', '');

  return createDownloadResponse(buffer, filename, mime);
}

// ─── Tool: columns ───────────────────────────────────────────────────────────
async function toolColumns(args: { fileId?: string; originalName?: string }) {
  const fileId = args.fileId;
  if (!fileId) return { error: 'File is required' };

  const buffer = getFileBuffer(fileId);
  if (!buffer) return { error: 'File not found' };

  const sheets = readBufferToRows(buffer, args.originalName || 'file.xlsx');
  const result = sheets.map((s) => ({
    name: s.name,
    columns: s.columns,
    rowCount: s.rows.length,
  }));
  const preview = sheets.length > 0 ? rowsToDicts(sheets[0].rows.slice(0, 5)) : [];
  return { success: true, sheets: result, preview };
}

// ─── Tool: duplicates ────────────────────────────────────────────────────────
async function toolDuplicates(
  args: { fileId?: string; column?: string; keepOccurrence?: string; originalName?: string },
  db: Database
) {
  const { fileId, column } = args;
  const keep = args.keepOccurrence === 'last' ? 'last' : 'first';
  if (!fileId || !column) return { error: 'File and column are required' };

  const buffer = getFileBuffer(fileId);
  if (!buffer) return { error: 'File not found' };

  const sheets = readBufferToRows(buffer, args.originalName || 'file.xlsx');
  if (sheets.length === 0 || sheets[0].rows.length === 0) return { error: 'File is empty' };
  
  const sheet = sheets[0];
  if (!sheet.columns.includes(column)) return { error: `Column '${column}' not found` };

  const seen = new Map<string, number>();
  const deletedRows: Row[] = [];
  const remainingRows: Row[] = [];

  for (const r of sheet.rows) {
    const key = String(r[column] ?? '').trim();
    if (seen.has(key)) {
      const firstIdx = seen.get(key)!;
      if (keep === 'first') {
        deletedRows.push(r);
      } else {
        deletedRows.push(remainingRows[firstIdx]);
        remainingRows[firstIdx] = r;
      }
    } else {
      seen.set(key, remainingRows.length);
      remainingRows.push(r);
    }
  }

  const { buffer: outBuffer, mime, extension } = saveRowsToBuffer(remainingRows);
  const baseName = args.originalName?.split('.')[0] || 'output';
  const filename = generateFilename(`${baseName}_cleaned`, extension);

  await db.recordFile(filename, args.originalName || '', mime, outBuffer.byteLength, 'duplicates', '');

  return createDownloadResponse(outBuffer, filename, mime);
}

// ─── Tool: convert ───────────────────────────────────────────────────────────
async function toolConvert(
  args: { fileId?: string; targetFormat?: string; delimiter?: string; sheetName?: string; originalName?: string },
  db: Database
) {
  const fileId = args.fileId;
  const targetFormat = (args.targetFormat as 'xlsx' | 'csv') || 'xlsx';
  const delimiter = args.delimiter || ',';
  if (!fileId) return { error: 'File is required' };

  const buffer = getFileBuffer(fileId);
  if (!buffer) return { error: 'File not found' };

  const sheets = readBufferToRows(buffer, args.originalName || 'file.xlsx', delimiter);
  if (sheets.length === 0) return { error: 'File has no sheets' };

  const sheetNames = sheets.map((s) => s.name);
  let targetSheet: Sheet;
  if (args.sheetName && sheetNames.includes(args.sheetName)) {
    targetSheet = sheets.find((s) => s.name === args.sheetName)!;
  } else {
    targetSheet = sheets[0];
  }

  const { buffer: outBuffer, mime, extension } = saveRowsToBuffer(targetSheet.rows, targetFormat, delimiter);
  const baseName = args.originalName?.split('.')[0] || 'output';
  const filename = generateFilename(baseName, extension);

  await db.recordFile(filename, args.originalName || '', mime, outBuffer.byteLength, 'convert', '');

  return createDownloadResponse(outBuffer, filename, mime);
}

// ─── Tool: stats ─────────────────────────────────────────────────────────────
async function toolStats(
  args: { fileId?: string; generateReport?: string; originalName?: string },
  db: Database
) {
  const fileId = args.fileId;
  const generateReport = args.generateReport === 'true';
  if (!fileId) return { error: 'File is required' };

  const buffer = getFileBuffer(fileId);
  if (!buffer) return { error: 'File not found' };

  const sheets = readBufferToRows(buffer, args.originalName || 'file.xlsx');
  if (sheets.length === 0 || sheets[0].rows.length === 0) return { error: 'File is empty' };
  
  const sheet = sheets[0];
  const stats: Record<string, unknown>[] = [];
  
  for (const col of sheet.columns) {
    const values = sheet.rows.map((r) => r[col]);
    const nonEmpty = values.filter((v) => v != null && v !== '');
    const numericVals = nonEmpty.map(toNum).filter((n) => !Number.isNaN(n));
    const distinct = new Set(nonEmpty.map((v) => String(v))).size;
    const missing = values.length - nonEmpty.length;

    let colType: string;
    if (nonEmpty.length === 0) colType = 'empty';
    else if (numericVals.length === nonEmpty.length) colType = 'numeric';
    else if (numericVals.length === 0) colType = 'text';
    else colType = 'mixed';

    const stat: Record<string, unknown> = {
      column: col,
      type: colType,
      count: nonEmpty.length,
      distinct,
      missing,
    };

    if (colType === 'numeric' || (colType === 'mixed' && numericVals.length > 0)) {
      stat.sum = round(numericVals.reduce((a, b) => a + b, 0));
      stat.avg = round(mean(numericVals));
      stat.min = Math.min(...numericVals);
      stat.max = Math.max(...numericVals);
      stat.median = round(median(numericVals));
      stat.stdDev = round(stdDev(numericVals));
    }

    if (colType === 'text' || colType === 'mixed') {
      const lengths = nonEmpty.map((v) => String(v).length);
      stat.minLength = Math.min(...lengths);
      stat.maxLength = Math.max(...lengths);
      stat.topValues = topValues(sheet.rows, col, 5);
    }
    stats.push(stat);
  }

  if (generateReport) {
    const summaryRows: Row[] = stats.map((s) => ({
      Column: String(s.column),
      Type: String(s.type),
      Count: String(s.count),
      Distinct: String(s.distinct),
      Missing: String(s.missing),
      Sum: s.sum != null ? String(s.sum) : '',
      Average: s.avg != null ? String(s.avg) : '',
      Min: s.min != null ? String(s.min) : '',
      Max: s.max != null ? String(s.max) : '',
      Median: s.median != null ? String(s.median) : '',
      'Std Dev': s.stdDev != null ? String(s.stdDev) : '',
      'Min Length': s.minLength != null ? String(s.minLength) : '',
      'Max Length': s.maxLength != null ? String(s.maxLength) : '',
    }));
    
    const topRows: Row[] = [];
    for (const s of stats) {
      const tvs = (s.topValues as { value: string; count: number }[]) || [];
      for (const tv of tvs) {
        topRows.push({
          Column: String(s.column),
          Value: tv.value,
          Count: String(tv.count),
          'Percent of Filled': Number(s.count) > 0 ? `${((tv.count / Number(s.count)) * 100).toFixed(1)}%` : '0.0%',
        });
      }
    }
    
    const { buffer: outBuffer, mime, extension } = saveSheetsToBuffer([
      { name: 'Summary', rows: summaryRows },
      { name: 'Top Values', rows: topRows },
    ]);
    
    const baseName = args.originalName?.split('.')[0] || 'output';
    const filename = generateFilename(`${baseName}_stats`, extension);
    await db.recordFile(filename, args.originalName || '', mime, outBuffer.byteLength, 'stats', '');

    return createDownloadResponse(outBuffer, filename, mime);
  }

  return {
    success: true,
    totalRows: sheet.rows.length,
    totalColumns: sheet.columns.length,
    stats,
  };
}

// ─── Tool: sort ──────────────────────────────────────────────────────────────
async function toolSort(
  args: { fileId?: string; column?: string; order?: string; originalName?: string },
  db: Database
) {
  const { fileId, column } = args;
  const order = args.order === 'desc' ? 'desc' : 'asc';
  if (!fileId || !column) return { error: 'File and column are required' };

  const buffer = getFileBuffer(fileId);
  if (!buffer) return { error: 'File not found' };

  const sheets = readBufferToRows(buffer, args.originalName || 'file.xlsx');
  if (sheets.length === 0 || sheets[0].rows.length === 0) return { error: 'File is empty' };
  
  const sheet = sheets[0];
  if (!sheet.columns.includes(column)) return { error: `Column '${column}' not found` };

  const ascending = order === 'asc';
  const hasNums = sheet.rows.some((r) => isNumeric(r[column]));
  const rows = [...sheet.rows];
  rows.sort((a, b) => {
    const va = a[column] ?? '';
    const vb = b[column] ?? '';
    if (va === '' && vb === '') return 0;
    if (va === '') return 1;
    if (vb === '') return -1;
    if (hasNums) {
      const na = toNum(va);
      const nb = toNum(vb);
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return ascending ? na - nb : nb - na;
    }
    return ascending ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
  });

  const { buffer: outBuffer, mime, extension } = saveRowsToBuffer(rows);
  const baseName = args.originalName?.split('.')[0] || 'output';
  const filename = generateFilename(`${baseName}_sorted`, extension);

  await db.recordFile(filename, args.originalName || '', mime, outBuffer.byteLength, 'sort', '');

  return createDownloadResponse(outBuffer, filename, mime);
}

// ─── Tool: filter ────────────────────────────────────────────────────────────
async function toolFilter(
  args: { fileId?: string; conditions?: Array<{column: string; operator: string; value?: string}>; combineWith?: string; originalName?: string },
  db: Database
) {
  const fileId = args.fileId;
  const conditions = args.conditions || [];
  const combineWith = args.combineWith === 'OR' ? 'OR' : 'AND';
  if (!fileId) return { error: 'File is required' };
  if (conditions.length === 0) return { error: 'At least one filter condition is required' };

  const buffer = getFileBuffer(fileId);
  if (!buffer) return { error: 'File not found' };

  const sheets = readBufferToRows(buffer, args.originalName || 'file.xlsx');
  if (sheets.length === 0 || sheets[0].rows.length === 0) return { error: 'File is empty' };
  
  const sheet = sheets[0];

  for (const c of conditions) {
    if (!sheet.columns.includes(c.column)) return { error: `Column '${c.column}' not found` };
  }

  const applyCond = (row: Row, cond: {column: string; operator: string; value?: string}): boolean => {
    const cell = String(row[cond.column] ?? '');
    const val = String(cond.value ?? '');
    const op = cond.operator;
    
    if (op === 'equals') return cell === val;
    if (op === 'not_equals') return cell !== val;
    if (op === 'contains') return cell.toLowerCase().includes(val.toLowerCase());
    if (op === 'not_contains') return !cell.toLowerCase().includes(val.toLowerCase());
    if (op === 'starts_with') return cell.toLowerCase().startsWith(val.toLowerCase());
    if (op === 'ends_with') return cell.toLowerCase().endsWith(val.toLowerCase());
    if (op === 'greater_than') return toNum(cell) > toNum(val);
    if (op === 'less_than') return toNum(cell) < toNum(val);
    if (op === 'greater_or_equal') return toNum(cell) >= toNum(val);
    if (op === 'less_or_equal') return toNum(cell) <= toNum(val);
    if (op === 'is_empty') return cell.trim() === '';
    if (op === 'is_not_empty') return cell.trim() !== '';
    return true;
  };

  const filtered = sheet.rows.filter((r) =>
    combineWith === 'OR'
      ? conditions.some((c) => applyCond(r, c))
      : conditions.every((c) => applyCond(r, c)),
  );

  const { buffer: outBuffer, mime, extension } = saveRowsToBuffer(filtered);
  const baseName = args.originalName?.split('.')[0] || 'output';
  const filename = generateFilename(`${baseName}_filtered`, extension);

  await db.recordFile(filename, args.originalName || '', mime, outBuffer.byteLength, 'filter', '');

  return createDownloadResponse(outBuffer, filename, mime);
}

// ─── Tool: replace ───────────────────────────────────────────────────────────
async function toolReplace(
  args: { fileId?: string; find?: string; replace?: string; columns?: string[]; matchMode?: string; caseSensitive?: string; useRegex?: string; originalName?: string },
  db: Database
) {
  const fileId = args.fileId;
  const find = args.find || '';
  const replace = args.replace ?? '';
  const scopeColumns = args.columns || [];
  const matchMode = args.matchMode || 'contains';
  const caseSensitive = args.caseSensitive === 'true';
  const useRegex = args.useRegex === 'true';
  if (!fileId) return { error: 'File is required' };
  if (!find) return { error: 'Find text is required' };

  const buffer = getFileBuffer(fileId);
  if (!buffer) return { error: 'File not found' };

  const sheets = readBufferToRows(buffer, args.originalName || 'file.xlsx');
  if (sheets.length === 0 || sheets[0].rows.length === 0) return { error: 'File is empty' };
  
  const sheet = sheets[0];
  const targetColumns = scopeColumns.filter((c) => sheet.columns.includes(c));
  const finalCols = targetColumns.length > 0 ? targetColumns : sheet.columns;

  let pattern: RegExp;
  try {
    const flags = caseSensitive ? 'g' : 'gi';
    if (useRegex) {
      pattern = new RegExp(find, flags);
    } else {
      const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      let body = escaped;
      if (matchMode === 'exact') body = `^${escaped}$`;
      else if (matchMode === 'startsWith') body = `^${escaped}`;
      else if (matchMode === 'endsWith') body = `${escaped}$`;
      pattern = new RegExp(body, flags);
    }
  } catch {
    return { error: 'Invalid regex pattern' };
  }

  let totalMatches = 0;
  let cellsChanged = 0;
  const rowsAffected = new Set<number>();
  const changes: Array<{ row: number; column: string; before: string; after: string }> = [];

  const rows = sheet.rows.map((r) => ({ ...r }));
  for (let i = 0; i < rows.length; i++) {
    for (const col of finalCols) {
      const original = String(rows[i][col] ?? '');
      const globalPattern = new RegExp(pattern.source, pattern.flags);
      const matches = original.match(globalPattern);
      if (matches && matches.length > 0) {
        const newVal = original.replace(globalPattern, replace);
        if (newVal !== original) {
          totalMatches += matches.length;
          cellsChanged += 1;
          rowsAffected.add(i);
          rows[i][col] = newVal;
          if (changes.length < 50) {
            changes.push({
              row: i + 1,
              column: col,
              before: original.slice(0, 80),
              after: newVal.slice(0, 80),
            });
          }
        }
      }
    }
  }

  const { buffer: outBuffer, mime, extension } = saveRowsToBuffer(rows);
  const baseName = args.originalName?.split('.')[0] || 'output';
  const filename = generateFilename(`${baseName}_replaced`, extension);

  await db.recordFile(filename, args.originalName || '', mime, outBuffer.byteLength, 'replace', '');

  return createDownloadResponse(outBuffer, filename, mime);
}

// ─── Tool: transpose ─────────────────────────────────────────────────────────
async function toolTranspose(
  args: { fileId?: string; mode?: string; idColumns?: string[]; varName?: string; valueName?: string; originalName?: string },
  db: Database
) {
  const fileId = args.fileId;
  const mode = args.mode === 'unpivot' ? 'unpivot' : 'transpose';
  const idColumns = args.idColumns || [];
  const varName = args.varName || 'variable';
  const valueName = args.valueName || 'value';
  if (!fileId) return { error: 'File is required' };

  const buffer = getFileBuffer(fileId);
  if (!buffer) return { error: 'File not found' };

  const sheets = readBufferToRows(buffer, args.originalName || 'file.xlsx');
  if (sheets.length === 0 || sheets[0].rows.length === 0) return { error: 'File is empty' };
  
  const sheet = sheets[0];
  const columns = sheet.columns;

  let resultRows: Row[] = [];
  let outputColumns: string[] = [];

  if (mode === 'transpose') {
    const newCols = ['Column', ...sheet.rows.map((_, i) => `Row ${i + 1}`)];
    outputColumns = newCols;
    for (const col of columns) {
      const row: Row = { Column: col };
      for (let i = 0; i < sheet.rows.length; i++) {
        row[`Row ${i + 1}`] = String(sheet.rows[i][col] ?? '');
      }
      resultRows.push(row);
    }
  } else {
    if (idColumns.length === 0) return { error: 'Select at least one ID column for unpivot' };
    const valueCols = columns.filter((c) => !idColumns.includes(c));
    if (valueCols.length === 0) return { error: 'No value columns to unpivot' };
    outputColumns = [...idColumns, varName, valueName];
    for (const r of sheet.rows) {
      for (const vc of valueCols) {
        const out: Row = {};
        for (const idc of idColumns) out[idc] = r[idc] ?? '';
        out[varName] = vc;
        out[valueName] = String(r[vc] ?? '');
        resultRows.push(out);
      }
    }
  }

  const { buffer: outBuffer, mime, extension } = saveRowsToBuffer(resultRows);
  const baseName = args.originalName?.split('.')[0] || 'output';
  const suffix = mode === 'transpose' ? 'transposed' : 'unpivoted';
  const filename = generateFilename(`${baseName}_${suffix}`, extension);

  await db.recordFile(filename, args.originalName || '', mime, outBuffer.byteLength, 'transpose', '');

  return createDownloadResponse(outBuffer, filename, mime);
}

// ─── Tool: pivot ─────────────────────────────────────────────────────────────
async function toolPivot(
  args: { fileId?: string; groupBy?: string[]; aggregations?: Array<{column: string; function: string; alias?: string}>; originalName?: string },
  db: Database
) {
  const fileId = args.fileId;
  const groupBy = args.groupBy || [];
  const aggregations = args.aggregations || [];
  if (!fileId) return { error: 'File is required' };
  if (groupBy.length === 0) return { error: 'Select at least one column to group by' };
  if (aggregations.length === 0) return { error: 'Add at least one aggregation' };

  const buffer = getFileBuffer(fileId);
  if (!buffer) return { error: 'File not found' };

  const sheets = readBufferToRows(buffer, args.originalName || 'file.xlsx');
  if (sheets.length === 0 || sheets[0].rows.length === 0) return { error: 'File is empty' };
  
  const sheet = sheets[0];

  for (const c of groupBy) {
    if (!sheet.columns.includes(c)) return { error: `Group-by column '${c}' not found` };
  }
  for (const a of aggregations) {
    if (a.function !== 'count' && !sheet.columns.includes(a.column))
      return { error: `Aggregation column '${a.column}' not found` };
  }

  // Group rows by composite key
  const groups = new Map<string, Row[]>();
  const groupKeyOrder: string[] = [];
  for (const r of sheet.rows) {
    const key = groupBy.map((c) => String(r[c] ?? '')).join('\u0000');
    if (!groups.has(key)) {
      groups.set(key, []);
      groupKeyOrder.push(key);
    }
    groups.get(key)!.push(r);
  }

  const aggFns: Record<string, (vals: number[]) => number> = {
    sum: (v) => v.reduce((a, b) => a + b, 0),
    avg: (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0),
    count: (v) => v.length,
    min: (v) => (v.length ? Math.min(...v) : 0),
    max: (v) => (v.length ? Math.max(...v) : 0),
    first: (v) => (v.length ? v[0] : 0),
    last: (v) => (v.length ? v[v.length - 1] : 0),
  };

  const resultRows: Row[] = [];
  for (const key of groupKeyOrder) {
    const groupRows = groups.get(key)!;
    const keyParts = key.split('\u0000');
    const out: Row = {};
    for (let i = 0; i < groupBy.length; i++) out[groupBy[i]] = keyParts[i];
    for (const a of aggregations) {
      const alias = a.alias || `${a.column}_${a.function}`;
      const fn = aggFns[a.function] || aggFns.count;
      if (a.function === 'count') {
        out[alias] = String(fn(groupRows.map(() => 1)));
      } else if (a.function === 'count_distinct') {
        const distinctValues = new Set(groupRows.map((r) => String(r[a.column] ?? '')));
        out[alias] = String(distinctValues.size);
      } else {
        const vals = groupRows
          .map((r) => toNum(r[a.column]))
          .filter((n) => !Number.isNaN(n));
        const result = fn(vals);
        out[alias] = a.function === 'sum' || a.function === 'avg'
          ? String(round(result))
          : String(result);
      }
    }
    resultRows.push(out);
  }

  // Sort by first group-by column
  const firstCol = groupBy[0];
  const hasNums = resultRows.some((r) => isNumeric(r[firstCol]));
  resultRows.sort((a, b) => {
    if (hasNums) return toNum(a[firstCol]) - toNum(b[firstCol]);
    return String(a[firstCol]).localeCompare(String(b[firstCol]));
  });

  const { buffer: outBuffer, mime, extension } = saveRowsToBuffer(resultRows);
  const baseName = args.originalName?.split('.')[0] || 'output';
  const filename = generateFilename(`${baseName}_pivot`, extension);

  await db.recordFile(filename, args.originalName || '', mime, outBuffer.byteLength, 'pivot', '');

  return createDownloadResponse(outBuffer, filename, mime);
}

// ─── Tool: validate ──────────────────────────────────────────────────────────
async function toolValidate(
  args: { fileId?: string; checks?: string[]; primaryKey?: string; emailColumns?: string[]; urlColumns?: string[]; dateColumns?: string[]; originalName?: string },
  db: Database
) {
  const fileId = args.fileId;
  if (!fileId) return { error: 'File is required' };

  const buffer = getFileBuffer(fileId);
  if (!buffer) return { error: 'File not found' };

  const sheets = readBufferToRows(buffer, args.originalName || 'file.xlsx');
  if (sheets.length === 0 || sheets[0].rows.length === 0) return { error: 'File is empty' };
  
  const sheet = sheets[0];

  const checks = args.checks || [
    'empty_cells', 'mixed_types', 'duplicate_keys', 'email_format',
    'url_format', 'date_format', 'constant_columns', 'whitespace',
    'outliers',
  ];
  const primaryKey = args.primaryKey || '';
  const emailCols = args.emailColumns || [];
  const urlCols = args.urlColumns || [];
  const dateCols = args.dateColumns || [];

  const issues: Array<{
    row: number; column: string; value: string; message: string; severity: string;
  }> = [];
  const columnReports: Record<string, unknown>[] = [];

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const urlRe = /^(https?:\/\/|www\.)[^\s]+$/i;
  const dateRe = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?Z?)?$/;

  for (const col of sheet.columns) {
    const values = sheet.rows.map((r) => r[col]);
    const nonEmpty = values.filter((v) => v != null && v !== '');
    const emptyCells = values.length - nonEmpty.length;
    const whitespaceOnly = values.filter(
      (v) => typeof v === 'string' && v !== '' && v.trim() === '',
    ).length;
    const uniqueSet = new Set(nonEmpty.map((v) => String(v)));

    const nums = nonEmpty.filter((v) => isNumeric(v)).length;
    const texts = nonEmpty.length - nums;
    let detectedType: string;
    if (nonEmpty.length === 0) detectedType = 'empty';
    else if (nums === nonEmpty.length) detectedType = 'number';
    else if (texts === nonEmpty.length) detectedType = 'text';
    else detectedType = 'mixed';
    const isConstant = nonEmpty.length > 0 && uniqueSet.size === 1;

    const report: Record<string, unknown> = {
      column: col,
      totalCells: values.length,
      emptyCells,
      whitespaceOnly,
      uniqueValues: uniqueSet.size,
      detectedType,
      isConstant,
    };

    if (detectedType === 'number' && nonEmpty.length > 0) {
      const numVals = nonEmpty.map(toNum);
      report.min = Math.min(...numVals);
      report.max = Math.max(...numVals);
      report.mean = round(mean(numVals));
    } else if (nonEmpty.length > 0) {
      const strVals = nonEmpty.map(String);
      report.min = strVals.reduce((a, b) => (a < b ? a : b));
      report.max = strVals.reduce((a, b) => (a > b ? a : b));
    }
    columnReports.push(report);

    if (checks.includes('empty_cells')) {
      for (let i = 0; i < values.length; i++) {
        if (values[i] == null || values[i] === '') {
          issues.push({
            row: i + 1, column: col, value: '',
            message: 'Empty cell', severity: 'info',
          });
        }
      }
    }
    if (checks.includes('whitespace')) {
      for (let i = 0; i < values.length; i++) {
        const v = String(values[i] ?? '');
        if (v !== '' && v.trim() === '') {
          issues.push({
            row: i + 1, column: col, value: v,
            message: 'Whitespace-only cell', severity: 'warning',
          });
        }
      }
    }
    if (checks.includes('constant_columns') && isConstant) {
      issues.push({
        row: 0, column: col, value: String(nonEmpty[0]),
        message: `Column is constant — every non-empty cell is "${nonEmpty[0]}"`,
        severity: 'info',
      });
    }
    if (checks.includes('outliers') && detectedType === 'number') {
      const numVals = nonEmpty.map(toNum);
      const q1 = quantile(numVals, 0.25);
      const q3 = quantile(numVals, 0.75);
      const iqr = q3 - q1;
      if (iqr > 0) {
        const lower = q1 - 1.5 * iqr;
        const upper = q3 + 1.5 * iqr;
        for (let i = 0; i < values.length; i++) {
          const n = toNum(values[i]);
          if (!Number.isNaN(n) && (n < lower || n > upper)) {
            issues.push({
              row: i + 1, column: col, value: String(values[i]),
              message: `Outlier detected (${n})`, severity: 'warning',
            });
          }
        }
      }
    }
    if (checks.includes('email_format') && emailCols.includes(col)) {
      for (let i = 0; i < values.length; i++) {
        const v = String(values[i] ?? '');
        if (v && !emailRe.test(v)) {
          issues.push({
            row: i + 1, column: col, value: v,
            message: 'Invalid email format', severity: 'error',
          });
        }
      }
    }
    if (checks.includes('url_format') && urlCols.includes(col)) {
      for (let i = 0; i < values.length; i++) {
        const v = String(values[i] ?? '');
        if (v && !urlRe.test(v)) {
          issues.push({
            row: i + 1, column: col, value: v,
            message: 'Invalid URL format', severity: 'error',
          });
        }
      }
    }
    if (checks.includes('date_format') && dateCols.includes(col)) {
      for (let i = 0; i < values.length; i++) {
        const v = String(values[i] ?? '');
        if (v && !dateRe.test(v)) {
          issues.push({
            row: i + 1, column: col, value: v,
            message: 'Invalid date format', severity: 'error',
          });
        }
      }
    }
  }

  if (checks.includes('duplicate_keys') && primaryKey && sheet.columns.includes(primaryKey)) {
    const seen = new Map<string, number[]>();
    for (let i = 0; i < sheet.rows.length; i++) {
      const v = String(sheet.rows[i][primaryKey] ?? '').trim();
      if (v === '') continue;
      if (!seen.has(v)) seen.set(v, []);
      seen.get(v)!.push(i + 1);
    }
    for (const [v, rows] of seen.entries()) {
      if (rows.length > 1) {
        issues.push({
          row: rows[0], column: primaryKey, value: v,
          message: `Duplicate primary key "${v}" appears in rows: ${rows.join(', ')}`,
          severity: 'error',
        });
      }
    }
  }

  const totalCells = sheet.rows.length * sheet.columns.length;
  const summary = {
    totalRows: sheet.rows.length,
    totalColumns: sheet.columns.length,
    totalCells,
    emptyCells: columnReports.reduce((a: number, r: Record<string, unknown>) => a + Number(r.emptyCells || 0), 0),
    uniqueIssues: issues.length,
    errors: issues.filter((i) => i.severity === 'error').length,
    warnings: issues.filter((i) => i.severity === 'warning').length,
    infos: issues.filter((i) => i.severity === 'info').length,
    constantColumns: columnReports.filter((r: Record<string, unknown>) => r.isConstant).length,
    mixedTypeColumns: columnReports.filter((r: Record<string, unknown>) => r.detectedType === 'mixed').length,
  };
  const overallScore = Math.max(
    0,
    Math.round(
      100 -
        ((summary.errors * 5 + summary.warnings * 2 + summary.infos * 0.5) /
          Math.max(1, totalCells)) *
          100,
    ),
  );

  // Generate validation report
  const summaryRows: Row[] = [
    ...Object.entries(summary).map(([k, v]) => ({ Metric: k, Value: String(v) })),
    { Metric: 'Quality Score', Value: `${overallScore}/100` },
  ];
  const colData: Row[] = columnReports.map((r: Record<string, unknown>) => ({
    Column: String(r.column),
    Type: String(r.detectedType),
    'Total Cells': String(r.totalCells),
    'Empty Cells': String(r.emptyCells),
    'Whitespace-only': String(r.whitespaceOnly),
    'Unique Values': String(r.uniqueValues),
    Constant: r.isConstant ? 'Yes' : 'No',
    Min: r.min != null ? String(r.min) : '',
    Max: r.max != null ? String(r.max) : '',
    Mean: r.mean != null ? String(r.mean) : '',
  }));
  const issueData: Row[] = issues.slice(0, 1000).map((i) => ({
    Row: String(i.row),
    Column: i.column,
    Value: String(i.value),
    Severity: i.severity,
    Message: i.message,
  }));
  
  const { buffer: outBuffer, mime, extension } = saveSheetsToBuffer([
    { name: 'Summary', rows: summaryRows },
    { name: 'Columns', rows: colData },
    { name: 'Issues', rows: issueData },
  ]);
  
  const baseName = args.originalName?.split('.')[0] || 'output';
  const filename = generateFilename(`${baseName}_validation`, extension);
  await db.recordFile(filename, args.originalName || '', mime, outBuffer.byteLength, 'validate', '');

  return createDownloadResponse(outBuffer, filename, mime);
}

// ─── Tool: attendance ────────────────────────────────────────────────────────
async function toolAttendance(args: {
  fileId?: string;
  column?: string;
  rollNumber?: string;
  originalName?: string;
}) {
  const { fileId, column, rollNumber } = args;
  if (!fileId || !column || !rollNumber) return { error: 'File, column, and roll number are required' };

  const buffer = getFileBuffer(fileId);
  if (!buffer) return { error: 'File not found' };

  const sheets = readBufferToRows(buffer, args.originalName || 'file.xlsx');
  if (sheets.length === 0 || sheets[0].rows.length === 0) return { error: 'File is empty' };
  
  const sheet = sheets[0];
  if (!sheet.columns.includes(column)) return { error: `Column '${column}' not found` };

  const studentRows = sheet.rows.filter(
    (r) => String(r[column] ?? '').trim() === rollNumber.trim(),
  );
  if (studentRows.length === 0) return { error: `No records found for roll number: ${rollNumber}` };

  const classColumns = sheet.columns.filter((c) => c !== column);
  if (classColumns.length > 0) {
    const student = studentRows[0];
    const total = classColumns.length;
    let present = 0;
    const details: { class: string; status: string }[] = [];
    for (const col of classColumns) {
      const val = String(student[col] ?? '').trim().toLowerCase();
      const isPresent = ['present', 'p', '1', 'yes', 'true'].includes(val);
      if (isPresent) present += 1;
      details.push({ class: col, status: String(student[col] ?? 'N/A') });
    }
    return {
      success: true,
      report: {
        rollNumber,
        totalClasses: total,
        presentCount: present,
        absentCount: total - present,
        attendancePercentage: total > 0 ? ((present / total) * 100).toFixed(2) : '0.00',
        details,
      },
    };
  }

  // No class columns — count rows
  const totalClasses = sheet.rows.length;
  const presentCount = studentRows.length;
  return {
    success: true,
    report: {
      rollNumber,
      totalClasses,
      presentCount,
      absentCount: totalClasses - presentCount,
      attendancePercentage: totalClasses > 0 ? ((presentCount / totalClasses) * 100).toFixed(2) : '0.00',
    },
  };
}

// ─── Tool: download-excel ────────────────────────────────────────────────────
async function toolDownloadExcel(args: { url?: string; originalName?: string }, db: Database, kv: KVNamespace) {
  const url = args.url || '';
  if (!url) return { error: 'URL is required' };

  try {
    const resp = await fetch(url);
    if (!resp.ok) return { error: `HTTP ${resp.status}: ${resp.statusText}` };
    const buf = await resp.arrayBuffer();

    const urlFilename = decodeURIComponent(url.split('?')[0].split('/').pop() || 'downloaded');
    const ext = urlFilename.split('.').pop() || 'xlsx';
    const stem = urlFilename.split('.').slice(0, -1).join('.') || 'downloaded';
    const filename = generateFilename(stem, ext);

    await db.recordFile(filename, urlFilename, 'application/octet-stream', buf.byteLength, 'download-excel', '');

    const fileId = generateId();
    const b64 = Buffer.from(buf).toString('base64');
    await kv.put(fileId, JSON.stringify({ buffer: b64, name: filename, type: 'application/octet-stream' }), {
      expirationTtl: 300,
    });

    return {
      downloadUrl: `/api/tools/download-file/${fileId}`,
      filename,
      size: buf.byteLength,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Download failed' };
  }
}

// ─── Tool: download-images ───────────────────────────────────────────────────

const CONCURRENCY = 6;

function detectImageFormat(buf: ArrayBuffer): {
  ext: string;
  mimeType: string;
  isSupported: boolean;
} {
  const bytes = new Uint8Array(buf);
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return { ext: 'jpeg', mimeType: 'image/jpeg', isSupported: true };

  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return { ext: 'png', mimeType: 'image/png', isSupported: true };

  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46)
    return { ext: 'gif', mimeType: 'image/gif', isSupported: true };

  if (bytes[0] === 0x42 && bytes[1] === 0x4d)
    return { ext: 'bmp', mimeType: 'image/bmp', isSupported: true };

  // WEBP: RIFF....WEBP
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  )
    return { ext: 'webp', mimeType: 'image/webp', isSupported: true };

  return { ext: 'jpeg', mimeType: 'image/jpeg', isSupported: false };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Bounded-concurrency runner — avoids blowing through Workers subrequest
// limits or hammering the target host with 100+ simultaneous fetches.
async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function runNext(): Promise<void> {
    while (cursor < items.length) {
      const current = cursor++;
      results[current] = await worker(items[current], current);
    }
  }

  const workerCount = Math.min(limit, items.length) || 0;
  const workers = Array.from({ length: workerCount }, () => runNext());
  await Promise.all(workers);
  return results;
}

async function downloadOneImage(
  url: string,
  row: number
): Promise<{ row: number; url: string; status: string; error?: string; buffer: ArrayBuffer | null }> {
  if (!url) {
    return { row, url: '', status: 'skipped', buffer: null };
  }

  let currentUrl = url;

  try {
    // Try up to 2 times (first try = original URL, second try = extracted URL)
    for (let attempt = 0; attempt < 2; attempt++) {
      const resp = await fetch(currentUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'X-Requested-With': 'XMLHttpRequest',
        },
        signal: AbortSignal.timeout(30000),
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const buf = await resp.arrayBuffer();
      const contentType = resp.headers.get('content-type') || '';

      const textStart = new TextDecoder().decode(buf.slice(0, 100)).trimStart();
      const isHtml =
        contentType.includes('text/html') ||
        textStart.startsWith('<!DOCTYPE') ||
        textStart.startsWith('<html');

      if (isHtml) {
        if (attempt === 0) {
          const htmlText = new TextDecoder().decode(buf);
          const match =
            htmlText.match(/https?:\/\/[^"'\s]+responses\.storage[^"'\s]+/i) ||
            htmlText.match(/https?:\/\/[^"'\s]+\.(?:jpeg|jpg|png|webp|gif)[^"'\s]*/i);

          if (match && match[0] && match[0] !== currentUrl) {
            currentUrl = match[0];
            continue;
          }
        }
        throw new Error('Server returned HTML page instead of image');
      }

      if (buf.byteLength === 0) throw new Error('Empty response body');

      return { row, url: currentUrl, status: 'success', buffer: buf };
    }

    throw new Error('Failed to download image buffer');
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : 'Failed';
    return { row, url: currentUrl, status: 'failed', error: errMsg, buffer: null };
  }
}

async function toolDownloadImages(
  args: {
    fileId?: string;
    urlColumn?: string;
    originalName?: string;
    selectedColumns?: string[];
  },
  db: Database,
  kv: KVNamespace
) {
  const { fileId, urlColumn, originalName = 'images', selectedColumns } = args;

  if (!fileId) return { error: 'File path is required' };
  if (!urlColumn) return { error: 'URL column is required' };

  const buffer = getFileBuffer(fileId);
  if (!buffer) return { error: 'File not found' };

  const sheets = readBufferToRows(buffer, originalName);
  if (!sheets.length) return { error: 'No sheets found in file' };
  const sheet = sheets[0];

  if (!sheet.columns.includes(urlColumn)) {
    return { error: `Column "${urlColumn}" not found in file` };
  }

  // Download images with bounded concurrency instead of a sequential for-loop
  const urls = sheet.rows.map((r) => (r[urlColumn] || '').trim());
  const downloadResults = await runWithConcurrency(urls, CONCURRENCY, (url, i) =>
    downloadOneImage(url, i + 1)
  );

  // Convert successful buffers into inline base64 <img> sources
  const results: { row: number; url: string; status: string; error?: string }[] = [];
  const imageBase64s: (string | null)[] = [];

  for (const dr of downloadResults) {
    if (!dr.buffer) {
      results.push({ row: dr.row, url: dr.url, status: dr.status, error: dr.error });
      imageBase64s.push(null);
      continue;
    }

    try {
      const { mimeType, isSupported } = detectImageFormat(dr.buffer);

      if (!isSupported) {
        results.push({
          row: dr.row,
          url: dr.url,
          status: 'failed',
          error: 'Unrecognized image format (possibly corrupted)',
        });
        imageBase64s.push(null);
        continue;
      }

      const b64 = Buffer.from(dr.buffer).toString('base64');
      imageBase64s.push(`data:${mimeType};base64,${b64}`);
      results.push({ row: dr.row, url: dr.url, status: 'success' });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : 'Image processing failed';
      results.push({ row: dr.row, url: dr.url, status: 'failed', error: errMsg });
      imageBase64s.push(null);
    }
  }

  // Build HTML table
  let otherColumns = sheet.columns.filter((c) => c !== urlColumn);
  if (selectedColumns && selectedColumns.length > 0) {
    otherColumns = otherColumns.filter((c) => selectedColumns.includes(c));
  }

  const headerCells = ['<th>Image</th>', ...otherColumns.map((c) => `<th>${escapeHtml(c)}</th>`)].join('');

  const bodyRows = sheet.rows.map((row, i) => {
    const imgSrc = imageBase64s[i];
    const imgCell = imgSrc
      ? `<td class="img-cell"><img src="${imgSrc}" /></td>`
      : `<td class="img-cell empty">${results[i]?.error ? 'Error' : '—'}</td>`;

    const dataCells = otherColumns.map((c) => `<td>${escapeHtml(String(row[c] ?? ''))}</td>`).join('');

    return `<tr>${imgCell}${dataCells}</tr>`;
  });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(originalName)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 13px;
      background: #f5f5f5;
      padding: 24px;
      color: #222;
    }
    h1 {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 16px;
      color: #333;
    }
    .meta {
      font-size: 12px;
      color: #888;
      margin-bottom: 16px;
    }
    .table-wrap {
      overflow-x: auto;
      background: #fff;
      border-radius: 8px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.1);
    }
    table {
      border-collapse: collapse;
      width: 100%;
      min-width: 600px;
    }
    thead tr {
      background: #f0f0f0;
    }
    th {
      padding: 10px 14px;
      text-align: left;
      font-weight: 600;
      border-bottom: 2px solid #ddd;
      white-space: nowrap;
    }
    td {
      padding: 8px 14px;
      border-bottom: 1px solid #eee;
      vertical-align: middle;
    }
    td.img-cell {
      width: 220px;
      min-width: 220px;
      text-align: center;
      padding: 8px;
    }
    td.img-cell img {
      max-width: 200px;
      max-height: 200px;
      border-radius: 4px;
      display: block;
      margin: 0 auto;
    }
    td.img-cell.empty {
      color: #bbb;
      font-size: 12px;
    }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #fafafa; }
  </style>
</head>
<body>
  <h1>${escapeHtml(originalName)}</h1>
  <p class="meta">
    ${sheet.rows.length} rows ·
    ${results.filter((r) => r.status === 'success').length} images loaded ·
    Generated ${new Date().toLocaleString()}
  </p>
  <div class="table-wrap">
    <table>
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${bodyRows.join('\n')}</tbody>
    </table>
  </div>
</body>
</html>`;

  const filename = generateFilename('images', 'html');
  const byteLength = new TextEncoder().encode(html).length;

  try {
    await db.recordFile(filename, originalName, 'text/html', byteLength, 'download-images', '');
  } catch (e) {
    console.error('recordFile failed (non-fatal):', e);
  }

  const successCount = results.filter((r) => r.status === 'success').length;
  const failCount = results.filter((r) => r.status === 'failed').length;

  if (failCount > 0) {
    const failedLines = results
      .filter((r) => r.status === 'failed')
      .map((r) => `Row ${r.row}: ${r.url} — ${r.error || 'unknown'}`)
      .join('\n');
    try {
      await db.logError('download-images', `${failCount} of ${sheet.rows.length} images failed`, failedLines);
    } catch (e) {
      console.error('logError failed (non-fatal):', e);
    }
  }

  const kvFileId = generateId();
  const b64 = Buffer.from(html).toString('base64');
  await kv.put(kvFileId, JSON.stringify({ buffer: b64, name: filename, type: 'text/html' }), {
    expirationTtl: 300, // 5 minutes
  });

  return {
    downloadUrl: `/api/tools/download-file/${kvFileId}`,
    filename,
    totalRows: sheet.rows.length,
    successCount,
    failCount,
    results,
  };
}

export { toolDownloadImages };
