import { Hono } from 'hono';
import { Database } from '../lib/db';
import { R2Storage } from '../lib/r2';
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
  R2: R2Bucket;
};

export const toolsRouter = new Hono<{ Bindings: Bindings }>();

// Helper to generate unique filename
function generateFilename(baseName: string, extension: string): string {
  const uid = Math.random().toString(36).slice(2, 10);
  return `${sanitizeFilename(baseName)}_${uid}.${extension}`;
}

// POST handler for all tools
toolsRouter.post('/:tool', async (c) => {
  const toolName = c.req.param('tool');
  const db = new Database(c.env.DB);
  const r2 = new R2Storage(c.env.R2);

  try {
    const contentType = c.req.header('content-type') || '';
    let args: Record<string, unknown> = {};

    if (contentType.includes('multipart/form-data')) {
      const formData = await c.req.formData();
      
      for (const [key, value] of formData.entries()) {
        if (value instanceof File) {
          const buffer = await value.arrayBuffer();
          const filename = generateFilename(value.name.split('.')[0], value.name.split('.').pop() || 'xlsx');
          
          // Upload to R2
          await r2.upload(`uploads/${filename}`, buffer, value.type);
          
          if (key === 'files') {
            if (!args.files) args.files = [];
            (args.files as string[]).push(`uploads/${filename}`);
          } else if (key === 'file') {
            args.filepath = `uploads/${filename}`;
            args.originalName = value.name;
          }
        } else {
          let parsedValue: unknown = value;
          if (typeof value === 'string' && (value.startsWith('[') || value.startsWith('{'))) {
            try { parsedValue = JSON.parse(value); } catch {}
          }
          args[key] = parsedValue;
        }
      }

      // Merge tool: ensure files array
      if (toolName === 'merge' && Array.isArray(args.files) && args.files.length >= 2) {
        // files array is already set
      }
    } else if (contentType.includes('application/json')) {
      const body = await c.req.json();
      args = { ...body };
    } else {
      return c.json({ error: 'Unsupported content type' }, 400);
    }

    const result = await dispatchTool(toolName, args, r2, db);
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[POST /api/tools/${toolName}]`, error);
    await db.logError(toolName, message, error instanceof Error ? (error.stack || '') : '');
    return c.json({ error: message }, 500);
  }
});

// GET handler
toolsRouter.get('/:tool', async (c) => {
  const toolName = c.req.param('tool');
  const db = new Database(c.env.DB);
  const r2 = new R2Storage(c.env.R2);
  const url = new URL(c.req.url);

  try {
    if (toolName === 'download') {
      const filename = url.searchParams.get('file');
      if (!filename) {
        return c.json({ error: 'Filename is required' }, 400);
      }
      
      const safeName = filename.split('/').pop() || filename;
      const file = await r2.download(`processed/${safeName}`);
      
      if (!file) {
        return c.json({ error: 'File not found' }, 404);
      }

      const ext = safeName.split('.').pop()?.toLowerCase() || '';
      let contentType = 'application/octet-stream';
      if (ext === 'xlsx') {
        contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      } else if (ext === 'csv') {
        contentType = 'text/csv';
      } else if (ext === 'html') {
        contentType = 'text/html';
      }

      return new Response(file.body, {
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="${safeName}"`,
        },
      });
    } else if (toolName === 'history') {
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
  r2: R2Storage,
  db: Database
): Promise<unknown> {
  switch (tool) {
    case 'merge':
      return toolMerge(args, r2, db);
    case 'columns':
      return toolColumns(args, r2);
    case 'duplicates':
      return toolDuplicates(args, r2, db);
    case 'convert':
      return toolConvert(args, r2, db);
    case 'stats':
      return toolStats(args, r2, db);
    case 'sort':
      return toolSort(args, r2, db);
    case 'filter':
      return toolFilter(args, r2, db);
    case 'replace':
      return toolReplace(args, r2, db);
    case 'transpose':
      return toolTranspose(args, r2, db);
    case 'pivot':
      return toolPivot(args, r2, db);
    case 'validate':
      return toolValidate(args, r2, db);
    case 'attendance':
      return toolAttendance(args, r2);
    case 'preview':
      return toolPreview(args, r2);
    case 'download-excel':
      return toolDownloadExcel(args, r2, db);
    case 'download-images':
      return toolDownloadImages(args, r2, db);
    default:
      return { error: `Unknown tool: ${tool}` };
  }
}

