"""
Excel Suite - Python FastAPI Backend
Runs on port 3001, handles all data processing operations.
"""

import os
import re
import uuid
import json
import shutil
import sqlite3
import statistics
from pathlib import Path
from typing import Optional

import pandas as pd
import httpx
from fastapi import FastAPI, UploadFile, File, Form, Query, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

# ─── Config ───────────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent.parent.parent  # /home/z/my-project
DOWNLOAD_DIR = BASE_DIR / "download"
DB_PATH = BASE_DIR / "db" / "custom.db"
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB
PORT = 3001

app = FastAPI(title="Excel Suite API", version="1.0.0")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Helpers ──────────────────────────────────────────────────────────────────
def ensure_download_dir():
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)


def sanitize_filename(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]", "_", name)


def get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def read_file_to_df(file: UploadFile, delimiter: str = ",") -> pd.DataFrame:
    """Read an uploaded Excel or CSV file into a pandas DataFrame."""
    content = file.file.read()
    ext = Path(file.filename or "").suffix.lower()

    if ext == ".csv":
        df = pd.read_csv(pd.io.common.BytesIO(content), delimiter=delimiter, dtype=str, keep_default_na=False)
    elif ext in (".xls", ".xlsx"):
        df = pd.read_excel(pd.io.common.BytesIO(content), engine="openpyxl" if ext == ".xlsx" else "xlrd", dtype=str, keep_default_na=False)
    else:
        raise ValueError(f"Unsupported file format: {ext}")

    # Replace pd.NA / NaN with empty string
    df = df.fillna("")
    return df


def save_df_to_file(df: pd.DataFrame, base_name: str, suffix: str, output_format: str = "xlsx", delimiter: str = ",") -> dict:
    """Save DataFrame to a file in the download directory, return file info."""
    ensure_download_dir()
    uid = uuid.uuid4().hex[:8]
    safe_base = sanitize_filename(base_name)

    if output_format == "csv":
        filename = f"{safe_base}_{suffix}_{uid}.csv"
        filepath = DOWNLOAD_DIR / filename
        df.to_csv(filepath, index=False, sep=delimiter)
        mime = "text/csv"
    else:
        filename = f"{safe_base}_{suffix}_{uid}.xlsx"
        filepath = DOWNLOAD_DIR / filename
        df.to_excel(filepath, index=False, engine="openpyxl")
        mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

    return {
        "filename": filename,
        "filepath": str(filepath),
        "size": filepath.stat().st_size,
        "mime": mime,
    }


def record_file(filename: str, original_name: str, mime: str, size: int, tool: str, output_path: str):
    """Insert a file record into the SQLite database."""
    try:
        conn = get_db()
        conn.execute(
            """INSERT INTO FileRecord (id, filename, originalName, mimeType, size, tool, status, outputPath, createdAt, updatedAt)
               VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, datetime('now'), datetime('now'))""",
            (str(uuid.uuid4()), filename, original_name, mime, size, tool, output_path),
        )
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"DB record error: {e}")


def log_error(tool: str, message: str, details: str = ""):
    """Insert an error log entry."""
    try:
        conn = get_db()
        conn.execute(
            """INSERT INTO ErrorLog (id, tool, message, details, createdAt, updatedAt)
               VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))""",
            (str(uuid.uuid4()), tool, message, details),
        )
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"DB error log error: {e}")


def df_to_dicts(df: pd.DataFrame) -> list[dict]:
    """Convert DataFrame to list of dicts, ensuring all values are JSON serializable."""
    result = []
    for _, row in df.iterrows():
        d = {}
        for col in df.columns:
            val = row[col]
            if pd.isna(val):
                d[col] = ""
            elif isinstance(val, (int, float)):
                d[col] = val
            else:
                d[col] = str(val)
        result.append(d)
    return result


# ─── Health Check ─────────────────────────────────────────────────────────────
@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "excel-suite-api"}


# ─── Merge Tool ───────────────────────────────────────────────────────────────
@app.post("/api/tools/merge")
async def merge_files(
    files: list[UploadFile] = File(...),
    outputFormat: str = Form("xlsx"),
    outputFilename: str = Form("merged"),
):
    try:
        if len(files) < 2:
            raise HTTPException(status_code=400, detail="At least 2 files are required")

        all_dfs = []
        all_headers = []

        for f in files:
            df = read_file_to_df(f)
            if not df.empty:
                all_headers.append(list(df.columns))
                all_dfs.append(df)

        merged = pd.concat(all_dfs, ignore_index=True)

        # Check header mismatches
        base_headers = all_headers[0] if all_headers else []
        has_mismatch = any(
            len(h) != len(base_headers) or h != base_headers
            for h in all_headers
        )

        safe_name = sanitize_filename(outputFilename) or "merged"
        info = save_df_to_file(merged, safe_name, "", outputFormat)
        output_name = info["filename"].replace(f"__", f"_{uuid.uuid4().hex[:8]}")  # ensure unique

        record_file(info["filename"], f"{safe_name}.xlsx", info["mime"], info["size"], "merge", info["filepath"])

        return {
            "success": True,
            "downloadUrl": f"/api/tools/download?file={info['filename']}",
            "filename": info["filename"],
            "totalRows": len(merged),
            "headers": base_headers,
            "hasMismatch": has_mismatch,
            "mismatchWarning": "Some files have different headers. Data was merged using all available columns." if has_mismatch else None,
        }
    except HTTPException:
        raise
    except Exception as e:
        log_error("merge", str(e))
        raise HTTPException(status_code=500, detail=str(e))


