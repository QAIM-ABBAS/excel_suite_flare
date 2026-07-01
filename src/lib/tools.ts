/**
 * Pure TypeScript tool implementations for Excel Automation Suite.
 * No Python dependency — uses SheetJS + PapaParse + Prisma.
 */

import path from "path";
import { promises as fs } from "fs";
import { db } from "@/lib/db";
import {
  type Row,
  type Sheet,
  readFileToRows,
  saveRowsToFile,
  saveSheetsToFile,
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
  DOWNLOAD_DIR,
} from "@/lib/excel";

// ─── DB helpers ──────────────────────────────────────────────────────────────
async function recordFile(
  filename: string,
  originalName: string,
  mime: string,
  size: number,
  tool: string,
  outputPath: string,
) {
  try {
    await db.fileRecord.create({
      data: { filename, originalName, mimeType: mime, size, tool, status: "completed", outputPath },
    });
  } catch (e) {
    console.error("[recordFile]", e);
  }
}

export async function logError(tool: string, message: string, details: string = "") {
  try {
    await db.errorLog.create({ data: { tool, message, details } });
  } catch (e) {
    console.error("[logError]", e);
  }
}

// ─── Tool: merge ─────────────────────────────────────────────────────────────
export async function toolMerge(args: {
  files: string[];
  outputFormat?: string;
  outputFilename?: string;
  originalName?: string;
}) {
  const files = args.files || [];
  const outputFormat = (args.outputFormat as "xlsx" | "csv") || "xlsx";
  const outputFilename = args.outputFilename || "merged";

  if (files.length < 2) return { error: "At least 2 files are required" };

  const allSheets: Sheet[] = [];
  const allHeaders: string[][] = [];
  for (const f of files) {
    const sheets = await readFileToRows(f);
    if (sheets.length > 0 && sheets[0].rows.length > 0) {
      allHeaders.push(sheets[0].columns);
      allSheets.push(sheets[0]);
    }
  }

  if (allSheets.length === 0) return { error: "All files are empty" };

  // Union of all columns
  const allCols = [...new Set(allSheets.flatMap((s) => s.columns))];
  const mergedRows: Row[] = [];
  for (const s of allSheets) {
    for (const r of s.rows) {
      const row: Row = {};
      for (const c of allCols) row[c] = r[c] ?? "";
      mergedRows.push(row);
    }
  }

  const baseHeaders = allHeaders[0] || [];
  const hasMismatch = allHeaders.some(
    (h) => h.length !== baseHeaders.length || h.join("|") !== baseHeaders.join("|"),
  );

  const safeName = sanitizeFilename(outputFilename) || "merged";
  const info = await saveRowsToFile(mergedRows, safeName, "", outputFormat);
  await recordFile(info.filename, `${safeName}.xlsx`, info.mime, info.size, "merge", info.filepath);

  return {
    success: true,
    downloadUrl: `/api/tools/download?file=${info.filename}`,
    filename: info.filename,
    totalRows: mergedRows.length,
    headers: allCols,
    hasMismatch,
    mismatchWarning: hasMismatch
      ? "Some files have different headers. Data was merged using all available columns."
      : null,
  };
}

// ─── Tool: columns ───────────────────────────────────────────────────────────
export async function toolColumns(args: { filepath: string; originalName?: string }) {
  const filepath = args.filepath;
  if (!filepath) return { error: "File path is required" };

  const sheets = await readFileToRows(filepath);
  const result = sheets.map((s) => ({
    name: s.name,
    columns: s.columns,
    rowCount: s.rows.length,
  }));
  const preview = sheets.length > 0 ? rowsToDicts(sheets[0].rows.slice(0, 5)) : [];
  return { success: true, sheets: result, preview };
}

// ─── Tool: duplicates ────────────────────────────────────────────────────────
export async function toolDuplicates(args: {
  filepath: string;
  column: string;
  keepOccurrence?: string;
  originalName?: string;
}) {
  const { filepath, column } = args;
  const keep = args.keepOccurrence === "last" ? "last" : "first";
  if (!filepath || !column) return { error: "File and column are required" };

  const sheets = await readFileToRows(filepath);
  if (sheets.length === 0 || sheets[0].rows.length === 0)
    return { error: "File is empty" };
  const sheet = sheets[0];
  if (!sheet.columns.includes(column))
    return { error: `Column '${column}' not found` };

  const seen = new Map<string, number>();
  const deletedRows: Row[] = [];
  const remainingRows: Row[] = [];

  for (const r of sheet.rows) {
    const key = String(r[column] ?? "").trim();
    if (seen.has(key)) {
      const firstIdx = seen.get(key)!;
      if (keep === "first") {
        deletedRows.push(r);
      } else {
        // keep last: move first occurrence to deleted
        deletedRows.push(remainingRows[firstIdx]);
        remainingRows[firstIdx] = r;
      }
    } else {
      seen.set(key, remainingRows.length);
      remainingRows.push(r);
    }
  }

  const baseName = path.basename(filepath, path.extname(filepath));
  const info = await saveRowsToFile(remainingRows, baseName, "cleaned");
  await recordFile(info.filename, args.originalName || "", info.mime, info.size, "duplicates", info.filepath);

  return {
    success: true,
    downloadUrl: `/api/tools/download?file=${info.filename}`,
    filename: info.filename,
    totalRows: sheet.rows.length,
    duplicateRows: deletedRows.length,
    remainingRows: remainingRows.length,
    preview: {
      deleted: rowsToDicts(deletedRows.slice(0, 10)),
      remaining: rowsToDicts(remainingRows.slice(0, 5)),
    },
  };
}