// Tool implementations

async function toolMerge(
  args: { files?: string[]; outputFormat?: string; outputFilename?: string; originalName?: string },
  r2: R2Storage,
  db: Database
) {
  const files = args.files || [];
  const outputFormat = (args.outputFormat as 'xlsx' | 'csv') || 'xlsx';
  const outputFilename = args.outputFilename || 'merged';

  if (files.length < 2) return { error: 'At least 2 files are required' };

  const allSheets: Sheet[] = [];
  const allHeaders: string[][] = [];

  for (const f of files) {
    const file = await r2.download(f);
    if (!file) continue;
    const buffer = await file.arrayBuffer();
    const sheets = readBufferToRows(buffer, f);
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
  await r2.upload(`processed/${filename}`, buffer, mime);
  await db.recordFile(filename, `${outputFilename}.${extension}`, mime, buffer.byteLength, 'merge', `processed/${filename}`);

  return {
    success: true,
    downloadUrl: `/api/tools/download?file=${filename}`,
    filename,
    totalRows: mergedRows.length,
    headers: allCols,
    hasMismatch,
    mismatchWarning: hasMismatch
      ? 'Some files have different headers. Data was merged using all available columns.'
      : null,
  };
}

async function toolColumns(args: { filepath?: string; originalName?: string }, r2: R2Storage) {
  const filepath = args.filepath;
  if (!filepath) return { error: 'File path is required' };

  const file = await r2.download(filepath);
  if (!file) return { error: 'File not found' };

  const buffer = await file.arrayBuffer();
  const sheets = readBufferToRows(buffer, filepath);
  const result = sheets.map((s) => ({
    name: s.name,
    columns: s.columns,
    rowCount: s.rows.length,
  }));
  const preview = sheets.length > 0 ? rowsToDicts(sheets[0].rows.slice(0, 5)) : [];
  return { success: true, sheets: result, preview };
}

async function toolDuplicates(
  args: { filepath?: string; column?: string; keepOccurrence?: string; originalName?: string },
  r2: R2Storage,
  db: Database
) {
  const { filepath, column } = args;
  const keep = args.keepOccurrence === 'last' ? 'last' : 'first';
  if (!filepath || !column) return { error: 'File and column are required' };

  const file = await r2.download(filepath);
  if (!file) return { error: 'File not found' };

  const buffer = await file.arrayBuffer();
  const sheets = readBufferToRows(buffer, filepath);
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

  const baseName = filepath.split('/').pop()?.split('.')[0] || 'output';
  const { buffer: outBuffer, mime, extension } = saveRowsToBuffer(remainingRows);
  const filename = generateFilename(`${baseName}_cleaned`, extension);
  await r2.upload(`processed/${filename}`, outBuffer, mime);
  await db.recordFile(filename, args.originalName || '', mime, outBuffer.byteLength, 'duplicates', `processed/${filename}`);

  return {
    success: true,
    downloadUrl: `/api/tools/download?file=${filename}`,
    filename,
    totalRows: sheet.rows.length,
    duplicateRows: deletedRows.length,
    remainingRows: remainingRows.length,
    preview: {
      deleted: rowsToDicts(deletedRows.slice(0, 10)),
      remaining: rowsToDicts(remainingRows.slice(0, 5)),
    },
  };
}

async function toolConvert(
  args: { filepath?: string; targetFormat?: string; delimiter?: string; sheetName?: string; originalName?: string },
  r2: R2Storage,
  db: Database
) {
  const filepath = args.filepath;
  const targetFormat = (args.targetFormat as 'xlsx' | 'csv') || 'xlsx';
  const delimiter = args.delimiter || ',';
  if (!filepath) return { error: 'File is required' };

  const file = await r2.download(filepath);
  if (!file) return { error: 'File not found' };

  const buffer = await file.arrayBuffer();
  const sheets = readBufferToRows(buffer, filepath, delimiter);
  if (sheets.length === 0) return { error: 'File has no sheets' };

  const sheetNames = sheets.map((s) => s.name);
  let targetSheet: Sheet;
  if (args.sheetName && sheetNames.includes(args.sheetName)) {
    targetSheet = sheets.find((s) => s.name === args.sheetName)!;
  } else {
    targetSheet = sheets[0];
  }

  const baseName = filepath.split('/').pop()?.split('.')[0] || 'output';
  const { buffer: outBuffer, mime, extension } = saveRowsToBuffer(targetSheet.rows, targetFormat, delimiter);
  const filename = generateFilename(baseName, extension);
  await r2.upload(`processed/${filename}`, outBuffer, mime);
  await db.recordFile(filename, args.originalName || '', mime, outBuffer.byteLength, 'convert', `processed/${filename}`);

  return {
    success: true,
    downloadUrl: `/api/tools/download?file=${filename}`,
    filename,
    sheets: sheetNames,
  };
}

async function toolStats(
  args: { filepath?: string; generateReport?: string; originalName?: string },
  r2: R2Storage,
  db: Database
) {
  const filepath = args.filepath;
  const generateReport = args.generateReport === 'true';
  if (!filepath) return { error: 'File is required' };

  const file = await r2.download(filepath);
  if (!file) return { error: 'File not found' };

  const buffer = await file.arrayBuffer();
  const sheets = readBufferToRows(buffer, filepath);
  if (sheets.length === 0 || sheets[0].rows.length === 0) return { error: 'File is empty' };
  
  const sheet = sheets[0];
  const stats = [];
  
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

  let downloadUrl: string | null = null;
  let reportFilename: string | null = null;
  
  if (generateReport) {
    const baseName = filepath.split('/').pop()?.split('.')[0] || 'output';
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
          'Percent of Filled': s.count > 0 ? `${((tv.count / Number(s.count)) * 100).toFixed(1)}%` : '0.0%',
        });
      }
    }
    
    const { buffer: outBuffer, mime, extension } = saveSheetsToFile([
      { name: 'Summary', rows: summaryRows },
      { name: 'Top Values', rows: topRows },
    ]);
    
    reportFilename = generateFilename(`${baseName}_stats`, extension);
    await r2.upload(`processed/${reportFilename}`, outBuffer, mime);
    await db.recordFile(reportFilename, args.originalName || '', mime, outBuffer.byteLength, 'stats', `processed/${reportFilename}`);
    downloadUrl = `/api/tools/download?file=${reportFilename}`;
  }

  return {
    success: true,
    totalRows: sheet.rows.length,
    totalColumns: sheet.columns.length,
    stats,
    downloadUrl,
    filename: reportFilename,
  };
}

