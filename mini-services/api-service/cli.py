#!/usr/bin/env python3
"""
Excel Suite - Python CLI Tool
Invoked as a subprocess by Next.js API routes.
Each call processes a single request and outputs JSON to stdout.

Usage: python3 cli.py <tool> <json_args_file>
"""

import sys
import json
import os
import re
import uuid
import statistics
from pathlib import Path
from collections import Counter

import pandas as pd

# Config
BASE_DIR = Path(__file__).resolve().parent.parent.parent
DOWNLOAD_DIR = BASE_DIR / "download"
DB_PATH = BASE_DIR / "db" / "custom.db"


def ensure_download_dir():
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)


def sanitize_filename(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]", "_", name)


def get_db():
    import sqlite3
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def record_file(filename, original_name, mime, size, tool, output_path):
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
        print(f"DB record error: {e}", file=sys.stderr)


def log_error(tool, message, details=""):
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
        print(f"DB error log error: {e}", file=sys.stderr)


def df_to_dicts(df: pd.DataFrame) -> list[dict]:
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


def save_df_to_file(df, base_name, suffix, output_format="xlsx", delimiter=","):
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

    return {"filename": filename, "filepath": str(filepath), "size": filepath.stat().st_size, "mime": mime}


def read_file_to_df(filepath, delimiter=","):
    ext = Path(filepath).suffix.lower()
    if ext == ".csv":
        df = pd.read_csv(filepath, delimiter=delimiter, dtype=str, keep_default_na=False)
    else:
        df = pd.read_excel(filepath, engine="openpyxl", dtype=str, keep_default_na=False)
    df = df.fillna("")
    return df


# ─── Tool implementations ──────────────────────────────────────────────────────

def tool_merge(args):
    files = args.get("files", [])
    output_format = args.get("outputFormat", "xlsx")
    output_filename = args.get("outputFilename", "merged")

    if len(files) < 2:
        return {"error": "At least 2 files are required"}

    all_dfs = []
    all_headers = []
    for f in files:
        df = read_file_to_df(f)
        if not df.empty:
            all_headers.append(list(df.columns))
            all_dfs.append(df)

    merged = pd.concat(all_dfs, ignore_index=True)
    base_headers = all_headers[0] if all_headers else []
    has_mismatch = any(len(h) != len(base_headers) or h != base_headers for h in all_headers)

    safe_name = sanitize_filename(output_filename) or "merged"
    info = save_df_to_file(merged, safe_name, "", output_format)
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


def tool_columns(args):
    filepath = args.get("filepath", "")
    if not filepath:
        return {"error": "File path is required"}

    ext = Path(filepath).suffix.lower()
    if ext == ".csv":
        df = pd.read_csv(filepath, dtype=str, keep_default_na=False).fillna("")
        sheets = [{"name": "Sheet1", "columns": list(df.columns), "rowCount": len(df)}]
        preview = df_to_dicts(df.head(5))
    else:
        xls = pd.ExcelFile(filepath, engine="openpyxl")
        sheets = []
        preview = []
        for name in xls.sheet_names:
            sheet_df = pd.read_excel(xls, sheet_name=name, dtype=str, keep_default_na=False).fillna("")
            sheets.append({"name": name, "columns": list(sheet_df.columns), "rowCount": len(sheet_df)})
        if sheets:
            first_df = pd.read_excel(xls, sheet_name=sheets[0]["name"], dtype=str, keep_default_na=False).fillna("")
            preview = df_to_dicts(first_df.head(5))

    return {"success": True, "sheets": sheets, "preview": preview}