// ─── Tool: convert ───────────────────────────────────────────────────────────
export async function toolConvert(args: {
  filepath: string;
  targetFormat?: string;
  delimiter?: string;
  sheetName?: string;
  originalName?: string;
}) {
  const filepath = args.filepath;
  const targetFormat = (args.targetFormat as "xlsx" | "csv") || "xlsx";
  const delimiter = args.delimiter || ",";
  if (!filepath) return { error: "File is required" };

  const sheets = await readFileToRows(filepath, delimiter);
  let targetSheet: Sheet;
  if (sheets.length === 0) return { error: "File has no sheets" };

  const sheetNames = sheets.map((s) => s.name);
  if (args.sheetName && sheetNames.includes(args.sheetName)) {
    targetSheet = sheets.find((s) => s.name === args.sheetName)!;
  } else {
    targetSheet = sheets[0];
  }

  const baseName = path.basename(filepath, path.extname(filepath));
  const info = await saveRowsToFile(targetSheet.rows, baseName, "", targetFormat, delimiter);
  await recordFile(info.filename, args.originalName || "", info.mime, info.size, "convert", info.filepath);

  return {
    success: true,
    downloadUrl: `/api/tools/download?file=${info.filename}`,
    filename: info.filename,
    sheets: sheetNames,
  };
}

