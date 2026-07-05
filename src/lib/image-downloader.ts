/**
 * Client-side engine for the Download Images tool.
 *
 * The browser orchestrates the whole batch: it parses the spreadsheet
 * locally, fetches every image through the Worker's /image-proxy endpoint
 * (which only exists to bypass CORS and hostile servers), normalizes each
 * image to a JPEG data URI via canvas, and reports progress in real time.
 * No server-side state, KV storage, or polling is involved — this keeps the
 * tool inside Cloudflare's free-tier limits even for 1000+ row files.
 */

import * as XLSX from "xlsx"
import Papa from "papaparse"
import { apiFetch } from "@/lib/api"

// ─── Spreadsheet parsing (browser-safe) ──────────────────────────────────────

export type Row = Record<string, string>

export interface ParsedSheet {
  name: string
  columns: string[]
  rows: Row[]
}

/** Parse an Excel/CSV File in the browser. All values are coerced to strings. */
export async function parseSpreadsheet(file: File): Promise<ParsedSheet[]> {
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase()

  if (ext === ".csv" || ext === ".tsv") {
    const text = await file.text()
    const parsed = Papa.parse<Record<string, string>>(text, {
      header: true,
      delimiter: ext === ".tsv" ? "\t" : ",",
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      transform: (v) => (v == null ? "" : String(v)),
    })
    const columns = parsed.meta.fields || []
    const rows = (parsed.data || []).map((r) => {
      const out: Row = {}
      for (const c of columns) out[c] = r[c] ?? ""
      return out
    })
    return [{ name: "Sheet1", columns, rows }]
  }

  const buffer = await file.arrayBuffer()
  const wb = XLSX.read(buffer, { type: "array", cellDates: false })
  return wb.SheetNames.map((sheetName) => {
    const aoa = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[sheetName], {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false,
    }) as string[][]
    if (aoa.length === 0) return { name: sheetName, columns: [], rows: [] }
    const columns = aoa[0].map((c) => String(c ?? ""))
    const rows: Row[] = []
    for (let i = 1; i < aoa.length; i++) {
      const row: Row = {}
      for (let j = 0; j < columns.length; j++) {
        row[columns[j]] = aoa[i] && aoa[i][j] != null ? String(aoa[i][j]) : ""
      }
      rows.push(row)
    }
    return { name: sheetName, columns, rows }
  })
}

// ─── Image download engine ───────────────────────────────────────────────────

export interface ImageResult {
  /** 1-based data row number */
  row: number
  url: string
  status: "success" | "failed" | "skipped"
  error?: string
  /** JPEG (or original-format fallback) data URI, present on success */
  dataUri?: string
  width?: number
  height?: number
}

export interface DownloadImagesOptions {
  /** Parallel downloads. Default 6. */
  concurrency?: number
  /** Longest image side in px after re-encoding; 0 keeps the original size. Default 400. */
  maxDimension?: number
  signal?: AbortSignal
  onProgress?: (done: number, latest: ImageResult) => void
}

export interface DownloadImagesOutcome {
  results: ImageResult[]
  aborted: boolean
}

const DEFAULT_CONCURRENCY = 6
const REQUEST_TIMEOUT_MS = 45_000
const JPEG_QUALITY = 0.82

/** Download all URLs through the worker proxy with bounded concurrency. */
export async function downloadImages(
  urls: string[],
  options: DownloadImagesOptions = {},
): Promise<DownloadImagesOutcome> {
  const { concurrency = DEFAULT_CONCURRENCY, maxDimension = 400, signal, onProgress } = options

  const results: (ImageResult | undefined)[] = new Array(urls.length)
  let cursor = 0
  let done = 0
  let aborted = false

  async function runNext(): Promise<void> {
    while (cursor < urls.length) {
      if (signal?.aborted) {
        aborted = true
        return
      }
      const index = cursor++
      const row = index + 1
      const url = urls[index].trim()

      let result: ImageResult
      try {
        result = await downloadOne(url, row, maxDimension, signal)
      } catch (error) {
        if (isAbortError(error) || signal?.aborted) {
          aborted = true
          return
        }
        const message = error instanceof Error ? error.message : "Download failed"
        result = { row, url, status: "failed", error: message }
      }
      results[index] = result
      done++
      onProgress?.(done, result)
    }
  }

  const workerCount = Math.min(concurrency, urls.length)
  await Promise.all(Array.from({ length: workerCount }, () => runNext()))

  return {
    results: results.filter((r): r is ImageResult => r !== undefined),
    aborted,
  }
}

async function downloadOne(
  url: string,
  row: number,
  maxDimension: number,
  signal?: AbortSignal,
): Promise<ImageResult> {
  if (!url) return { row, url: "", status: "skipped" }

  const blob = await fetchViaProxy(url, signal)
  const normalized = await normalizeImage(blob, maxDimension)
  return { row, url, status: "success", ...normalized }
}

/**
 * Fetch one image through the worker proxy.
 * Retries once on network errors, timeouts, and 5xx responses.
 * Rethrows AbortError untouched so cancellation can be distinguished.
 */
async function fetchViaProxy(url: string, signal?: AbortSignal): Promise<Blob> {
  let lastError: Error = new Error("Download failed")

  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) throw createAbortError()

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort("timeout"), REQUEST_TIMEOUT_MS)
    const onOuterAbort = () => controller.abort("cancelled")
    signal?.addEventListener("abort", onOuterAbort, { once: true })

    try {
      const response = await apiFetch(
        `/api/tools/image-proxy?url=${encodeURIComponent(url)}`,
        { signal: controller.signal },
      )

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        const message = data.error || `HTTP ${response.status}`
        if (response.status >= 500 && attempt === 0) {
          lastError = new Error(message)
          continue // retry transient server errors
        }
        throw new Error(message)
      }

      return await response.blob()
    } catch (error) {
      if (controller.signal.aborted) {
        if (signal?.aborted) throw createAbortError() // user cancelled
        lastError = new Error("Request timed out")
        continue // retry timeouts once
      }
      if (error instanceof TypeError && attempt === 0) {
        lastError = error // network hiccup — retry
        continue
      }
      throw error instanceof Error ? error : new Error("Download failed")
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener("abort", onOuterAbort)
    }
  }

  throw lastError
}

/**
 * Re-encode an image to a JPEG data URI via canvas, optionally downscaling.
 * Normalizing guarantees ExcelJS compatibility (it only embeds jpeg/png/gif)
 * and keeps memory bounded on large batches.
 */
async function normalizeImage(
  blob: Blob,
  maxDimension: number,
): Promise<{ dataUri: string; width?: number; height?: number }> {
  try {
    const bitmap = await createImageBitmap(blob)
    let { width, height } = bitmap
    if (maxDimension > 0 && Math.max(width, height) > maxDimension) {
      const scale = maxDimension / Math.max(width, height)
      width = Math.max(1, Math.round(width * scale))
      height = Math.max(1, Math.round(height * scale))
    }

    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Canvas unavailable")

    // Flatten transparency onto white before JPEG encoding
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()

    return { dataUri: canvas.toDataURL("image/jpeg", JPEG_QUALITY), width, height }
  } catch {
    // Canvas couldn't decode it — fall back to raw bytes for formats that
    // both ExcelJS and browsers still understand.
    if (blob.type === "image/jpeg" || blob.type === "image/png" || blob.type === "image/gif") {
      return { dataUri: await blobToDataUri(blob) }
    }
    throw new Error("Unsupported image format")
  }
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error("Failed to read image data"))
    reader.readAsDataURL(blob)
  })
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}

function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError")
}