def tool_duplicates(args):
    filepath = args.get("filepath", "")
    column = args.get("column", "")
    keep = args.get("keepOccurrence", "first")

    if not filepath or not column:
        return {"error": "File and column are required"}

    df = read_file_to_df(filepath)
    if df.empty:
        return {"error": "File is empty"}

    original_len = len(df)
    keep_val = "first" if keep == "first" else "last"
    duplicates_mask = df.duplicated(subset=[column], keep=keep_val)
    deleted_count = int(duplicates_mask.sum())
    cleaned = df.drop_duplicates(subset=[column], keep=keep_val).reset_index(drop=True)

    base_name = Path(filepath).stem
    info = save_df_to_file(cleaned, base_name, "cleaned")
    record_file(info["filename"], args.get("originalName", ""), info["mime"], info["size"], "duplicates", info["filepath"])

    deleted_preview = df_to_dicts(df[duplicates_mask].head(10))
    remaining_preview = df_to_dicts(cleaned.head(5))

    return {
        "success": True,
        "downloadUrl": f"/api/tools/download?file={info['filename']}",
        "filename": info["filename"],
        "totalRows": original_len,
        "duplicateRows": deleted_count,
        "remainingRows": len(cleaned),
        "preview": {"deleted": deleted_preview, "remaining": remaining_preview},
    }


def tool_convert(args):
    filepath = args.get("filepath", "")
    target_format = args.get("targetFormat", "xlsx")
    delimiter = args.get("delimiter", ",")

    if not filepath:
        return {"error": "File is required"}

    ext = Path(filepath).suffix.lower()
    if ext == ".csv":
        df = pd.read_csv(filepath, delimiter=delimiter, dtype=str, keep_default_na=False).fillna("")
        sheets = ["Sheet1"]
    else:
        xls = pd.ExcelFile(filepath, engine="openpyxl")
        sheets = xls.sheet_names
        target_sheet = args.get("sheetName") or sheets[0]
        if target_sheet not in sheets:
            return {"error": f"Sheet '{target_sheet}' not found. Available: {', '.join(sheets)}"}
        df = pd.read_excel(xls, sheet_name=target_sheet, dtype=str, keep_default_na=False).fillna("")

    base_name = Path(filepath).stem
    info = save_df_to_file(df, base_name, "", target_format, delimiter)
    record_file(info["filename"], args.get("originalName", ""), info["mime"], info["size"], "convert", info["filepath"])

    return {
        "success": True,
        "downloadUrl": f"/api/tools/download?file={info['filename']}",
        "filename": info["filename"],
        "sheets": sheets,
    }


def tool_stats(args):
    filepath = args.get("filepath", "")
    generate_report = args.get("generateReport", "false")

    if not filepath:
        return {"error": "File is required"}

    df = read_file_to_df(filepath)
    if df.empty:
        return {"error": "File is empty"}

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

        if len(non_empty) == 0:
            col_type = "empty"
        elif len(numeric_vals) == len(non_empty):
            col_type = "numeric"
        elif len(numeric_vals) == 0:
            col_type = "text"
        else:
            col_type = "mixed"

        stat = {"column": col, "type": col_type, "count": len(non_empty), "distinct": distinct, "missing": missing}

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

        freq = Counter(str(v) for v in non_empty)
        stat["topValues"] = [{"value": v, "count": c} for v, c in freq.most_common(5)]
        stats.append(stat)

    download_url = None
    report_filename = None
    if generate_report == "true":
        base_name = Path(filepath).stem
        info = save_df_to_file(pd.DataFrame(), base_name, "stats")
        summary_data = []
        for s in stats:
            row = {
                "Column": s["column"], "Type": s["type"], "Count": s["count"],
                "Distinct": s["distinct"], "Missing": s["missing"],
                "Sum": s.get("sum", ""), "Average": s.get("avg", ""),
                "Min": s.get("min", ""), "Max": s.get("max", ""),
                "Median": s.get("median", ""), "Std Dev": s.get("stdDev", ""),
                "Min Length": s.get("minLength", ""), "Max Length": s.get("maxLength", ""),
            }
            summary_data.append(row)

        with pd.ExcelWriter(info["filepath"], engine="openpyxl") as writer:
            pd.DataFrame(summary_data).to_excel(writer, sheet_name="Summary", index=False)
            top_rows = []
            for s in stats:
                for tv in s.get("topValues", []):
                    top_rows.append({
                        "Column": s["column"], "Value": tv["value"],
                        "Count": tv["count"],
                        "Percent of Filled": f"{(tv['count'] / max(s['count'], 1) * 100):.1f}%",
                    })
            if top_rows:
                pd.DataFrame(top_rows).to_excel(writer, sheet_name="Top Values", index=False)

        info["size"] = Path(info["filepath"]).stat().st_size
        record_file(info["filename"], args.get("originalName", ""), info["mime"], info["size"], "stats", info["filepath"])
        download_url = f"/api/tools/download?file={info['filename']}"
        report_filename = info["filename"]

    return {
        "success": True, "totalRows": len(df), "totalColumns": len(df.columns),
        "stats": stats, "downloadUrl": download_url, "filename": report_filename,
    }