// ─── Tool: stats ─────────────────────────────────────────────────────────────
export async function toolStats(args: {
  filepath: string;
  generateReport?: string;
  originalName?: string;
}) {
  const filepath = args.filepath;
  const generateReport = args.generateReport === "true";
  if (!filepath) return { error: "File is required" };

  const sheets = await readFileToRows(filepath);
  if (sheets.length === 0 || sheets[0].rows.length === 0)
    return { error: "File is empty" };
  const sheet = sheets[0];

  const stats: Record<string, unknown>[] = [];
  for (const col of sheet.columns) {
    const values = sheet.rows.map((r) => r[col]);
    const nonEmpty = values.filter((v) => v != null && v !== "");
    const numericVals = nonEmpty.map(toNum).filter((n) => !Number.isNaN(n));
    const distinct = new Set(nonEmpty.map((v) => String(v))).size;
    const missing = values.length - nonEmpty.length;

    let colType: string;
    if (nonEmpty.length === 0) colType = "empty";
    else if (numericVals.length === nonEmpty.length) colType = "numeric";
    else if (numericVals.length === 0) colType = "text";
    else colType = "mixed";

    const stat: Record<string, unknown> = {
      column: col,
      type: colType,
      count: nonEmpty.length,
      distinct,
      missing,
    };

    if (colType === "numeric" || (colType === "mixed" && numericVals.length > 0)) {
      stat.sum = round(numericVals.reduce((a, b) => a + b, 0));
      stat.avg = round(mean(numericVals));
      stat.min = Math.min(...numericVals);
      stat.max = Math.max(...numericVals);
      stat.median = round(median(numericVals));
      stat.stdDev = round(stdDev(numericVals));
    }

    if (colType === "text" || colType === "mixed") {
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
    const baseName = path.basename(filepath, path.extname(filepath));
    const summaryRows: Row[] = stats.map((s) => ({
      Column: String(s.column),
      Type: String(s.type),
      Count: String(s.count),
      Distinct: String(s.distinct),
      Missing: String(s.missing),
      Sum: s.sum != null ? String(s.sum) : "",
      Average: s.avg != null ? String(s.avg) : "",
      Min: s.min != null ? String(s.min) : "",
      Max: s.max != null ? String(s.max) : "",
      Median: s.median != null ? String(s.median) : "",
      "Std Dev": s.stdDev != null ? String(s.stdDev) : "",
      "Min Length": s.minLength != null ? String(s.minLength) : "",
      "Max Length": s.maxLength != null ? String(s.maxLength) : "",
    }));
    const topRows: Row[] = [];
    for (const s of stats) {
      const tvs = (s.topValues as { value: string; count: number }[]) || [];
      for (const tv of tvs) {
        topRows.push({
          Column: String(s.column),
          Value: tv.value,
          Count: String(tv.count),
          "Percent of Filled":
            Number(s.count) > 0 ? `${((tv.count / Number(s.count)) * 100).toFixed(1)}%` : "0.0%",
        });
      }
    }
    const info = await saveSheetsToFile(
      [
        { name: "Summary", rows: summaryRows },
        { name: "Top Values", rows: topRows },
      ],
      baseName,
      "stats",
    );
    await recordFile(info.filename, args.originalName || "", info.mime, info.size, "stats", info.filepath);
    downloadUrl = `/api/tools/download?file=${info.filename}`;
    reportFilename = info.filename;
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

// ─── Tool: sort ──────────────────────────────────────────────────────────────
export async function toolSort(args: {
  filepath: string;
  column: string;
  order?: string;
  originalName?: string;
}) {
  const { filepath, column } = args;
  const order = args.order === "desc" ? "desc" : "asc";
  if (!filepath || !column) return { error: "File and column are required" };

  const sheets = await readFileToRows(filepath);
  if (sheets.length === 0 || sheets[0].rows.length === 0)
    return { error: "File is empty" };
  const sheet = sheets[0];
  if (!sheet.columns.includes(column))
    return { error: `Column '${column}' not found` };

  const ascending = order === "asc";
  const hasNums = sheet.rows.some((r) => isNumeric(r[column]));
  const rows = [...sheet.rows];
  rows.sort((a, b) => {
    const va = a[column] ?? "";
    const vb = b[column] ?? "";
    if (va === "" && vb === "") return 0;
    if (va === "") return 1;
    if (vb === "") return -1;
    if (hasNums) {
      const na = toNum(va);
      const nb = toNum(vb);
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return ascending ? na - nb : nb - na;
    }
    return ascending ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
  });

  const baseName = path.basename(filepath, path.extname(filepath));
  const info = await saveRowsToFile(rows, baseName, "sorted");
  await recordFile(info.filename, args.originalName || "", info.mime, info.size, "sort", info.filepath);

  return {
    success: true,
    downloadUrl: `/api/tools/download?file=${info.filename}`,
    filename: info.filename,
    totalRows: rows.length,
    sortedBy: column,
    order,
    preview: rowsToDicts(rows.slice(0, 10)),
  };
}

// ─── Tool: filter ────────────────────────────────────────────────────────────
type FilterCondition = {
  column: string;
  operator: string;
  value?: string;
};

export async function toolFilter(args: {
  filepath: string;
  conditions: FilterCondition[];
  combineWith?: string;
  originalName?: string;
}) {
  const filepath = args.filepath;
  const conditions = args.conditions || [];
  const combineWith = args.combineWith === "OR" ? "OR" : "AND";
  if (!filepath) return { error: "File is required" };
  if (conditions.length === 0) return { error: "At least one filter condition is required" };

  const sheets = await readFileToRows(filepath);
  if (sheets.length === 0 || sheets[0].rows.length === 0)
    return { error: "File is empty" };
  const sheet = sheets[0];

  for (const c of conditions) {
    if (!sheet.columns.includes(c.column))
      return { error: `Column '${c.column}' not found` };
  }

  const applyCond = (row: Row, cond: FilterCondition): boolean => {
    const cell = String(row[cond.column] ?? "");
    const val = String(cond.value ?? "");
    const op = cond.operator;
    if (op === "equals") {
      const cn = toNum(cell);
      const vn = toNum(val);
      if (!Number.isNaN(cn) && !Number.isNaN(vn)) return cn === vn;
      return cell === val;
    }
    if (op === "not_equals") {
      const cn = toNum(cell);
      const vn = toNum(val);
      if (!Number.isNaN(cn) && !Number.isNaN(vn)) return cn !== vn;
      return cell !== val;
    }
    if (op === "contains") return cell.toLowerCase().includes(val.toLowerCase());
    if (op === "not_contains") return !cell.toLowerCase().includes(val.toLowerCase());
    if (op === "starts_with") return cell.toLowerCase().startsWith(val.toLowerCase());
    if (op === "ends_with") return cell.toLowerCase().endsWith(val.toLowerCase());
    if (op === "greater_than") {
      const cn = toNum(cell);
      const vn = toNum(val);
      if (!Number.isNaN(cn) && !Number.isNaN(vn)) return cn > vn;
      return cell > val;
    }
    if (op === "less_than") {
      const cn = toNum(cell);
      const vn = toNum(val);
      if (!Number.isNaN(cn) && !Number.isNaN(vn)) return cn < vn;
      return cell < val;
    }
    if (op === "greater_or_equal") {
      const cn = toNum(cell);
      const vn = toNum(val);
      if (!Number.isNaN(cn) && !Number.isNaN(vn)) return cn >= vn;
      return cell >= val;
    }
    if (op === "less_or_equal") {
      const cn = toNum(cell);
      const vn = toNum(val);
      if (!Number.isNaN(cn) && !Number.isNaN(vn)) return cn <= vn;
      return cell <= val;
    }
    if (op === "is_empty") return cell.trim() === "";
    if (op === "is_not_empty") return cell.trim() !== "";
    return true;
  };

  const filtered = sheet.rows.filter((r) =>
    combineWith === "OR"
      ? conditions.some((c) => applyCond(r, c))
      : conditions.every((c) => applyCond(r, c)),
  );

  const baseName = path.basename(filepath, path.extname(filepath));
  const info = await saveRowsToFile(filtered, baseName, "filtered");
  await recordFile(info.filename, args.originalName || "", info.mime, info.size, "filter", info.filepath);

  return {
    success: true,
    downloadUrl: `/api/tools/download?file=${info.filename}`,
    filename: info.filename,
    totalRows: sheet.rows.length,
    matchedRows: filtered.length,
    removedRows: sheet.rows.length - filtered.length,
    conditions,
    combineWith,
    preview: rowsToDicts(filtered.slice(0, 10)),
  };
}

// ─── Tool: replace ───────────────────────────────────────────────────────────
export async function toolReplace(args: {
  filepath: string;
  find: string;
  replace: string;
  columns?: string[];
  matchMode?: string;
  caseSensitive?: string;
  useRegex?: string;
  originalName?: string;
}) {
  const filepath = args.filepath;
  const find = args.find || "";
  const replace = args.replace ?? "";
  const scopeColumns = args.columns || [];
  const matchMode = args.matchMode || "contains";
  const caseSensitive = args.caseSensitive === "true";
  const useRegex = args.useRegex === "true";
  if (!filepath) return { error: "File is required" };
  if (!find) return { error: "Find text is required" };

  const sheets = await readFileToRows(filepath);
  if (sheets.length === 0 || sheets[0].rows.length === 0)
    return { error: "File is empty" };
  const sheet = sheets[0];

  const targetColumns = scopeColumns.filter((c) => sheet.columns.includes(c));
  const finalCols = targetColumns.length > 0 ? targetColumns : sheet.columns;

  let pattern: RegExp;
  try {
    const flags = caseSensitive ? "g" : "gi";
    if (useRegex) {
      pattern = new RegExp(find, flags);
    } else {
      const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      let body = escaped;
      if (matchMode === "exact") body = `^${escaped}$`;
      else if (matchMode === "startsWith") body = `^${escaped}`;
      else if (matchMode === "endsWith") body = `${escaped}$`;
      pattern = new RegExp(body, flags);
    }
  } catch {
    return { error: "Invalid regex pattern" };
  }

  let totalMatches = 0;
  let cellsChanged = 0;
  const rowsAffected = new Set<number>();
  const changes: Array<{ row: number; column: string; before: string; after: string }> = [];

  const rows = sheet.rows.map((r) => ({ ...r }));
  for (let i = 0; i < rows.length; i++) {
    for (const col of finalCols) {
      const original = String(rows[i][col] ?? "");
      const globalPattern = new RegExp(pattern.source, pattern.flags);
      const matches = original.match(globalPattern);
      if (matches && matches.length > 0) {
        const new_val = original.replace(globalPattern, replace);
        if (new_val !== original) {
          totalMatches += matches.length;
          cellsChanged += 1;
          rowsAffected.add(i);
          rows[i][col] = new_val;
          if (changes.length < 50) {
            changes.push({
              row: i + 1,
              column: col,
              before: original.slice(0, 80),
              after: new_val.slice(0, 80),
            });
          }
        }
      }
    }
  }

  const baseName = path.basename(filepath, path.extname(filepath));
  const info = await saveRowsToFile(rows, baseName, "replaced");
  await recordFile(info.filename, args.originalName || "", info.mime, info.size, "replace", info.filepath);

  return {
    success: true,
    downloadUrl: `/api/tools/download?file=${info.filename}`,
    filename: info.filename,
    totalRows: rows.length,
    scopedColumns: finalCols,
    matchMode: useRegex ? "regex" : matchMode,
    caseSensitive,
    totalMatches,
    cellsChanged,
    rowsAffected: rowsAffected.size,
    changes,
    preview: rowsToDicts(rows.slice(0, 10)),
  };
}

// ─── Tool: transpose ─────────────────────────────────────────────────────────
export async function toolTranspose(args: {
  filepath: string;
  mode?: string;
  idColumns?: string[];
  varName?: string;
  valueName?: string;
  originalName?: string;
}) {
  const filepath = args.filepath;
  const mode = args.mode === "unpivot" ? "unpivot" : "transpose";
  const idColumns = args.idColumns || [];
  const varName = args.varName || "variable";
  const valueName = args.valueName || "value";
  if (!filepath) return { error: "File is required" };

  const sheets = await readFileToRows(filepath);
  if (sheets.length === 0 || sheets[0].rows.length === 0)
    return { error: "File is empty" };
  const sheet = sheets[0];
  const columns = sheet.columns;

  let resultRows: Row[] = [];
  let outputColumns: string[] = [];

  if (mode === "transpose") {
    const newCols = ["Column", ...sheet.rows.map((_, i) => `Row ${i + 1}`)];
    outputColumns = newCols;
    for (const col of columns) {
      const row: Row = { Column: col };
      for (let i = 0; i < sheet.rows.length; i++) {
        row[`Row ${i + 1}`] = String(sheet.rows[i][col] ?? "");
      }
      resultRows.push(row);
    }
  } else {
    if (idColumns.length === 0)
      return { error: "Select at least one ID column for unpivot" };
    const valueCols = columns.filter((c) => !idColumns.includes(c));
    if (valueCols.length === 0) return { error: "No value columns to unpivot" };
    outputColumns = [...idColumns, varName, valueName];
    for (const r of sheet.rows) {
      for (const vc of valueCols) {
        const out: Row = {};
        for (const idc of idColumns) out[idc] = r[idc] ?? "";
        out[varName] = vc;
        out[valueName] = String(r[vc] ?? "");
        resultRows.push(out);
      }
    }
  }

  const baseName = path.basename(filepath, path.extname(filepath));
  const suffix = mode === "transpose" ? "transposed" : "unpivoted";
  const info = await saveRowsToFile(resultRows, baseName, suffix);
  await recordFile(info.filename, args.originalName || "", info.mime, info.size, "transpose", info.filepath);

  return {
    success: true,
    downloadUrl: `/api/tools/download?file=${info.filename}`,
    filename: info.filename,
    mode,
    inputRows: sheet.rows.length,
    inputColumns: columns.length,
    outputRows: resultRows.length,
    outputColumns,
    preview: rowsToDicts(resultRows.slice(0, 20)),
  };
}

// ─── Tool: pivot ─────────────────────────────────────────────────────────────
type Aggregation = {
  column: string;
  function: string;
  alias?: string;
};

export async function toolPivot(args: {
  filepath: string;
  groupBy: string[];
  aggregations: Aggregation[];
  originalName?: string;
}) {
  const filepath = args.filepath;
  const groupBy = args.groupBy || [];
  const aggregations = args.aggregations || [];
  if (!filepath) return { error: "File is required" };
  if (groupBy.length === 0) return { error: "Select at least one column to group by" };
  if (aggregations.length === 0) return { error: "Add at least one aggregation" };

  const sheets = await readFileToRows(filepath);
  if (sheets.length === 0 || sheets[0].rows.length === 0)
    return { error: "File is empty" };
  const sheet = sheets[0];

  for (const c of groupBy) {
    if (!sheet.columns.includes(c)) return { error: `Group-by column '${c}' not found` };
  }
  for (const a of aggregations) {
    if (a.function !== "count" && !sheet.columns.includes(a.column))
      return { error: `Aggregation column '${a.column}' not found` };
  }

  // Group rows by composite key
  const groups = new Map<string, Row[]>();
  const groupKeyOrder: string[] = [];
  for (const r of sheet.rows) {
    const key = groupBy.map((c) => String(r[c] ?? "")).join("\u0000");
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
    count_distinct: (v) => new Set(v).size,
    min: (v) => (v.length ? Math.min(...v) : 0),
    max: (v) => (v.length ? Math.max(...v) : 0),
    first: (v) => (v.length ? v[0] : 0),
    last: (v) => (v.length ? v[v.length - 1] : 0),
  };

  const resultRows: Row[] = [];
  for (const key of groupKeyOrder) {
    const groupRows = groups.get(key)!;
    const keyParts = key.split("\u0000");
    const out: Row = {};
    for (let i = 0; i < groupBy.length; i++) out[groupBy[i]] = keyParts[i];
    for (const a of aggregations) {
      const alias = a.alias || `${a.column}_${a.function}`;
      const fn = aggFns[a.function] || aggFns.count;
      if (a.function === "count") {
        out[alias] = String(fn(groupRows.map(() => 1)));
      } else if (a.function === "count_distinct") {
        const distinctValues = new Set(groupRows.map((r) => String(r[a.column] ?? "")));
        out[alias] = String(distinctValues.size);
      } else {
        const vals = groupRows
          .map((r) => toNum(r[a.column]))
          .filter((n) => !Number.isNaN(n));
        const result = fn(vals);
        out[alias] = a.function === "sum" || a.function === "avg"
          ? String(round(result))
          : String(result);
      }
    }
    resultRows.push(out);
  }

  // Sort by first group-by column (numeric if possible)
  const firstCol = groupBy[0];
  const hasNums = resultRows.some((r) => isNumeric(r[firstCol]));
  resultRows.sort((a, b) => {
    if (hasNums) return toNum(a[firstCol]) - toNum(b[firstCol]);
    return String(a[firstCol]).localeCompare(String(b[firstCol]));
  });

  const baseName = path.basename(filepath, path.extname(filepath));
  const info = await saveRowsToFile(resultRows, baseName, "pivot");
  await recordFile(info.filename, args.originalName || "", info.mime, info.size, "pivot", info.filepath);

  return {
    success: true,
    downloadUrl: `/api/tools/download?file=${info.filename}`,
    filename: info.filename,
    totalRows: sheet.rows.length,
    groupCount: resultRows.length,
    groupBy,
    aggregations,
    preview: rowsToDicts(resultRows.slice(0, 20)),
  };
}

// ─── Tool: validate ──────────────────────────────────────────────────────────
export async function toolValidate(args: {
  filepath: string;
  checks?: string[];
  primaryKey?: string;
  emailColumns?: string[];
  urlColumns?: string[];
  dateColumns?: string[];
  originalName?: string;
}) {
  const filepath = args.filepath;
  if (!filepath) return { error: "File is required" };

  const sheets = await readFileToRows(filepath);
  if (sheets.length === 0 || sheets[0].rows.length === 0)
    return { error: "File is empty" };
  const sheet = sheets[0];

  const checks = args.checks || [
    "empty_cells", "mixed_types", "duplicate_keys", "email_format",
    "url_format", "date_format", "constant_columns", "whitespace",
    "outliers",
  ];
  const primaryKey = args.primaryKey || "";
  const emailCols = args.emailColumns || [];
  const urlCols = args.urlColumns || [];
  const dateCols = args.dateColumns || [];

  const issues: Array<{
    row: number; column: string; value: string; message: string; severity: string;
  }> = [];
  const columnReports: any[] = [];

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const urlRe = /^(https?:\/\/|www\.)[^\s]+$/i;
  const dateRe = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?Z?)?$/;

  for (const col of sheet.columns) {
    const values = sheet.rows.map((r) => r[col]);
    const nonEmpty = values.filter((v) => v != null && v !== "");
    const emptyCells = values.length - nonEmpty.length;
    const whitespaceOnly = values.filter(
      (v) => typeof v === "string" && v !== "" && v.trim() === "",
    ).length;
    const uniqueSet = new Set(nonEmpty.map((v) => String(v)));

    const nums = nonEmpty.filter((v) => isNumeric(v)).length;
    const texts = nonEmpty.length - nums;
    let detectedType: string;
    if (nonEmpty.length === 0) detectedType = "empty";
    else if (nums === nonEmpty.length) detectedType = "number";
    else if (texts === nonEmpty.length) detectedType = "text";
    else detectedType = "mixed";
    const isConstant = nonEmpty.length > 0 && uniqueSet.size === 1;

    const report: any = {
      column: col,
      totalCells: values.length,
      emptyCells,
      whitespaceOnly,
      uniqueValues: uniqueSet.size,
      detectedType,
      isConstant,
    };

    if (detectedType === "number" && nonEmpty.length > 0) {
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

    if (checks.includes("empty_cells")) {
      for (let i = 0; i < values.length; i++) {
        if (values[i] == null || values[i] === "") {
          issues.push({
            row: i + 1, column: col, value: "",
            message: "Empty cell", severity: "info",
          });
        }
      }
    }
    if (checks.includes("whitespace")) {
      for (let i = 0; i < values.length; i++) {
        const v = String(values[i] ?? "");
        if (v !== "" && v.trim() === "") {
          issues.push({
            row: i + 1, column: col, value: v,
            message: "Whitespace-only cell", severity: "warning",
          });
        }
      }
    }
    if (checks.includes("constant_columns") && isConstant) {
      issues.push({
        row: 0, column: col, value: String(nonEmpty[0]),
        message: `Column is constant — every non-empty cell is "${nonEmpty[0]}"`,
        severity: "info",
      });
    }
    if (checks.includes("outliers") && detectedType === "number") {
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
              message: `Outlier detected (${n})`, severity: "warning",
            });
          }
        }
      }
    }
    if (checks.includes("email_format") && emailCols.includes(col)) {
      for (let i = 0; i < values.length; i++) {
        const v = String(values[i] ?? "");
        if (v && !emailRe.test(v)) {
          issues.push({
            row: i + 1, column: col, value: v,
            message: "Invalid email format", severity: "error",
          });
        }
      }
    }
    if (checks.includes("url_format") && urlCols.includes(col)) {
      for (let i = 0; i < values.length; i++) {
        const v = String(values[i] ?? "");
        if (v && !urlRe.test(v)) {
          issues.push({
            row: i + 1, column: col, value: v,
            message: "Invalid URL format", severity: "error",
          });
        }
      }
    }
    if (checks.includes("date_format") && dateCols.includes(col)) {
      for (let i = 0; i < values.length; i++) {
        const v = String(values[i] ?? "");
        if (v && !dateRe.test(v)) {
          issues.push({
            row: i + 1, column: col, value: v,
            message: "Invalid date format", severity: "error",
          });
        }
      }
    }
  }

  if (checks.includes("duplicate_keys") && primaryKey && sheet.columns.includes(primaryKey)) {
    const seen = new Map<string, number[]>();
    for (let i = 0; i < sheet.rows.length; i++) {
      const v = String(sheet.rows[i][primaryKey] ?? "").trim();
      if (v === "") continue;
      if (!seen.has(v)) seen.set(v, []);
      seen.get(v)!.push(i + 1);
    }
    for (const [v, rows] of seen.entries()) {
      if (rows.length > 1) {
        issues.push({
          row: rows[0], column: primaryKey, value: v,
          message: `Duplicate primary key "${v}" appears in rows: ${rows.join(", ")}`,
          severity: "error",
        });
      }
    }
  }

  const totalCells = sheet.rows.length * sheet.columns.length;
  const summary = {
    totalRows: sheet.rows.length,
    totalColumns: sheet.columns.length,
    totalCells,
    emptyCells: columnReports.reduce((a: number, r: any) => a + r.emptyCells, 0),
    uniqueIssues: issues.length,
    errors: issues.filter((i) => i.severity === "error").length,
    warnings: issues.filter((i) => i.severity === "warning").length,
    infos: issues.filter((i) => i.severity === "info").length,
    constantColumns: columnReports.filter((r: any) => r.isConstant).length,
    mixedTypeColumns: columnReports.filter((r: any) => r.detectedType === "mixed").length,
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

  const baseName = path.basename(filepath, path.extname(filepath));
  const summaryRows: Row[] = [
    ...Object.entries(summary).map(([k, v]) => ({ Metric: k, Value: String(v) })),
    { Metric: "Quality Score", Value: `${overallScore}/100` },
  ];
  const colData: Row[] = columnReports.map((r: any) => ({
    Column: r.column,
    Type: r.detectedType,
    "Total Cells": String(r.totalCells),
    "Empty Cells": String(r.emptyCells),
    "Whitespace-only": String(r.whitespaceOnly),
    "Unique Values": String(r.uniqueValues),
    Constant: r.isConstant ? "Yes" : "No",
    Min: r.min != null ? String(r.min) : "",
    Max: r.max != null ? String(r.max) : "",
    Mean: r.mean != null ? String(r.mean) : "",
  }));
  const issueData: Row[] = issues.slice(0, 1000).map((i) => ({
    Row: String(i.row),
    Column: i.column,
    Value: String(i.value),
    Severity: i.severity,
    Message: i.message,
  }));
  const sheetsToSave = [
    { name: "Summary", rows: summaryRows },
    { name: "Columns", rows: colData },
    { name: "Issues", rows: issueData },
  ];
  const info = await saveSheetsToFile(sheetsToSave, baseName, "validation");
  await recordFile(info.filename, args.originalName || "", info.mime, info.size, "validate", info.filepath);

  return {
    success: true,
    downloadUrl: `/api/tools/download?file=${info.filename}`,
    filename: info.filename,
    summary,
    overallScore,
    columnReports,
    issues: issues.slice(0, 200),
    checksRun: checks,
  };
}

