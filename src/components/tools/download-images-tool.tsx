"use client"

/**
 * Download Images tool — thin composition layer.
 *
 * Everything runs client-side: the spreadsheet is parsed in the browser
 * (src/lib/image-downloader.ts), images are fetched through the worker's
 * /image-proxy endpoint by the useImageDownloadJob hook, and the outputs
 * (XLSX with embedded images / HTML report) are built locally.
 */

import { useState } from "react"
import { FileDropzone } from "@/components/file-dropzone"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ImageDown, Loader2, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import { AnimatePresence } from "framer-motion"
import { parseSpreadsheet, type ParsedSheet } from "@/lib/image-downloader"
import { useImageDownloadJob } from "@/hooks/use-image-download-job"
import { ColumnOptions } from "./download-images/column-options"
import { DownloadProgress } from "./download-images/download-progress"
import { ResultsCard } from "./download-images/results-card"

const COMPRESSED_MAX_DIMENSION = 400

/** Pick a sensible default URL column: name hints first, then content sniffing. */
function guessUrlColumn(sheet: ParsedSheet): string {
  const byName = sheet.columns.find((c) => /\b(url|image|img|photo|picture|link)\b/i.test(c))
  if (byName) return byName
  const sample = sheet.rows.slice(0, 10)
  const byContent = sheet.columns.find((c) =>
    sample.some((row) => /^https?:\/\//i.test((row[c] || "").trim())),
  )
  return byContent || sheet.columns[0] || ""
}

export function DownloadImagesTool() {
  const [fileName, setFileName] = useState("")
  const [sheet, setSheet] = useState<ParsedSheet | null>(null)
  const [isParsing, setIsParsing] = useState(false)
  const [urlColumn, setUrlColumn] = useState("")
  const [includeColumns, setIncludeColumns] = useState<string[]>([])
  const [compress, setCompress] = useState(true)

  const job = useImageDownloadJob()
  const isRunning = job.phase === "running"

  const handleFileSelected = async (files: File[]) => {
    const file = files[0]
    if (!file) return

    job.reset()
    setFileName(file.name)
    setSheet(null)
    setIncludeColumns([])
    setIsParsing(true)

    try {
      const sheets = await parseSpreadsheet(file)
      const first = sheets.find((s) => s.columns.length > 0)
      if (!first || first.rows.length === 0) {
        toast.error("No data found in file")
        setFileName("")
        return
      }
      setSheet(first)
      setUrlColumn(guessUrlColumn(first))
    } catch {
      toast.error("Failed to read file")
      setFileName("")
    } finally {
      setIsParsing(false)
    }
  }

  const toggleColumn = (col: string) => {
    setIncludeColumns((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col],
    )
  }

  const handleProcess = () => {
    if (!sheet || !urlColumn) {
      toast.error("Please select a file and URL column")
      return
    }
    const urls = sheet.rows.map((row) => (row[urlColumn] || "").trim())
    void job.start(urls, { maxDimension: compress ? COMPRESSED_MAX_DIMENSION : 0 })
  }

  const resetTool = () => {
    job.reset()
    setFileName("")
    setSheet(null)
    setUrlColumn("")
    setIncludeColumns([])
  }

  // Columns shipped to the exports (URL column excluded)
  const exportColumns = sheet
    ? sheet.columns.filter(
        (c) => c !== urlColumn && (includeColumns.length === 0 || includeColumns.includes(c)),
      )
    : []
  const baseName = fileName.replace(/\.[^.]+$/, "") || "images"

  return (
    <div className="space-y-6 max-w-3xl">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-pink-500/10 text-pink-500">
                <ImageDown className="h-4 w-4" />
              </div>
              <div>
                <CardTitle className="text-base">Download Images into Excel</CardTitle>
                <CardDescription>Download images from URLs and embed them into Excel cells</CardDescription>
              </div>
            </div>
            {fileName && (
              <Button variant="ghost" size="sm" onClick={resetTool} className="h-7 text-xs">
                <RotateCcw className="h-3 w-3 mr-1" />
                Reset
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <FileDropzone multiple={false} onFilesSelected={handleFileSelected} />

          {isParsing && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Reading file...
            </div>
          )}

          {sheet && (
            <ColumnOptions
              columns={sheet.columns}
              urlColumn={urlColumn}
              onUrlColumnChange={setUrlColumn}
              includeColumns={includeColumns}
              onToggleColumn={toggleColumn}
              compress={compress}
              onCompressChange={setCompress}
              disabled={isRunning}
            />
          )}

          {isRunning && <DownloadProgress progress={job.progress} onCancel={job.cancel} />}

          <Button onClick={handleProcess} disabled={isRunning || !sheet || !urlColumn} className="w-full">
            {isRunning ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing Images...
              </>
            ) : (
              <>
                <ImageDown className="mr-2 h-4 w-4" />
                Process Images
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <AnimatePresence>
        {job.phase === "done" && sheet && (
          <ResultsCard
            results={job.results}
            rows={sheet.rows}
            columns={exportColumns}
            baseName={baseName}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