def tool_sort(args):
    filepath = args.get("filepath", "")
    column = args.get("column", "")
    order = args.get("order", "asc")

    if not filepath or not column:
        return {"error": "File and column are required"}

    df = read_file_to_df(filepath)
    if df.empty:
        return {"error": "File is empty"}
    if column not in df.columns:
        return {"error": f"Column '{column}' not found"}

    ascending = order == "asc"
    try:
        df["_num"] = pd.to_numeric(df[column], errors="coerce")
        has_nums = df["_num"].notna().any()
    except Exception:
        has_nums = False

    if has_nums:
        df_sorted = df.sort_values(by="_num", ascending=ascending, na_position="last").drop(columns=["_num"])
    else:
        df_sorted = df.sort_values(by=column, ascending=ascending, na_position="last")

    df_sorted = df_sorted.reset_index(drop=True)
    base_name = Path(filepath).stem
    info = save_df_to_file(df_sorted, base_name, "sorted")
    record_file(info["filename"], args.get("originalName", ""), info["mime"], info["size"], "sort", info["filepath"])

    return {
        "success": True, "downloadUrl": f"/api/tools/download?file={info['filename']}",
        "filename": info["filename"], "totalRows": len(df_sorted),
        "sortedBy": column, "order": order, "preview": df_to_dicts(df_sorted.head(10)),
    }


def tool_filter(args):
    filepath = args.get("filepath", "")
    conditions = args.get("conditions", [])
    combine_with = args.get("combineWith", "AND")

    if not filepath:
        return {"error": "File is required"}
    if not conditions:
        return {"error": "At least one filter condition is required"}

    df = read_file_to_df(filepath)
    if df.empty:
        return {"error": "File is empty"}

    for c in conditions:
        if c.get("column") not in df.columns:
            return {"error": f"Column '{c.get('column')}' not found"}

    def apply_condition(row, cond):
        col = cond["column"]
        op = cond["operator"]
        val = cond.get("value", "")
        cell = str(row.get(col, ""))

        if op == "equals":
            try:
                return float(cell) == float(val) if val != "" else cell == val
            except ValueError:
                return cell == val
        elif op == "not_equals":
            try:
                return float(cell) != float(val) if val != "" else cell != val
            except ValueError:
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
    if combine_with == "OR":
        filtered = [r for r in dicts if any(apply_condition(r, c) for c in conditions)]
    else:
        filtered = [r for r in dicts if all(apply_condition(r, c) for c in conditions)]

    filtered_df = pd.DataFrame(filtered) if filtered else pd.DataFrame(columns=df.columns)
    base_name = Path(filepath).stem
    info = save_df_to_file(filtered_df, base_name, "filtered")
    record_file(info["filename"], args.get("originalName", ""), info["mime"], info["size"], "filter", info["filepath"])

    return {
        "success": True, "downloadUrl": f"/api/tools/download?file={info['filename']}",
        "filename": info["filename"], "totalRows": len(df),
        "matchedRows": len(filtered), "removedRows": len(df) - len(filtered),
        "conditions": conditions, "combineWith": combine_with, "preview": filtered[:10],
    }