// ─── Tool: attendance ────────────────────────────────────────────────────────
export async function toolAttendance(args: {
  filepath: string;
  column: string;
  rollNumber: string;
  originalName?: string;
}) {
  const { filepath, column, rollNumber } = args;
  if (!filepath || !column || !rollNumber)
    return { error: "File, column, and roll number are required" };

  const sheets = await readFileToRows(filepath);
  if (sheets.length === 0 || sheets[0].rows.length === 0)
    return { error: "File is empty" };
  const sheet = sheets[0];
  if (!sheet.columns.includes(column))
    return { error: `Column '${column}' not found` };

  const studentRows = sheet.rows.filter(
    (r) => String(r[column] ?? "").trim() === rollNumber.trim(),
  );
  if (studentRows.length === 0)
    return { error: `No records found for roll number: ${rollNumber}` };

  const classColumns = sheet.columns.filter((c) => c !== column);
  if (classColumns.length > 0) {
    const student = studentRows[0];
    const total = classColumns.length;
    let present = 0;
    const details: { class: string; status: string }[] = [];
    for (const col of classColumns) {
      const val = String(student[col] ?? "").trim().toLowerCase();
      const isPresent = ["present", "p", "1", "yes", "true"].includes(val);
      if (isPresent) present += 1;
      details.push({ class: col, status: String(student[col] ?? "N/A") });
    }
    return {
      success: true,
      report: {
        rollNumber,
        totalClasses: total,
        presentCount: present,
        absentCount: total - present,
        attendancePercentage:
          total > 0 ? ((present / total) * 100).toFixed(2) : "0.00",
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
      attendancePercentage:
        totalClasses > 0 ? ((presentCount / totalClasses) * 100).toFixed(2) : "0.00",
    },
  };
}

// ─── Tool: preview ───────────────────────────────────────────────────────────
export async function toolPreview(args: { file: string; rows?: number }) {
  const filename = args.file || "";
  const rows = args.rows || 50;
  if (!filename) return { error: "Filename is required" };

  const safeName = path.basename(filename);
  const filepath = path.join(DOWNLOAD_DIR, safeName);
  try {
    await fs.access(filepath);
  } catch {
    return { error: "File not found" };
  }

  const sheets = await readFileToRows(filepath);
  const sheet = sheets[0] || { name: "Sheet1", columns: [], rows: [] };
  return {
    success: true,
    sheetName: sheet.name,
    totalRows: sheet.rows.length,
    columns: sheet.columns,
    data: rowsToDicts(sheet.rows.slice(0, rows)),
  };
}

// ─── Tool: download-excel ────────────────────────────────────────────────────
export async function toolDownloadExcel(args: {
  url: string;
  originalName?: string;
}) {
  const url = args.url || "";
  if (!url) return { error: "URL is required" };
  try {
    const resp = await fetch(url);
    if (!resp.ok) return { error: `HTTP ${resp.status}: ${resp.statusText}` };
    const buf = Buffer.from(await resp.arrayBuffer());
    await ensureDownloadDirExists();
    const uid = Math.random().toString(36).slice(2, 10);
    const urlFilename = decodeURIComponent(url.split("?")[0].split("/").pop() || "downloaded");
    const ext = path.extname(urlFilename) || ".xlsx";
    const stem = path.basename(urlFilename, ext) || "downloaded";
    const filename = `${sanitizeFilename(stem)}_${uid}${ext}`;
    const filepath = path.join(DOWNLOAD_DIR, filename);
    await fs.writeFile(filepath, buf);
    const mime = "application/octet-stream";
    await recordFile(filename, urlFilename, mime, buf.length, "download-excel", filepath);
    return {
      success: true,
      downloadUrl: `/api/tools/download?file=${filename}`,
      filename,
      size: buf.length,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Download failed" };
  }
}

// ─── Tool: download-images ───────────────────────────────────────────────────

function detectImageFormat(buf: Buffer): {
  ext: "jpeg" | "png" | "gif" | "bmp";
  mimeType: string;
  needsConversion: boolean;
  isSupported: boolean;
} {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return { ext: "jpeg", mimeType: "image/jpeg", needsConversion: false, isSupported: true };

  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
    return { ext: "png", mimeType: "image/png", needsConversion: false, isSupported: true };

  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46)
    return { ext: "gif", mimeType: "image/gif", needsConversion: false, isSupported: true };

  if (buf[0] === 0x42 && buf[1] === 0x4d)
    return { ext: "bmp", mimeType: "image/bmp", needsConversion: false, isSupported: true };

  // WEBP: RIFF....WEBP
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  )
    return { ext: "jpeg", mimeType: "image/jpeg", needsConversion: true, isSupported: true };

  // Unknown — likely HTML error page or corrupted
  return { ext: "jpeg", mimeType: "image/jpeg", needsConversion: false, isSupported: false };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function toolDownloadImages(args: {
  filepath: string;
  urlColumn: string;
  originalName?: string;
  selectedColumns?: string[];
}) {
  const { filepath, urlColumn, originalName = "images", selectedColumns } = args;

  if (!filepath) return { error: "File path is required" };
  if (!urlColumn) return { error: "URL column is required" };

  const sheets = await readFileToRows(filepath);
  if (!sheets.length) return { error: "No sheets found in file" };
  const sheet = sheets[0];

  if (!sheet.columns.includes(urlColumn)) {
    return { error: `Column "${urlColumn}" not found in file` };
  }

  // Import sharp once
  let sharp: ((buf: Buffer) => any) | null = null;
  try {
    const sharpMod = await import("sharp");
    sharp = sharpMod.default as any;
  } catch {
    // sharp unavailable — WebP conversion and resize will be skipped
  }

  // Download all images
  const results: { row: number; url: string; status: string; error?: string }[] = [];
  const imageBuffers: (Buffer | null)[] = [];

  for (let i = 0; i < sheet.rows.length; i++) {
    const url = (sheet.rows[i][urlColumn] || "").trim();
    if (!url) {
      results.push({ row: i + 1, url: "", status: "skipped" });
      imageBuffers.push(null);
      continue;
    }

    let currentUrl = url;
    let finalBuf: Buffer | null = null;

    try {
      // Try up to 2 times (first try = original URL, second try = extracted URL)
      for (let attempt = 0; attempt < 2; attempt++) {
        const resp = await fetch(currentUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": "https://survey.porsline.ir/",
            "Accept": "*/*",
            "Accept-Language": "en-US,en;q=0.9",
            // This header is the magic trick! It tells the server we are an AJAX request,
            // which often bypasses the HTML JavaScript wrapper entirely.
            "X-Requested-With": "XMLHttpRequest", 
          },
          signal: AbortSignal.timeout(30_000),
        });

        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        const buf = Buffer.from(await resp.arrayBuffer());
        const contentType = resp.headers.get("content-type") || "";
        
        // Efficiently check if the response is HTML
        const textStart = buf.subarray(0, 100).toString("utf-8").trimStart();
        const isHtml = contentType.includes("text/html") || 
                       textStart.startsWith("<!DOCTYPE") || 
                       textStart.startsWith("<html");

        if (isHtml) {
          if (attempt === 0) {
            // We got the HTML wrapper. Let's try to extract the real link from the JavaScript inside.
            const htmlText = buf.toString("utf-8");
            
            // Look for URLs pointing to storage, or ending in image extensions
            const match = htmlText.match(/https?:\/\/[^"'\s]+responses\.storage[^"'\s]+/i) || 
                          htmlText.match(/https?:\/\/[^"'\s]+\.(?:jpeg|jpg|png|webp|gif)[^"'\s]*/i);
            
            if (match && match[0] && match[0] !== currentUrl) {
              currentUrl = match[0]; // Switch to the real link
              continue; // Loop again to fetch the actual image
            }
          }
          // If we couldn't find a link, or if this was the second attempt, fail.
          throw new Error("Server returned HTML page instead of image");
        }

        // If we get here, it's a binary file (success!)
        if (buf.length === 0) throw new Error("Empty response body");
        
        finalBuf = buf;
        break; // Exit the loop, we have the image
      }

      if (!finalBuf) throw new Error("Failed to download image buffer");

      imageBuffers.push(finalBuf);
      results.push({ row: i + 1, url: currentUrl, status: "success" });

    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "Failed";
      imageBuffers.push(null);
      results.push({ row: i + 1, url: currentUrl, status: "failed", error: errMsg });
      await logError("download-images", errMsg, `Row ${i + 1}: ${currentUrl}`);
    }
  }

  // Process images into base64 strings
  const imageBase64s: (string | null)[] = [];

  for (let i = 0; i < imageBuffers.length; i++) {
    const buf = imageBuffers[i];
    if (!buf) {
      imageBase64s.push(null);
      continue;
    }

    try {
      const { mimeType, needsConversion, isSupported } = detectImageFormat(buf);

      // Skip completely if not a recognized image format
      if (!isSupported) {
        results[i].status = "failed";
        results[i].error = "Unrecognized image format (possibly corrupted)";
        await logError("download-images", results[i].error!, `Row ${i + 1}: ${results[i].url}`);
        imageBase64s.push(null);
        continue;
      }

      let finalBuf = buf;

      // Convert WebP → JPEG
      if (needsConversion && sharp) {
        finalBuf = await sharp(buf).jpeg({ quality: 90 }).toBuffer();
      }

      // Resize to max 200px wide/tall so HTML table stays readable
      if (sharp) {
        try {
          finalBuf = await sharp(finalBuf)
            .resize(200, 200, { fit: "inside", withoutEnlargement: true })
            .toBuffer();
        } catch {
          // resize failed, use buf as-is
        }
      }

      const b64 = finalBuf.toString("base64");
      const mime = needsConversion ? "image/jpeg" : mimeType;
      imageBase64s.push(`data:${mime};base64,${b64}`);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "Image processing failed";
      results[i].status = "failed";
      results[i].error = errMsg;
      await logError("download-images", errMsg, `Row ${i + 1}: ${results[i].url}`);
      imageBase64s.push(null);
    }
  }

  // Build HTML table
  let otherColumns = sheet.columns.filter((c) => c !== urlColumn);
  if (selectedColumns && selectedColumns.length > 0) {
    otherColumns = otherColumns.filter((c) => selectedColumns.includes(c));
  }

  const headerCells = [
    `<th>Image</th>`,
    ...otherColumns.map((c) => `<th>${escapeHtml(c)}</th>`),
  ].join("");

  const bodyRows = sheet.rows.map((row, i) => {
    const imgSrc = imageBase64s[i];
    const imgCell = imgSrc
      ? `<td class="img-cell"><img src="${imgSrc}" /></td>`
      : `<td class="img-cell empty">${results[i]?.error ? "Error" : "—"}</td>`;

    const dataCells = otherColumns
      .map((c) => `<td>${escapeHtml(String(row[c] ?? ""))}</td>`)
      .join("");

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
    ${results.filter((r) => r.status === "success").length} images loaded · 
    Generated ${new Date().toLocaleString()}
  </p>
  <div class="table-wrap">
    <table>
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${bodyRows.join("\n")}</tbody>
    </table>
  </div>
</body>
</html>`;

  // Save file
  await ensureDownloadDirExists();
  const uid = Math.random().toString(36).slice(2, 10);
  const baseName =
    sanitizeFilename(path.basename(originalName, path.extname(originalName))) || "images";
  const filename = `${baseName}_images_${uid}.html`;
  const outPath = path.join(DOWNLOAD_DIR, filename);
  await fs.writeFile(outPath, html, "utf-8");

  const mime = "text/html";
  await recordFile(filename, originalName, mime, Buffer.byteLength(html), "download-images", outPath);

  const successCount = results.filter((r) => r.status === "success").length;
  const failCount = results.filter((r) => r.status === "failed").length;

  if (failCount > 0) {
    const failedLines = results
      .filter((r) => r.status === "failed")
      .map((r) => `Row ${r.row}: ${r.url} — ${r.error || "unknown"}`)
      .join("\n");
    await logError(
      "download-images",
      `${failCount} of ${sheet.rows.length} images failed`,
      failedLines,
    );
  }

  return {
    success: true,
    downloadUrl: `/api/tools/download?file=${filename}`,
    filename,
    totalRows: sheet.rows.length,
    successCount,
    failCount,
    results,
  };
}






async function ensureDownloadDirExists() {
  await fs.mkdir(DOWNLOAD_DIR, { recursive: true });
}

// ─── Tool: history_get / history_delete / errors_get ─────────────────────────
export async function toolHistoryGet() {
  try {
    const records = await db.fileRecord.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return { success: true, records };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "DB error" };
  }
}

export async function toolHistoryDelete(args: { id?: string }) {
  try {
    if (args.id) {
      const record = await db.fileRecord.findUnique({ where: { id: args.id } });
      if (!record) return { error: "Record not found" };
      if (record.outputPath) {
        try { await fs.unlink(record.outputPath); } catch {}
      }
      await db.fileRecord.delete({ where: { id: args.id } });
      return { success: true, message: "Record deleted" };
    }
    const records = await db.fileRecord.findMany();
    for (const r of records) {
      if (r.outputPath) {
        try { await fs.unlink(r.outputPath); } catch {}
      }
    }
    const count = records.length;
    await db.fileRecord.deleteMany();
    return { success: true, message: `Cleared ${count} records` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "DB error" };
  }
}

export async function toolErrorsGet() {
  try {
    const records = await db.errorLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return { success: true, records };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "DB error" };
  }
}