async function toolSort(
  args: { filepath?: string; column?: string; order?: string; originalName?: string },
  r2: R2Storage,
  db: Database
) {
  const { filepath, column } = args;
  const order = args.order === 'desc' ? 'desc' : 'asc';
  if (!filepath || !column) return { error: 'File and column are required' };

  const file = await r2.download(filepath);
  if (!file) return { error: 'File not found' };

  const buffer = await file.arrayBuffer();
  const sheets = readBufferToRows(buffer, filepath);
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

  const baseName = filepath.split('/').pop()?.split('.')[0] || 'output';
  const { buffer: outBuffer, mime, extension } = saveRowsToBuffer(rows);
  const filename = generateFilename(`${baseName}_sorted`, extension);
  await r2.upload(`processed/${filename}`, outBuffer, mime);
  await db.recordFile(filename, args.originalName || '', mime, outBuffer.byteLength, 'sort', `processed/${filename}`);

  return {
    success: true,
    downloadUrl: `/api/tools/download?file=${filename}`,
    filename,
    totalRows: rows.length,
    sortedBy: column,
    order,
    preview: rowsToDicts(rows.slice(0, 10)),
  };
}

// ... (remaining tool implementations follow the same pattern)
// For brevity, I'll add the most commonly used ones

async function toolFilter(
  args: { filepath?: string; conditions?: Array<{column: string; operator: string; value?: string}>; combineWith?: string; originalName?: string },
  r2: R2Storage,
  db: Database
) {
  const filepath = args.filepath;
  const conditions = args.conditions || [];
  const combineWith = args.combineWith === 'OR' ? 'OR' : 'AND';
  if (!filepath) return { error: 'File is required' };
  if (conditions.length === 0) return { error: 'At least one filter condition is required' };

  const file = await r2.download(filepath);
  if (!file) return { error: 'File not found' };

  const buffer = await file.arrayBuffer();
  const sheets = readBufferToRows(buffer, filepath);
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

  const baseName = filepath.split('/').pop()?.split('.')[0] || 'output';
  const { buffer: outBuffer, mime, extension } = saveRowsToBuffer(filtered);
  const filename = generateFilename(`${baseName}_filtered`, extension);
  await r2.upload(`processed/${filename}`, outBuffer, mime);
  await db.recordFile(filename, args.originalName || '', mime, outBuffer.byteLength, 'filter', `processed/${filename}`);

  return {
    success: true,
    downloadUrl: `/api/tools/download?file=${filename}`,
    filename,
    totalRows: sheet.rows.length,
    matchedRows: filtered.length,
    removedRows: sheet.rows.length - filtered.length,
    conditions,
    combineWith,
    preview: rowsToDicts(filtered.slice(0, 10)),
  };
}