def tool_replace(args):
    filepath = args.get("filepath", "")
    find = args.get("find", "")
    replace = args.get("replace", "")
    scope_columns = args.get("columns", [])
    match_mode = args.get("matchMode", "contains")
    case_sensitive = args.get("caseSensitive", "false") == "true"
    use_regex = args.get("useRegex", "false") == "true"

    if not filepath:
        return {"error": "File is required"}
    if not find:
        return {"error": "Find text is required"}

    df = read_file_to_df(filepath)
    if df.empty:
        return {"error": "File is empty"}

    all_columns = list(df.columns)
    target_columns = [c for c in scope_columns if c in all_columns] if scope_columns else all_columns
    if not target_columns:
        return {"error": "No matching columns found"}

    flags = 0 if case_sensitive else re.IGNORECASE
    try:
        if use_regex:
            pattern = re.compile(find, flags)
        else:
            escaped = re.escape(find)
            if match_mode == "exact":
                pattern = re.compile(f"^{escaped}$", flags)
            elif match_mode == "startsWith":
                pattern = re.compile(f"^{escaped}", flags)
            elif match_mode == "endsWith":
                pattern = re.compile(f"{escaped}$", flags)
            else:
                pattern = re.compile(escaped, flags)
    except re.error:
        return {"error": "Invalid regex pattern"}

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
                        "row": idx + 1, "column": col,
                        "before": original[:80], "after": new_val[:80],
                    })

    base_name = Path(filepath).stem
    info = save_df_to_file(df, base_name, "replaced")
    record_file(info["filename"], args.get("originalName", ""), info["mime"], info["size"], "replace", info["filepath"])

    return {
        "success": True, "downloadUrl": f"/api/tools/download?file={info['filename']}",
        "filename": info["filename"], "totalRows": len(df),
        "scopedColumns": target_columns, "matchMode": "regex" if use_regex else match_mode,
        "caseSensitive": case_sensitive, "totalMatches": total_matches,
        "cellsChanged": cells_changed, "rowsAffected": len(rows_affected),
        "changes": changes, "preview": df_to_dicts(df.head(10)),
    }


def tool_transpose(args):
    filepath = args.get("filepath", "")
    mode = args.get("mode", "transpose")
    id_columns = args.get("idColumns", [])
    var_name = args.get("varName", "variable")
    value_name = args.get("valueName", "value")

    if not filepath:
        return {"error": "File is required"}

    df = read_file_to_df(filepath)
    if df.empty:
        return {"error": "File is empty"}

    columns = list(df.columns)

    if mode == "transpose":
        transposed = df.T.reset_index()
        transposed.columns = ["Column"] + [f"Row {i+1}" for i in range(len(df))]
        result_df = transposed
        output_columns = list(result_df.columns)
    else:
        if not id_columns:
            return {"error": "Select at least one ID column for unpivot"}
        value_cols = [c for c in columns if c not in id_columns]
        if not value_cols:
            return {"error": "No value columns to unpivot"}
        result_df = df.melt(id_vars=id_columns, value_vars=value_cols, var_name=var_name, value_name=value_name)
        output_columns = list(result_df.columns)

    base_name = Path(filepath).stem
    suffix = "transposed" if mode == "transpose" else "unpivoted"
    info = save_df_to_file(result_df, base_name, suffix)
    record_file(info["filename"], args.get("originalName", ""), info["mime"], info["size"], "transpose", info["filepath"])

    return {
        "success": True, "downloadUrl": f"/api/tools/download?file={info['filename']}",
        "filename": info["filename"], "mode": mode,
        "inputRows": len(df), "inputColumns": len(columns),
        "outputRows": len(result_df), "outputColumns": output_columns,
        "preview": df_to_dicts(result_df.head(20)),
    }


