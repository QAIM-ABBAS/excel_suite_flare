/**
 * Builds the downloadable outputs for the Download Images tool, entirely in
 * the browser: an XLSX with images embedded in cells (via ExcelJS, loaded
 * lazily to keep the main bundle small) and a standalone HTML report.
 */

import type { ImageResult, Row } from "@/lib/image-downloader"

export interface ImagesExportInput {
  /** Base name (without extension) for the generated file */
  baseName: string
  /** Data columns to include, URL column already excluded */
  columns: string[]
  rows: Row[]
  results: ImageResult[]
}

/** Displayed image box size inside the spreadsheet, in px */
const XLSX_THUMB_PX = 150
/** Excel row heights are in points (1px ≈ 0.75pt) */
const PX_TO_PT = 0.75

export async function buildImagesXlsx(input: ImagesExportInput): Promise<Blob> {
  const ExcelJS = await import("exceljs")
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Images")

  sheet.columns = [
    { header: "Image", width: 22 },
    ...input.columns.map((c) => ({ header: c, width: 20 })),
    { header: "Image URL", width: 40 },
  ]
  sheet.getRow(1).font = { bold: true }

  const resultByRow = new Map(input.results.map((r) => [r.row, r]))

  for (let i = 0; i < input.rows.length; i++) {
    const excelRowNumber = i + 2 // 1-based + header row
    const data = input.rows[i]
    const result = resultByRow.get(i + 1)

    const row = sheet.getRow(excelRowNumber)
    row.values = [
      "",
      ...input.columns.map((c) => data[c] ?? ""),
      result?.url ?? "",
    ]
    row.alignment = { vertical: "middle" }

    const parsed = result?.dataUri ? parseDataUri(result.dataUri) : null
    if (result?.status === "success" && parsed) {
      const imageId = workbook.addImage({
        base64: parsed.base64,
        extension: parsed.extension,
      })
      const naturalWidth = result.width ?? XLSX_THUMB_PX
      const naturalHeight = result.height ?? XLSX_THUMB_PX
      const scale = Math.min(XLSX_THUMB_PX / naturalWidth, XLSX_THUMB_PX / naturalHeight, 1)
      const width = Math.max(1, Math.round(naturalWidth * scale))
      const height = Math.max(1, Math.round(naturalHeight * scale))

      sheet.addImage(imageId, {
        tl: { col: 0, row: excelRowNumber - 1 },
        ext: { width, height },
        editAs: "oneCell",
      })
      row.height = Math.max(height * PX_TO_PT + 4, 20)
    } else if (result?.status === "failed") {
      const cell = row.getCell(1)
      cell.value = result.error || "Failed"
      cell.font = { color: { argb: "FFCC0000" }, size: 9 }
    }
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
}

export function buildImagesHtml(input: ImagesExportInput): Blob {
  const resultByRow = new Map(input.results.map((r) => [r.row, r]))
  const successCount = input.results.filter((r) => r.status === "success").length

  const headerCells = ["<th>Image</th>", ...input.columns.map((c) => `<th>${escapeHtml(c)}</th>`)].join("")

  const bodyRows = input.rows.map((data, i) => {
    const result = resultByRow.get(i + 1)
    const imgCell = result?.status === "success" && result.dataUri
      ? `<td class="img-cell"><img src="${result.dataUri}" loading="lazy" /></td>`
      : `<td class="img-cell empty">${result?.error ? "Error" : "—"}</td>`
    const dataCells = input.columns.map((c) => `<td>${escapeHtml(data[c] ?? "")}</td>`).join("")
    return `<tr>${imgCell}${dataCells}</tr>`
  })

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(input.baseName)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 13px; background: #f5f5f5; padding: 24px; color: #222; }
    h1 { font-size: 16px; font-weight: 600; margin-bottom: 16px; color: #333; }
    .meta { font-size: 12px; color: #888; margin-bottom: 16px; }
    .table-wrap { overflow-x: auto; background: #fff; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,0.1); }
    table { border-collapse: collapse; width: 100%; min-width: 600px; }
    thead tr { background: #f0f0f0; }
    th { padding: 10px 14px; text-align: left; font-weight: 600; border-bottom: 2px solid #ddd; white-space: nowrap; }
    td { padding: 8px 14px; border-bottom: 1px solid #eee; vertical-align: middle; }
    td.img-cell { width: 220px; min-width: 220px; text-align: center; padding: 8px; }
    td.img-cell img { max-width: 200px; max-height: 200px; border-radius: 4px; display: block; margin: 0 auto; }
    td.img-cell.empty { color: #bbb; font-size: 12px; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #fafafa; }
  </style>
</head>
<body>
  <h1>${escapeHtml(input.baseName)}</h1>
  <p class="meta">
    ${input.rows.length} rows ·
    ${successCount} images loaded ·
    Generated ${new Date().toLocaleString()}
  </p>
  <div class="table-wrap">
    <table>
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${bodyRows.join("\n")}</tbody>
    </table>
  </div>
</body>
</html>`

  return new Blob([html], { type: "text/html;charset=utf-8" })
}

/** Trigger a browser download for a generated Blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

function parseDataUri(dataUri: string): { base64: string; extension: "jpeg" | "png" | "gif" } | null {
  const match = dataUri.match(/^data:image\/(jpeg|png|gif);base64,(.+)$/)
  if (!match) return null
  return { extension: match[1] as "jpeg" | "png" | "gif", base64: match[2] }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