# ─── Duplicates Tool ──────────────────────────────────────────────────────────
@app.post("/api/tools/duplicates")
async def remove_duplicates(
    file: UploadFile = File(...),
    column: str = Form(...),
    keepOccurrence: str = Form("first"),
):
    try:
        df = read_file_to_df(file)
        if df.empty:
            raise HTTPException(status_code=400, detail="File is empty")
        if column not in df.columns:
            raise HTTPException(status_code=400, detail=f"Column '{column}' not found")

        original_len = len(df)
        keep = "first" if keepOccurrence == "first" else "last"

        # Find duplicates
        duplicates_mask = df.duplicated(subset=[column], keep=keep)
        duplicate_indices = df[duplicates_mask].index.tolist()
        deleted_count = int(duplicates_mask.sum())

        cleaned = df.drop_duplicates(subset=[column], keep=keep).reset_index(drop=True)

        base_name = Path(file.filename or "file").stem
        info = save_df_to_file(cleaned, base_name, "cleaned")

        record_file(info["filename"], file.filename or "", info["mime"], info["size"], "duplicates", info["filepath"])

        deleted_preview = df.loc[duplicate_indices[:10]].to_dict("records") if duplicate_indices else []
        remaining_preview = df_to_dicts(cleaned.head(5))

        return {
            "success": True,
            "downloadUrl": f"/api/tools/download?file={info['filename']}",
            "filename": info["filename"],
            "totalRows": original_len,
            "duplicateRows": deleted_count,
            "remainingRows": len(cleaned),
            "preview": {
                "deleted": deleted_preview,
                "remaining": remaining_preview,
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        log_error("duplicates", str(e))
        raise HTTPException(status_code=500, detail=str(e))


# ─── Convert Tool ─────────────────────────────────────────────────────────────
@app.post("/api/tools/convert")
async def convert_file(
    file: UploadFile = File(...),
    targetFormat: str = Form("xlsx"),
    sheetName: Optional[str] = Form(None),
    delimiter: str = Form(","),
):
    try:
        content = file.file.read()
        ext = Path(file.filename or "").suffix.lower()

        if ext == ".csv":
            df = pd.read_csv(pd.io.common.BytesIO(content), delimiter=delimiter, dtype=str, keep_default_na=False)
            sheets = ["Sheet1"]
        else:
            xls = pd.ExcelFile(pd.io.common.BytesIO(content), engine="openpyxl")
            sheets = xls.sheet_names
            target = sheetName or sheets[0]
            if target not in sheets:
                raise HTTPException(status_code=400, detail=f"Sheet '{target}' not found. Available: {', '.join(sheets)}")
            df = pd.read_excel(xls, sheet_name=target, dtype=str, keep_default_na=False)

        df = df.fillna("")
        base_name = Path(file.filename or "file").stem
        info = save_df_to_file(df, base_name, "", targetFormat, delimiter)

        record_file(info["filename"], file.filename or "", info["mime"], info["size"], "convert", info["filepath"])

        return {
            "success": True,
            "downloadUrl": f"/api/tools/download?file={info['filename']}",
            "filename": info["filename"],
            "sheets": sheets,
        }
    except HTTPException:
        raise
    except Exception as e:
        log_error("convert", str(e))
        raise HTTPException(status_code=500, detail=str(e))


# ─── Stats Tool ───────────────────────────────────────────────────────────────
@app.post("/api/tools/stats")
async def compute_stats(
    file: UploadFile = File(...),
    generateReport: str = Form("false"),
):
    try:
        df = read_file_to_df(file)
        if df.empty:
            raise HTTPException(status_code=400, detail="File is empty")

        stats = []
        for col in df.columns:
            values = df[col].tolist()
            non_empty = [v for v in values if v != "" and v is not None]
            numeric_vals = []
            for v in non_empty:
                try:
                    numeric_vals.append(float(v))
                except (ValueError, TypeError):
                    pass

            distinct = len(set(str(v) for v in non_empty))
            missing = len(values) - len(non_empty)

            # Determine type
            if len(non_empty) == 0:
                col_type = "empty"
            elif len(numeric_vals) == len(non_empty):
                col_type = "numeric"
            elif len(numeric_vals) == 0:
                col_type = "text"
            else:
                col_type = "mixed"

            stat = {
                "column": col,
                "type": col_type,
                "count": len(non_empty),
                "distinct": distinct,
                "missing": missing,
            }

            if col_type in ("numeric", "mixed") and numeric_vals:
                stat["sum"] = round(sum(numeric_vals), 4)
                stat["avg"] = round(statistics.mean(numeric_vals), 4)
                stat["min"] = min(numeric_vals)
                stat["max"] = max(numeric_vals)
                sorted_nums = sorted(numeric_vals)
                n = len(sorted_nums)
                if n % 2 == 0:
                    stat["median"] = round((sorted_nums[n // 2 - 1] + sorted_nums[n // 2]) / 2, 4)
                else:
                    stat["median"] = round(sorted_nums[n // 2], 4)
                if len(numeric_vals) > 1:
                    stat["stdDev"] = round(statistics.stdev(numeric_vals), 4)
                else:
                    stat["stdDev"] = 0.0

            if col_type in ("text", "mixed") and non_empty:
                lengths = [len(str(v)) for v in non_empty]
                stat["minLength"] = min(lengths)
                stat["maxLength"] = max(lengths)

            # Top 5 values
            from collections import Counter
            freq = Counter(str(v) for v in non_empty)
            stat["topValues"] = [{"value": v, "count": c} for v, c in freq.most_common(5)]

            stats.append(stat)

        download_url = None
        report_filename = None
        if generateReport == "true":
            base_name = Path(file.filename or "file").stem
            info = save_df_to_file(pd.DataFrame(), base_name, "stats")
            # Build the report
            summary_data = []
            for s in stats:
                row = {
                    "Column": s["column"],
                    "Type": s["type"],
                    "Count": s["count"],
                    "Distinct": s["distinct"],
                    "Missing": s["missing"],
                    "Sum": s.get("sum", ""),
                    "Average": s.get("avg", ""),
                    "Min": s.get("min", ""),
                    "Max": s.get("max", ""),
                    "Median": s.get("median", ""),
                    "Std Dev": s.get("stdDev", ""),
                    "Min Length": s.get("minLength", ""),
                    "Max Length": s.get("maxLength", ""),
                }
                summary_data.append(row)

            with pd.ExcelWriter(info["filepath"], engine="openpyxl") as writer:
                pd.DataFrame(summary_data).to_excel(writer, sheet_name="Summary", index=False)
                top_rows = []
                for s in stats:
                    for tv in s.get("topValues", []):
                        top_rows.append({
                            "Column": s["column"],
                            "Value": tv["value"],
                            "Count": tv["count"],
                            "Percent of Filled": f"{(tv['count'] / max(s['count'], 1) * 100):.1f}%",
                        })
                if top_rows:
                    pd.DataFrame(top_rows).to_excel(writer, sheet_name="Top Values", index=False)

            # Update file size after writing
            info["size"] = Path(info["filepath"]).stat().st_size

            record_file(info["filename"], file.filename or "", info["mime"], info["size"], "stats", info["filepath"])
            download_url = f"/api/tools/download?file={info['filename']}"
            report_filename = info["filename"]

        return {
            "success": True,
            "totalRows": len(df),
            "totalColumns": len(df.columns),
            "stats": stats,
            "downloadUrl": download_url,
            "filename": report_filename,
        }
    except HTTPException:
        raise
    except Exception as e:
        log_error("stats", str(e))
        raise HTTPException(status_code=500, detail=str(e))


# ─── Sort Tool ────────────────────────────────────────────────────────────────
@app.post("/api/tools/sort")
async def sort_data(
    file: UploadFile = File(...),
    column: str = Form(...),
    order: str = Form("asc"),
):
    try:
        df = read_file_to_df(file)
        if df.empty:
            raise HTTPException(status_code=400, detail="File is empty")
        if column not in df.columns:
            raise HTTPException(status_code=400, detail=f"Column '{column}' not found")

        # Try numeric sort
        try:
            df["_num"] = pd.to_numeric(df[column], errors="coerce")
            has_nums = df["_num"].notna().any()
        except Exception:
            has_nums = False

        ascending = order == "asc"

        if has_nums:
            # Sort numerically first, then string fallback
            df_sorted = df.sort_values(by=["_num" if has_nums else column], ascending=ascending, na_position="last")
            df_sorted = df_sorted.drop(columns=["_num"])
        else:
            df_sorted = df.sort_values(by=column, ascending=ascending, na_position="last")

        df_sorted = df_sorted.reset_index(drop=True)

        base_name = Path(file.filename or "file").stem
        info = save_df_to_file(df_sorted, base_name, "sorted")

        record_file(info["filename"], file.filename or "", info["mime"], info["size"], "sort", info["filepath"])

        return {
            "success": True,
            "downloadUrl": f"/api/tools/download?file={info['filename']}",
            "filename": info["filename"],
            "totalRows": len(df_sorted),
            "sortedBy": column,
            "order": order,
            "preview": df_to_dicts(df_sorted.head(10)),
        }
    except HTTPException:
        raise
    except Exception as e:
        log_error("sort", str(e))
        raise HTTPException(status_code=500, detail=str(e))


# ─── Filter Tool ──────────────────────────────────────────────────────────────
@app.post("/api/tools/filter")
async def filter_data(
    file: UploadFile = File(...),
    conditions: str = Form("[]"),
    combineWith: str = Form("AND"),
):
    try:
        df = read_file_to_df(file)
        if df.empty:
            raise HTTPException(status_code=400, detail="File is empty")

        try:
            conds = json.loads(conditions)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid conditions JSON")

        if not conds:
            raise HTTPException(status_code=400, detail="At least one filter condition is required")

        # Validate columns
        for c in conds:
            if c.get("column") not in df.columns:
                raise HTTPException(status_code=400, detail=f"Column '{c.get('column')}' not found in the file")

        def apply_condition(row, cond):
            col = cond["column"]
            op = cond["operator"]
            val = cond.get("value", "")
            cell = str(row.get(col, ""))

            if op == "equals":
                try:
                    a, b = float(cell), float(val)
                    if val != "":
                        return a == b
                except ValueError:
                    pass
                return cell == val
            elif op == "not_equals":
                try:
                    a, b = float(cell), float(val)
                    if val != "":
                        return a != b
                except ValueError:
                    pass
                return cell != val
            elif op == "contains":
                return val.lower() in cell.lower()
            elif op == "not_contains":
                return val.lower() not in cell.lower()
            elif op == "starts_with":
                return cell.lower().startswith(val.lower())
            elif op == "ends_with":
                return cell.lower().endswith(val.lower())
            elif op == "greater_than":
                try:
                    return float(cell) > float(val)
                except ValueError:
                    return cell > val
            elif op == "less_than":
                try:
                    return float(cell) < float(val)
                except ValueError:
                    return cell < val
            elif op == "greater_or_equal":
                try:
                    return float(cell) >= float(val)
                except ValueError:
                    return cell >= val
            elif op == "less_or_equal":
                try:
                    return float(cell) <= float(val)
                except ValueError:
                    return cell <= val
            elif op == "is_empty":
                return cell.strip() == ""
            elif op == "is_not_empty":
                return cell.strip() != ""
            return True

        dicts = df.to_dict("records")
        if combineWith == "OR":
            filtered_dicts = [r for r in dicts if any(apply_condition(r, c) for c in conds)]
        else:
            filtered_dicts = [r for r in dicts if all(apply_condition(r, c) for c in conds)]

        filtered_df = pd.DataFrame(filtered_dicts) if filtered_dicts else pd.DataFrame(columns=df.columns)

        base_name = Path(file.filename or "file").stem
        info = save_df_to_file(filtered_df, base_name, "filtered")

        record_file(info["filename"], file.filename or "", info["mime"], info["size"], "filter", info["filepath"])

        return {
            "success": True,
            "downloadUrl": f"/api/tools/download?file={info['filename']}",
            "filename": info["filename"],
            "totalRows": len(df),
            "matchedRows": len(filtered_dicts),
            "removedRows": len(df) - len(filtered_dicts),
            "conditions": conds,
            "combineWith": combineWith,
            "preview": filtered_dicts[:10],
        }
    except HTTPException:
        raise
    except Exception as e:
        log_error("filter", str(e))
        raise HTTPException(status_code=500, detail=str(e))


# ─── Replace Tool ─────────────────────────────────────────────────────────────
@app.post("/api/tools/replace")
async def find_replace(
    file: UploadFile = File(...),
    find: str = Form(""),
    replace: str = Form(""),
    columns: str = Form("[]"),
    matchMode: str = Form("contains"),
    caseSensitive: str = Form("false"),
    useRegex: str = Form("false"),
):
    try:
        df = read_file_to_df(file)
        if df.empty:
            raise HTTPException(status_code=400, detail="File is empty")
        if not find:
            raise HTTPException(status_code=400, detail="Find text is required")

        try:
            scope_columns = json.loads(columns)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid columns JSON")

        all_columns = list(df.columns)
        target_columns = [c for c in scope_columns if c in all_columns] if scope_columns else all_columns

        if not target_columns:
            raise HTTPException(status_code=400, detail="No matching columns found in scope")

        # Build regex pattern
        flags = 0 if caseSensitive == "true" else re.IGNORECASE
        try:
            if useRegex == "true":
                pattern = re.compile(find, flags)
            else:
                escaped = re.escape(find)
                if matchMode == "exact":
                    pattern = re.compile(f"^{escaped}$", flags)
                elif matchMode == "startsWith":
                    pattern = re.compile(f"^{escaped}", flags)
                elif matchMode == "endsWith":
                    pattern = re.compile(f"{escaped}$", flags)
                else:  # contains
                    pattern = re.compile(escaped, flags)
        except re.error:
            raise HTTPException(status_code=400, detail="Invalid regular expression pattern")

        total_matches = 0
        cells_changed = 0
        rows_affected = set()
        changes = []

        for idx, row in df.iterrows():
            for col in target_columns:
                original = str(row[col])
                new_val, count = pattern.subn(replace, original)
                if count > 0:
                    total_matches += count
                    cells_changed += 1
                    rows_affected.add(idx)
                    df.at[idx, col] = new_val
                    if len(changes) < 50:
                        changes.append({
                            "row": idx + 1,
                            "column": col,
                            "before": original[:80] + "..." if len(original) > 80 else original,
                            "after": new_val[:80] + "..." if len(new_val) > 80 else new_val,
                        })

        base_name = Path(file.filename or "file").stem
        info = save_df_to_file(df, base_name, "replaced")

        record_file(info["filename"], file.filename or "", info["mime"], info["size"], "replace", info["filepath"])

        return {
            "success": True,
            "downloadUrl": f"/api/tools/download?file={info['filename']}",
            "filename": info["filename"],
            "totalRows": len(df),
            "scopedColumns": target_columns,
            "matchMode": "regex" if useRegex == "true" else matchMode,
            "caseSensitive": caseSensitive == "true",
            "totalMatches": total_matches,
            "cellsChanged": cells_changed,
            "rowsAffected": len(rows_affected),
            "changes": changes,
            "preview": df_to_dicts(df.head(10)),
        }
    except HTTPException:
        raise
    except Exception as e:
        log_error("replace", str(e))
        raise HTTPException(status_code=500, detail=str(e))


# ─── Transpose Tool ───────────────────────────────────────────────────────────
@app.post("/api/tools/transpose")
async def transpose_data(
    file: UploadFile = File(...),
    mode: str = Form("transpose"),
    idColumns: str = Form("[]"),
    varName: str = Form("variable"),
    valueName: str = Form("value"),
):
    try:
        df = read_file_to_df(file)
        if df.empty:
            raise HTTPException(status_code=400, detail="File is empty")

        columns = list(df.columns)

        if mode not in ("transpose", "unpivot"):
            raise HTTPException(status_code=400, detail="Invalid mode. Use 'transpose' or 'unpivot'.")

        if mode == "transpose":
            # Classic transpose: columns become rows
            transposed = df.T.reset_index()
            transposed.columns = ["Column"] + [f"Row {i+1}" for i in range(len(df))]
            result_df = transposed
            output_columns = list(result_df.columns)
        else:
            # Unpivot (wide-to-long)
            try:
                id_cols = json.loads(idColumns)
            except json.JSONDecodeError:
                raise HTTPException(status_code=400, detail="Invalid idColumns JSON")

            if not id_cols:
                raise HTTPException(status_code=400, detail="Select at least one ID column to keep fixed for unpivot")

            for c in id_cols:
                if c not in columns:
                    raise HTTPException(status_code=400, detail=f"ID column '{c}' not found")

            value_cols = [c for c in columns if c not in id_cols]
            if not value_cols:
                raise HTTPException(status_code=400, detail="No value columns to unpivot (all columns are ID columns)")

            result_df = df.melt(id_vars=id_cols, value_vars=value_cols, var_name=varName, value_name=valueName)
            output_columns = list(result_df.columns)

        base_name = Path(file.filename or "file").stem
        suffix = "transposed" if mode == "transpose" else "unpivoted"
        info = save_df_to_file(result_df, base_name, suffix)

        record_file(info["filename"], file.filename or "", info["mime"], info["size"], "transpose", info["filepath"])

        return {
            "success": True,
            "downloadUrl": f"/api/tools/download?file={info['filename']}",
            "filename": info["filename"],
            "mode": mode,
            "inputRows": len(df),
            "inputColumns": len(columns),
            "outputRows": len(result_df),
            "outputColumns": output_columns,
            "preview": df_to_dicts(result_df.head(20)),
        }
    except HTTPException:
        raise
    except Exception as e:
        log_error("transpose", str(e))
        raise HTTPException(status_code=500, detail=str(e))


# ─── Pivot Tool ───────────────────────────────────────────────────────────────
@app.post("/api/tools/pivot")
async def pivot_data(
    file: UploadFile = File(...),
    groupBy: str = Form("[]"),
    aggregations: str = Form("[]"),
):
    try:
        df = read_file_to_df(file)
        if df.empty:
            raise HTTPException(status_code=400, detail="File is empty")

        try:
            group_by_cols = json.loads(groupBy)
            aggs = json.loads(aggregations)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid groupBy or aggregations JSON")

        if not group_by_cols:
            raise HTTPException(status_code=400, detail="Select at least one column to group by")
        if not aggs:
            raise HTTPException(status_code=400, detail="Add at least one aggregation")

        # Validate columns
        for c in group_by_cols:
            if c not in df.columns:
                raise HTTPException(status_code=400, detail=f"Group-by column '{c}' not found")
        for a in aggs:
            if a.get("function") != "count" and a.get("column") not in df.columns:
                raise HTTPException(status_code=400, detail=f"Aggregation column '{a.get('column')}' not found")

        # Build aggregation dict for pandas
        agg_dict = {}
        rename_map = {}
        for a in aggs:
            col = a["column"]
            fn = a["function"]
            alias = a.get("alias") or f"{col}_{fn}"

            # Map function names
            pandas_fn = {
                "sum": "sum",
                "avg": "mean",
                "count": "count",
                "count_distinct": "nunique",
                "min": "min",
                "max": "max",
                "first": "first",
                "last": "last",
            }.get(fn, "count")

            key = f"{col}_{fn}_{alias}"
            agg_dict[key] = pd.NamedAgg(column=col, aggfunc=pandas_fn)
            rename_map[key] = alias

        # Convert numeric columns for aggregation
        for a in aggs:
            col = a["column"]
            if a["function"] in ("sum", "avg", "min", "max"):
                df[col] = pd.to_numeric(df[col], errors="coerce")

        grouped = df.groupby(group_by_cols, dropna=False).agg(**agg_dict).reset_index()
        grouped = grouped.rename(columns=rename_map)

        # Sort by first group-by column
        first_col = group_by_cols[0]
        try:
            grouped[first_col] = pd.to_numeric(grouped[first_col], errors="coerce")
            grouped = grouped.sort_values(first_col, ascending=True, na_position="last")
        except Exception:
            grouped = grouped.sort_values(first_col, ascending=True, na_position="last")

        grouped = grouped.reset_index(drop=True)

        base_name = Path(file.filename or "file").stem
        info = save_df_to_file(grouped, base_name, "pivot")

        record_file(info["filename"], file.filename or "", info["mime"], info["size"], "pivot", info["filepath"])

        return {
            "success": True,
            "downloadUrl": f"/api/tools/download?file={info['filename']}",
            "filename": info["filename"],
            "totalRows": len(df),
            "groupCount": len(grouped),
            "groupBy": group_by_cols,
            "aggregations": aggs,
            "preview": df_to_dicts(grouped.head(20)),
        }
    except HTTPException:
        raise
    except Exception as e:
        log_error("pivot", str(e))
        raise HTTPException(status_code=500, detail=str(e))


# ─── Validate Tool ────────────────────────────────────────────────────────────
@app.post("/api/tools/validate")
async def validate_data(
    file: UploadFile = File(...),
    checks: str = Form("[]"),
    primaryKey: str = Form(""),
    emailColumns: str = Form("[]"),
    urlColumns: str = Form("[]"),
    dateColumns: str = Form("[]"),
):
    try:
        df = read_file_to_df(file)
        if df.empty:
            raise HTTPException(status_code=400, detail="File is empty")

        try:
            check_list = json.loads(checks) or [
                "empty_cells", "mixed_types", "duplicate_keys", "email_format",
                "url_format", "date_format", "constant_columns", "whitespace",
                "unique_counts", "outliers"
            ]
            email_cols = json.loads(emailColumns) or []
            url_cols = json.loads(urlColumns) or []
            date_cols = json.loads(dateColumns) or []
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid JSON parameter")

        issues = []
        column_reports = []

        email_re = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
        url_re = re.compile(r"^(https?://|www\.)[^\s]+$", re.IGNORECASE)
        date_re = re.compile(r"^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?Z?)?$")

        for col in df.columns:
            values = df[col].tolist()
            non_empty = [v for v in values if v != "" and v is not None]
            empty_cells = len(values) - len(non_empty)
            whitespace_only = sum(1 for v in values if isinstance(v, str) and v != "" and v.strip() == "")
            unique_set = set(str(v) for v in non_empty)

            # Detect type
            nums = 0
            texts = 0
            dates_count = 0
            bools = 0
            for v in non_empty:
                try:
                    float(v)
                    nums += 1
                    continue
                except (ValueError, TypeError):
                    pass
                if str(v).lower() in ("true", "false"):
                    bools += 1
                    continue
                if date_re.match(str(v)):
                    dates_count += 1
                    continue
                texts += 1

            total_nonempty = len(non_empty) or 1
            if not non_empty:
                detected_type = "text"
            elif nums == len(non_empty):
                detected_type = "number"
            elif texts == len(non_empty):
                detected_type = "text"
            elif dates_count == len(non_empty):
                detected_type = "date"
            elif bools == len(non_empty):
                detected_type = "boolean"
            else:
                detected_type = "mixed"

            is_constant = len(non_empty) > 0 and len(unique_set) == 1

            report = {
                "column": col,
                "totalCells": len(values),
                "emptyCells": empty_cells,
                "whitespaceOnly": whitespace_only,
                "uniqueValues": len(unique_set),
                "detectedType": detected_type,
                "isConstant": is_constant,
            }

            # Min/max/mean
            if detected_type == "number" and non_empty:
                num_vals = [float(v) for v in non_empty]
                report["min"] = min(num_vals)
                report["max"] = max(num_vals)
                report["mean"] = round(sum(num_vals) / len(num_vals), 4)
            elif non_empty:
                str_vals = [str(v) for v in non_empty]
                report["min"] = min(str_vals)
                report["max"] = max(str_vals)

            column_reports.append(report)

            # Run checks
            if "empty_cells" in check_list:
                for i, v in enumerate(values):
                    if v == "" or v is None:
                        issues.append({"row": i + 1, "column": col, "value": v, "message": "Empty cell", "severity": "info"})

            if "whitespace" in check_list:
                for i, v in enumerate(values):
                    if isinstance(v, str) and v != "" and v.strip() == "":
                        issues.append({"row": i + 1, "column": col, "value": v, "message": "Whitespace-only cell", "severity": "warning"})

            if "mixed_types" in check_list and detected_type == "mixed":
                for i, v in enumerate(values):
                    if v == "" or v is None:
                        continue
                    try:
                        float(v)
                    except (ValueError, TypeError):
                        issues.append({
                            "row": i + 1, "column": col, "value": v,
                            "message": "Non-numeric value in mostly-numeric column (detected type: mixed)",
                            "severity": "warning"
                        })

            if "constant_columns" in check_list and is_constant:
                issues.append({
                    "row": 0, "column": col, "value": non_empty[0],
                    "message": f'Column is constant — every non-empty cell is "{non_empty[0]}"',
                    "severity": "info"
                })

            if "outliers" in check_list and detected_type == "number" and len(non_empty) >= 4:
                num_vals = []
                for i, v in enumerate(values):
                    try:
                        num_vals.append((i, float(v)))
                    except (ValueError, TypeError):
                        pass
                if len(num_vals) >= 4:
                    nums_sorted = sorted([n for _, n in num_vals])
                    mid = len(nums_sorted) // 2
                    q1 = nums_sorted[mid // 2]
                    q3 = nums_sorted[mid + (len(nums_sorted) - mid) // 2]
                    iqr = q3 - q1
                    lower = q1 - 1.5 * iqr
                    upper = q3 + 1.5 * iqr
                    for idx, val in num_vals:
                        if val < lower or val > upper:
                            issues.append({
                                "row": idx + 1, "column": col, "value": val,
                                "message": "Statistical outlier (outside 1.5 × IQR)",
                                "severity": "warning"
                            })

            if "email_format" in check_list and col in email_cols:
                for i, v in enumerate(values):
                    if v == "" or v is None:
                        continue
                    if not email_re.match(str(v)):
                        issues.append({"row": i + 1, "column": col, "value": v, "message": "Invalid email format", "severity": "error"})

            if "url_format" in check_list and col in url_cols:
                for i, v in enumerate(values):
                    if v == "" or v is None:
                        continue
                    if not url_re.match(str(v)):
                        issues.append({"row": i + 1, "column": col, "value": v, "message": "Invalid URL format", "severity": "error"})

            if "date_format" in check_list and col in date_cols:
                for i, v in enumerate(values):
                    if v == "" or v is None:
                        continue
                    if not date_re.match(str(v)):
                        issues.append({"row": i + 1, "column": col, "value": v, "message": "Invalid date format (expected YYYY-MM-DD)", "severity": "error"})

        # Duplicate keys
        if "duplicate_keys" in check_list and primaryKey:
            if primaryKey not in df.columns:
                raise HTTPException(status_code=400, detail=f"Primary key column '{primaryKey}' not found")
            seen = {}
            for i, row in df.iterrows():
                v = str(row[primaryKey])
                if v == "":
                    continue
                if v not in seen:
                    seen[v] = []
                seen[v].append(i + 1)
            for v, rows in seen.items():
                if len(rows) > 1:
                    issues.append({
                        "row": rows[0], "column": primaryKey, "value": v,
                        "message": f'Duplicate primary key "{v}" appears in rows: {", ".join(map(str, rows))}',
                        "severity": "error"
                    })

        # Summary
        total_cells = len(df) * len(df.columns)
        summary = {
            "totalRows": len(df),
            "totalColumns": len(df.columns),
            "totalCells": total_cells,
            "emptyCells": sum(r["emptyCells"] for r in column_reports),
            "uniqueIssues": len(issues),
            "errors": sum(1 for i in issues if i["severity"] == "error"),
            "warnings": sum(1 for i in issues if i["severity"] == "warning"),
            "infos": sum(1 for i in issues if i["severity"] == "info"),
            "constantColumns": sum(1 for r in column_reports if r["isConstant"]),
            "mixedTypeColumns": sum(1 for r in column_reports if r["detectedType"] == "mixed"),
        }

        overall_score = max(0, round(100 - ((summary["errors"] * 5 + summary["warnings"] * 2 + summary["infos"] * 0.5) / max(1, total_cells)) * 100))

        # Build Excel report
        base_name = Path(file.filename or "file").stem
        info = save_df_to_file(pd.DataFrame(), base_name, "validation")

        with pd.ExcelWriter(info["filepath"], engine="openpyxl") as writer:
            # Summary sheet
            summary_data = [
                {"Metric": "Total Rows", "Value": summary["totalRows"]},
                {"Metric": "Total Columns", "Value": summary["totalColumns"]},
                {"Metric": "Total Cells", "Value": summary["totalCells"]},
                {"Metric": "Empty Cells", "Value": summary["emptyCells"]},
                {"Metric": "Constant Columns", "Value": summary["constantColumns"]},
                {"Metric": "Mixed-Type Columns", "Value": summary["mixedTypeColumns"]},
                {"Metric": "Errors", "Value": summary["errors"]},
                {"Metric": "Warnings", "Value": summary["warnings"]},
                {"Metric": "Info", "Value": summary["infos"]},
                {"Metric": "Total Issues", "Value": summary["uniqueIssues"]},
                {"Metric": "Quality Score", "Value": f"{overall_score}/100"},
            ]
            pd.DataFrame(summary_data).to_excel(writer, sheet_name="Summary", index=False)

            # Column reports
            col_data = []
            for r in column_reports:
                col_data.append({
                    "Column": r["column"], "Type": r["detectedType"],
                    "Total Cells": r["totalCells"], "Empty Cells": r["emptyCells"],
                    "Whitespace-only": r["whitespaceOnly"], "Unique Values": r["uniqueValues"],
                    "Constant": "Yes" if r["isConstant"] else "No",
                    "Min": r.get("min", ""), "Max": r.get("max", ""), "Mean": r.get("mean", ""),
                })
            pd.DataFrame(col_data).to_excel(writer, sheet_name="Columns", index=False)

            # Issues
            issue_data = [{"Row": i["row"], "Column": i["column"], "Value": str(i["value"]), "Severity": i["severity"], "Message": i["message"]} for i in issues[:1000]]
            if issue_data:
                pd.DataFrame(issue_data).to_excel(writer, sheet_name="Issues", index=False)

        info["size"] = Path(info["filepath"]).stat().st_size
        record_file(info["filename"], file.filename or "", info["mime"], info["size"], "validate", info["filepath"])

        return {
            "success": True,
            "downloadUrl": f"/api/tools/download?file={info['filename']}",
            "filename": info["filename"],
            "summary": summary,
            "overallScore": overall_score,
            "columnReports": column_reports,
            "issues": issues[:200],
            "checksRun": check_list,
        }
    except HTTPException:
        raise
    except Exception as e:
        log_error("validate", str(e))
        raise HTTPException(status_code=500, detail=str(e))


# ─── Attendance Tool ──────────────────────────────────────────────────────────
@app.post("/api/tools/attendance")
async def check_attendance(
    file: UploadFile = File(...),
    column: str = Form(...),
    rollNumber: str = Form(...),
):
    try:
        df = read_file_to_df(file)
        if df.empty:
            raise HTTPException(status_code=400, detail="File is empty")
        if column not in df.columns:
            raise HTTPException(status_code=400, detail=f"Column '{column}' not found")

        student_rows = df[df[column].astype(str).str.strip() == rollNumber.strip()]
        if student_rows.empty:
            raise HTTPException(status_code=404, detail=f"No records found for roll number: {rollNumber}")

        all_columns = list(df.columns)
        class_columns = [c for c in all_columns if c != column]

        if class_columns:
            student_record = student_rows.iloc[0]
            total = len(class_columns)
            present = 0
            details = []

            for col in class_columns:
                val = str(student_record[col] or "").strip().lower()
                is_present = val in ("present", "p", "1", "yes", "true")
                if is_present:
                    present += 1
                details.append({"class": col, "status": str(student_record[col] or "N/A")})

            report = {
                "rollNumber": rollNumber,
                "totalClasses": total,
                "presentCount": present,
                "absentCount": total - present,
                "attendancePercentage": f"{(present / total * 100):.2f}" if total > 0 else "0.00",
                "details": details,
            }
        else:
            total_classes = len(df)
            present_count = len(student_rows)
            report = {
                "rollNumber": rollNumber,
                "totalClasses": total_classes,
                "presentCount": present_count,
                "absentCount": total_classes - present_count,
                "attendancePercentage": f"{(present_count / total_classes * 100):.2f}" if total_classes > 0 else "0.00",
            }

        return {"success": True, "report": report}
    except HTTPException:
        raise
    except Exception as e:
        log_error("attendance", str(e))
        raise HTTPException(status_code=500, detail=str(e))


# ─── Preview / Columns ────────────────────────────────────────────────────────
@app.post("/api/tools/preview")
async def preview_file(
    file: UploadFile = File(...),
):
    try:
        content = file.file.read()
        ext = Path(file.filename or "").suffix.lower()

        if ext == ".csv":
            xls = pd.ExcelFile(pd.io.common.BytesIO(content), engine="openpyxl") if ext != ".csv" else None
            df = pd.read_csv(pd.io.common.BytesIO(content), dtype=str, keep_default_na=False)
            sheets = [{"name": "Sheet1", "columns": list(df.columns), "rowCount": len(df)}]
        else:
            xls = pd.ExcelFile(pd.io.common.BytesIO(content), engine="openpyxl")
            sheets = []
            for name in xls.sheet_names:
                sheet_df = pd.read_excel(xls, sheet_name=name, dtype=str, keep_default_na=False).fillna("")
                sheets.append({"name": name, "columns": list(sheet_df.columns), "rowCount": len(sheet_df)})

        preview = df_to_dicts(sheets[0].head(5)) if sheets and sheets[0]["rowCount"] > 0 else [] if ext == ".csv" else (
            df_to_dicts(pd.read_excel(xls, sheet_name=sheets[0]["name"], dtype=str, keep_default_na=False).fillna("").head(5)) if sheets else []
        )

        # Re-read the first sheet for preview
        if ext != ".csv" and sheets:
            first_df = pd.read_excel(xls, sheet_name=sheets[0]["name"], dtype=str, keep_default_na=False).fillna("")
            preview = df_to_dicts(first_df.head(5))

        return {
            "success": True,
            "sheets": sheets,
            "preview": preview,
        }
    except Exception as e:
        log_error("preview", str(e))
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/tools/columns")
async def get_columns(
    file: UploadFile = File(...),
):
    """Return sheets info + preview matching the old Next.js API format.
    Frontend expects: { success, sheets: [{ name, columns, rowCount }], preview: [...] }
    """
    try:
        content = file.file.read()
        ext = Path(file.filename or "").suffix.lower()

        if ext == ".csv":
            df = pd.read_csv(pd.io.common.BytesIO(content), dtype=str, keep_default_na=False)
            df = df.fillna("")
            sheets = [{"name": "Sheet1", "columns": list(df.columns), "rowCount": len(df)}]
            preview = df_to_dicts(df.head(5))
        else:
            xls = pd.ExcelFile(pd.io.common.BytesIO(content), engine="openpyxl")
            sheets = []
            preview = []
            for name in xls.sheet_names:
                sheet_df = pd.read_excel(xls, sheet_name=name, dtype=str, keep_default_na=False).fillna("")
                sheets.append({"name": name, "columns": list(sheet_df.columns), "rowCount": len(sheet_df)})
            # Preview from first sheet
            if sheets:
                first_df = pd.read_excel(xls, sheet_name=sheets[0]["name"], dtype=str, keep_default_na=False).fillna("")
                preview = df_to_dicts(first_df.head(5))

        return {
            "success": True,
            "sheets": sheets,
            "preview": preview,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Download File ────────────────────────────────────────────────────────────
@app.get("/api/tools/download")
async def download_file(file: str = Query(...)):
    try:
        safe_name = Path(file).name  # Prevent path traversal
        filepath = DOWNLOAD_DIR / safe_name

        if not filepath.is_file():
            raise HTTPException(status_code=404, detail="File not found")

        ext = filepath.suffix.lower()
        media_type = "application/octet-stream"
        if ext == ".xlsx":
            media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        elif ext == ".csv":
            media_type = "text/csv"

        return FileResponse(
            filepath,
            media_type=media_type,
            filename=safe_name,
            headers={"Content-Disposition": f'attachment; filename="{safe_name}"'},
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="Download failed")


# ─── Download Excel from URL ─────────────────────────────────────────────────
@app.post("/api/tools/download-excel")
async def download_excel_from_url(request: Request):
    try:
        body = await request.json()
        url = body.get("url", "")
        filename = body.get("filename", "")

        if not url:
            raise HTTPException(status_code=400, detail="URL is required")

        try:
            parsed = httpx.URL(url)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid URL format")

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url, headers={"User-Agent": "ExcelSuite/1.0"}, follow_redirects=True)
            response.raise_for_status()

        content = response.content
        if len(content) > MAX_FILE_SIZE:
            raise HTTPException(status_code=400, detail="Downloaded file exceeds 50MB limit")

        ensure_download_dir()
        url_filename = Path(str(parsed.path)).name or "download"
        uid = uuid.uuid4().hex[:8]
        ext = Path(url_filename).suffix or ".xlsx"
        output_name = f"{sanitize_filename(filename or url_filename)}_{uid}{ext}"
        filepath = DOWNLOAD_DIR / output_name

        filepath.write_bytes(content)

        record_file(output_name, filename or url_filename, "application/octet-stream", len(content), "download-excel", str(filepath))

        return {
            "success": True,
            "downloadUrl": f"/api/tools/download?file={output_name}",
            "filename": output_name,
            "size": len(content),
        }
    except HTTPException:
        raise
    except Exception as e:
        log_error("download-excel", str(e))
        raise HTTPException(status_code=500, detail=str(e))


# ─── Download Images ──────────────────────────────────────────────────────────
@app.post("/api/tools/download-images")
async def download_images(
    file: UploadFile = File(...),
    urlColumn: str = Form(...),
):
    try:
        df = read_file_to_df(file)
        if df.empty:
            raise HTTPException(status_code=400, detail="File is empty")

        results = []
        success_count = 0
        fail_count = 0

        async with httpx.AsyncClient(timeout=10.0) as client:
            for i, row in df.iterrows():
                url = str(row.get(urlColumn, "")).strip()
                if not url:
                    results.append({"row": i + 1, "url": "", "status": "skipped", "error": "No URL"})
                    continue

                try:
                    resp = await client.get(url, headers={"User-Agent": "ExcelSuite/1.0"}, follow_redirects=True)
                    resp.raise_for_status()
                    content_type = resp.headers.get("content-type", "")
                    if not content_type.startswith("image/"):
                        raise Exception(f"Not an image: {content_type}")

                    df.at[i, urlColumn] = f"✓ {url}"
                    success_count += 1
                    results.append({"row": i + 1, "url": url, "status": "success"})
                except Exception as err:
                    fail_count += 1
                    results.append({"row": i + 1, "url": url, "status": "failed", "error": str(err)})

        base_name = Path(file.filename or "file").stem
        info = save_df_to_file(df, base_name, "images")

        # Also save results sheet
        results_df = pd.DataFrame(results)
        output_path = Path(info["filepath"])
        with pd.ExcelWriter(output_path, engine="openpyxl") as writer:
            df.to_excel(writer, sheet_name="With Images", index=False)
            results_df.to_excel(writer, sheet_name="Download Results", index=False)

        info["size"] = output_path.stat().st_size
        record_file(info["filename"], file.filename or "", info["mime"], info["size"], "download-images", info["filepath"])

        return {
            "success": True,
            "downloadUrl": f"/api/tools/download?file={info['filename']}",
            "filename": info["filename"],
            "totalRows": len(df),
            "successCount": success_count,
            "failCount": fail_count,
            "results": results[:100],
        }
    except HTTPException:
        raise
    except Exception as e:
        log_error("download-images", str(e))
        raise HTTPException(status_code=500, detail=str(e))


# ─── History ──────────────────────────────────────────────────────────────────
@app.get("/api/tools/history")
async def get_history():
    try:
        conn = get_db()
        rows = conn.execute(
            "SELECT * FROM FileRecord ORDER BY createdAt DESC LIMIT 50"
        ).fetchall()
        conn.close()
        records = [dict(r) for r in rows]
        return {"success": True, "records": records}
    except Exception as e:
        raise HTTPException(status_code=500, detail="Failed to fetch history")


@app.delete("/api/tools/history")
async def delete_history(id: Optional[str] = Query(None)):
    try:
        conn = get_db()
        if id:
            record = conn.execute("SELECT * FROM FileRecord WHERE id = ?", (id,)).fetchone()
            if not record:
                conn.close()
                raise HTTPException(status_code=404, detail="Record not found")
            # Delete file from disk
            if record["outputPath"]:
                try:
                    Path(record["outputPath"]).unlink()
                except Exception:
                    pass
            conn.execute("DELETE FROM FileRecord WHERE id = ?", (id,))
            conn.commit()
            conn.close()
            return {"success": True, "message": "Record deleted"}
        else:
            # Delete all
            records = conn.execute("SELECT outputPath FROM FileRecord").fetchall()
            for r in records:
                if r["outputPath"]:
                    try:
                        Path(r["outputPath"]).unlink()
                    except Exception:
                        pass
            count = len(records)
            conn.execute("DELETE FROM FileRecord")
            conn.commit()
            conn.close()
            return {"success": True, "message": f"Cleared {count} records"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Error Logs ───────────────────────────────────────────────────────────────
@app.get("/api/tools/errors")
async def get_errors():
    try:
        conn = get_db()
        rows = conn.execute(
            "SELECT * FROM ErrorLog ORDER BY createdAt DESC LIMIT 50"
        ).fetchall()
        conn.close()
        records = [dict(r) for r in rows]
        return {"success": True, "records": records}
    except Exception as e:
        raise HTTPException(status_code=500, detail="Failed to fetch error logs")


# ─── Run ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    ensure_download_dir()
    uvicorn.run(app, host="0.0.0.0", port=PORT)