def tool_pivot(args):
    filepath = args.get("filepath", "")
    group_by = args.get("groupBy", [])
    aggregations = args.get("aggregations", [])

    if not filepath:
        return {"error": "File is required"}
    if not group_by:
        return {"error": "Select at least one column to group by"}
    if not aggregations:
        return {"error": "Add at least one aggregation"}

    df = read_file_to_df(filepath)
    if df.empty:
        return {"error": "File is empty"}

    for c in group_by:
        if c not in df.columns:
            return {"error": f"Group-by column '{c}' not found"}

    agg_dict = {}
    rename_map = {}
    for a in aggregations:
        col = a["column"]
        fn = a["function"]
        alias = a.get("alias") or f"{col}_{fn}"
        if fn != "count" and col not in df.columns:
            return {"error": f"Aggregation column '{col}' not found"}

        pandas_fn = {"sum": "sum", "avg": "mean", "count": "count", "count_distinct": "nunique",
                     "min": "min", "max": "max", "first": "first", "last": "last"}.get(fn, "count")

        key = f"{col}_{fn}_{alias}"
        agg_dict[key] = pd.NamedAgg(column=col, aggfunc=pandas_fn)
        rename_map[key] = alias

    for a in aggregations:
        col = a["column"]
        if a["function"] in ("sum", "avg", "min", "max"):
            df[col] = pd.to_numeric(df[col], errors="coerce")

    grouped = df.groupby(group_by, dropna=False).agg(**agg_dict).reset_index()
    grouped = grouped.rename(columns=rename_map)

    first_col = group_by[0]
    try:
        grouped[first_col] = pd.to_numeric(grouped[first_col], errors="coerce")
    except Exception:
        pass
    grouped = grouped.sort_values(first_col, ascending=True, na_position="last").reset_index(drop=True)

    base_name = Path(filepath).stem
    info = save_df_to_file(grouped, base_name, "pivot")
    record_file(info["filename"], args.get("originalName", ""), info["mime"], info["size"], "pivot", info["filepath"])

    return {
        "success": True, "downloadUrl": f"/api/tools/download?file={info['filename']}",
        "filename": info["filename"], "totalRows": len(df),
        "groupCount": len(grouped), "groupBy": group_by,
        "aggregations": aggregations, "preview": df_to_dicts(grouped.head(20)),
    }