async function toolReplace(
  args: { filepath?: string; find?: string; replace?: string; columns?: string[]; matchMode?: string; caseSensitive?: string; useRegex?: string; originalName?: string },
  r2: R2Storage,
  db: Database
) {
  const filepath = args.filepath;
  const find = args.find || '';
  const replace = args.replace ?? '';
  const scopeColumns = args.columns || [];
  const matchMode = args.matchMode || 'contains';
  const caseSensitive = args.caseSensitive === 'true';
  const useRegex = args.useRegex === 'true';
  if (!filepath) return { error: 'File is required' };
  if (!find) return { error: 'Find text is required' };

  const file = await r2.download(filepath);
  if (!file) return { error: 'File not found' };

  const buffer = await file.arrayBuffer();
  const sheets = readBufferToRows(buffer, filepath);
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

  const baseName = filepath.split('/').pop()?.split('.')[0] || 'output';
  const { buffer: outBuffer, mime, extension } = saveRowsToBuffer(rows);
  const filename = generateFilename(`${baseName}_replaced`, extension);
  await r2.upload(`processed/${filename}`, outBuffer, mime);
  await db.recordFile(filename, args.originalName || '', mime, outBuffer.byteLength, 'replace', `processed/${filename}`);

  return {
    success: true,
    downloadUrl: `/api/tools/download?file=${filename}`,
    filename,
    totalRows: rows.length,
    scopedColumns: finalCols,
    matchMode: useRegex ? 'regex' : matchMode,
    caseSensitive,
    totalMatches,
    cellsChanged,
    rowsAffected: rowsAffected.size,
    changes,
    preview: rowsToDicts(rows.slice(0, 10)),
  };
}

// Additional tool implementations would follow the same pattern
// For now, let's add stubs for the remaining tools

async function toolTranspose(args: Record<string, unknown>, r2: R2Storage, db: Database) {
  // Implementation similar to original but using R2
  return { error: 'Not implemented yet' };
}

async function toolPivot(args: Record<string, unknown>, r2: R2Storage, db: Database) {
  return { error: 'Not implemented yet' };
}

async function toolValidate(args: Record<string, unknown>, r2: R2Storage, db: Database) {
  return { error: 'Not implemented yet' };
}

async function toolAttendance(args: Record<string, unknown>, r2: R2Storage) {
  return { error: 'Not implemented yet' };
}

async function toolPreview(args: { file?: string; rows?: number }, r2: R2Storage) {
  const filename = args.file || '';
  const rows = args.rows || 50;
  if (!filename) return { error: 'Filename is required' };

  const file = await r2.download(`processed/${filename}`);
  if (!file) return { error: 'File not found' };

  const buffer = await file.arrayBuffer();
  const sheets = readBufferToRows(buffer, filename);
  const sheet = sheets[0] || { name: 'Sheet1', columns: [], rows: [] };
  return {
    success: true,
    sheetName: sheet.name,
    totalRows: sheet.rows.length,
    columns: sheet.columns,
    data: rowsToDicts(sheet.rows.slice(0, rows)),
  };
}

async function toolDownloadExcel(args: { url?: string; originalName?: string }, r2: R2Storage, db: Database) {
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
    
    await r2.upload(`processed/${filename}`, buf, 'application/octet-stream');
    await db.recordFile(filename, urlFilename, 'application/octet-stream', buf.byteLength, 'download-excel', `processed/${filename}`);
    
    return {
      success: true,
      downloadUrl: `/api/tools/download?file=${filename}`,
      filename,
      size: buf.byteLength,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Download failed' };
  }
}

async function toolDownloadImages(args: Record<string, unknown>, r2: R2Storage, db: Database) {
  return { error: 'Not implemented yet - requires sharp which may not work in Workers' };
}