def tool_validate(args):
    filepath = args.get("filepath", "")
    if not filepath:
        return {"error": "File is required"}

    df = read_file_to_df(filepath)
    if df.empty:
        return {"error": "File is empty"}

    checks = args.get("checks", ["empty_cells", "mixed_types", "duplicate_keys", "email_format",
                                   "url_format", "date_format", "constant_columns", "whitespace",
                                   "unique_counts", "outliers"])
    primary_key = args.get("primaryKey", "")
    email_cols = args.get("emailColumns", [])
    url_cols = args.get("urlColumns", [])
    date_cols = args.get("dateColumns", [])

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

        nums = sum(1 for v in non_empty if str(v).replace(".", "").replace("-", "").isdigit())
        texts = len(non_empty) - nums
        detected_type = "number" if nums == len(non_empty) else "text" if texts == len(non_empty) else "mixed"
        is_constant = len(non_empty) > 0 and len(unique_set) == 1

        report = {
            "column": col, "totalCells": len(values), "emptyCells": empty_cells,
            "whitespaceOnly": whitespace_only, "uniqueValues": len(unique_set),
            "detectedType": detected_type, "isConstant": is_constant,
        }

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

        if "empty_cells" in checks:
            for i, v in enumerate(values):
                if v == "" or v is None:
                    issues.append({"row": i + 1, "column": col, "value": v, "message": "Empty cell", "severity": "info"})

        if "whitespace" in checks:
            for i, v in enumerate(values):
                if isinstance(v, str) and v != "" and v.strip() == "":
                    issues.append({"row": i + 1, "column": col, "value": v, "message": "Whitespace-only cell", "severity": "warning"})

        if "constant_columns" in checks and is_constant:
            issues.append({"row": 0, "column": col, "value": non_empty[0],
                          "message": f'Column is constant — every non-empty cell is "{non_empty[0]}"', "severity": "info"})

        if "email_format" in checks and col in email_cols:
            for i, v in enumerate(values):
                if v and not email_re.match(str(v)):
                    issues.append({"row": i + 1, "column": col, "value": v, "message": "Invalid email format", "severity": "error"})

        if "url_format" in checks and col in url_cols:
            for i, v in enumerate(values):
                if v and not url_re.match(str(v)):
                    issues.append({"row": i + 1, "column": col, "value": v, "message": "Invalid URL format", "severity": "error"})

        if "date_format" in checks and col in date_cols:
            for i, v in enumerate(values):
                if v and not date_re.match(str(v)):
                    issues.append({"row": i + 1, "column": col, "value": v, "message": "Invalid date format", "severity": "error"})

    if "duplicate_keys" in checks and primary_key:
        seen = {}
        for i, row in df.iterrows():
            v = str(row[primary_key])
            if v == "":
                continue
            if v not in seen:
                seen[v] = []
            seen[v].append(i + 1)
        for v, rows in seen.items():
            if len(rows) > 1:
                issues.append({"row": rows[0], "column": primary_key, "value": v,
                              "message": f'Duplicate primary key "{v}" appears in rows: {", ".join(map(str, rows))}',
                              "severity": "error"})

    total_cells = len(df) * len(df.columns)
    summary = {
        "totalRows": len(df), "totalColumns": len(df.columns), "totalCells": total_cells,
        "emptyCells": sum(r["emptyCells"] for r in column_reports),
        "uniqueIssues": len(issues),
        "errors": sum(1 for i in issues if i["severity"] == "error"),
        "warnings": sum(1 for i in issues if i["severity"] == "warning"),
        "infos": sum(1 for i in issues if i["severity"] == "info"),
        "constantColumns": sum(1 for r in column_reports if r["isConstant"]),
        "mixedTypeColumns": sum(1 for r in column_reports if r["detectedType"] == "mixed"),
    }
    overall_score = max(0, round(100 - ((summary["errors"] * 5 + summary["warnings"] * 2 + summary["infos"] * 0.5) / max(1, total_cells)) * 100))

    base_name = Path(filepath).stem
    info = save_df_to_file(pd.DataFrame(), base_name, "validation")
    with pd.ExcelWriter(info["filepath"], engine="openpyxl") as writer:
        summary_data = [{"Metric": k, "Value": v} for k, v in summary.items()] + [{"Metric": "Quality Score", "Value": f"{overall_score}/100"}]
        pd.DataFrame(summary_data).to_excel(writer, sheet_name="Summary", index=False)
        col_data = [{"Column": r["column"], "Type": r["detectedType"], "Total Cells": r["totalCells"],
                     "Empty Cells": r["emptyCells"], "Whitespace-only": r["whitespaceOnly"],
                     "Unique Values": r["uniqueValues"], "Constant": "Yes" if r["isConstant"] else "No",
                     "Min": r.get("min", ""), "Max": r.get("max", ""), "Mean": r.get("mean", "")}
                    for r in column_reports]
        pd.DataFrame(col_data).to_excel(writer, sheet_name="Columns", index=False)
        issue_data = [{"Row": i["row"], "Column": i["column"], "Value": str(i["value"]),
                       "Severity": i["severity"], "Message": i["message"]} for i in issues[:1000]]
        if issue_data:
            pd.DataFrame(issue_data).to_excel(writer, sheet_name="Issues", index=False)

    info["size"] = Path(info["filepath"]).stat().st_size
    record_file(info["filename"], args.get("originalName", ""), info["mime"], info["size"], "validate", info["filepath"])

    return {
        "success": True, "downloadUrl": f"/api/tools/download?file={info['filename']}",
        "filename": info["filename"], "summary": summary, "overallScore": overall_score,
        "columnReports": column_reports, "issues": issues[:200], "checksRun": checks,
    }


def tool_attendance(args):
    filepath = args.get("filepath", "")
    column = args.get("column", "")
    roll_number = args.get("rollNumber", "")

    if not filepath or not column or not roll_number:
        return {"error": "File, column, and roll number are required"}

    df = read_file_to_df(filepath)
    if df.empty:
        return {"error": "File is empty"}

    student_rows = df[df[column].astype(str).str.strip() == roll_number.strip()]
    if student_rows.empty:
        return {"error": f"No records found for roll number: {roll_number}"}

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
            "rollNumber": roll_number, "totalClasses": total,
            "presentCount": present, "absentCount": total - present,
            "attendancePercentage": f"{(present / total * 100):.2f}" if total > 0 else "0.00",
            "details": details,
        }
    else:
        total_classes = len(df)
        present_count = len(student_rows)
        report = {
            "rollNumber": roll_number, "totalClasses": total_classes,
            "presentCount": present_count, "absentCount": total_classes - present_count,
            "attendancePercentage": f"{(present_count / total_classes * 100):.2f}" if total_classes > 0 else "0.00",
        }

    return {"success": True, "report": report}


def tool_preview(args):
    filename = args.get("file", "")
    rows = args.get("rows", 50)
    if not filename:
        return {"error": "Filename is required"}

    safe_name = Path(filename).name
    filepath = DOWNLOAD_DIR / safe_name
    if not filepath.is_file():
        return {"error": "File not found"}

    ext = filepath.suffix.lower()
    if ext == ".csv":
        df = pd.read_csv(filepath, dtype=str, keep_default_na=False).fillna("")
    else:
        df = pd.read_excel(filepath, engine="openpyxl", dtype=str, keep_default_na=False).fillna("")

    columns = list(df.columns) if not df.empty else []
    return {
        "success": True, "sheetName": "Sheet1", "totalRows": len(df),
        "columns": columns, "data": df_to_dicts(df.head(rows)),
    }


def tool_history_get(args):
    try:
        conn = get_db()
        rows = conn.execute("SELECT * FROM FileRecord ORDER BY createdAt DESC LIMIT 50").fetchall()
        conn.close()
        records = [dict(r) for r in rows]
        return {"success": True, "records": records}
    except Exception as e:
        return {"error": str(e)}


def tool_history_delete(args):
    record_id = args.get("id", "")
    try:
        conn = get_db()
        if record_id:
            record = conn.execute("SELECT * FROM FileRecord WHERE id = ?", (record_id,)).fetchone()
            if not record:
                conn.close()
                return {"error": "Record not found"}
            if record["outputPath"]:
                try:
                    Path(record["outputPath"]).unlink()
                except Exception:
                    pass
            conn.execute("DELETE FROM FileRecord WHERE id = ?", (record_id,))
            conn.commit()
            conn.close()
            return {"success": True, "message": "Record deleted"}
        else:
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
    except Exception as e:
        return {"error": str(e)}


def tool_errors_get(args):
    try:
        conn = get_db()
        rows = conn.execute("SELECT * FROM ErrorLog ORDER BY createdAt DESC LIMIT 50").fetchall()
        conn.close()
        records = [dict(r) for r in rows]
        return {"success": True, "records": records}
    except Exception as e:
        return {"error": str(e)}


# ─── Main dispatcher ───────────────────────────────────────────────────────────

TOOLS = {
    "merge": tool_merge,
    "columns": tool_columns,
    "duplicates": tool_duplicates,
    "convert": tool_convert,
    "stats": tool_stats,
    "sort": tool_sort,
    "filter": tool_filter,
    "replace": tool_replace,
    "transpose": tool_transpose,
    "pivot": tool_pivot,
    "validate": tool_validate,
    "attendance": tool_attendance,
    "preview": tool_preview,
    "history_get": tool_history_get,
    "history_delete": tool_history_delete,
    "errors_get": tool_errors_get,
}


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: cli.py <tool> <json_args_file>"}))
        sys.exit(1)

    tool_name = sys.argv[1]
    args_file = sys.argv[2]

    try:
        with open(args_file, "r") as f:
            args = json.load(f)
    except Exception as e:
        print(json.dumps({"error": f"Failed to read args: {e}"}))
        sys.exit(1)

    handler = TOOLS.get(tool_name)
    if not handler:
        print(json.dumps({"error": f"Unknown tool: {tool_name}"}))
        sys.exit(1)

    try:
        result = handler(args)
        print(json.dumps(result, default=str))
    except Exception as e:
        log_error(tool_name, str(e))
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
