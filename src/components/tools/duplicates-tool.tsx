"use client"

import { useState } from "react"
import { FileDropzone } from "@/components/file-dropzone"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { DataTable } from "@/components/data-table"
import { DataPreviewDialog } from "@/components/data-preview-dialog"
import { CopyX, Download, CheckCircle2, Loader2, Eye, FileSpreadsheet, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import { motion, AnimatePresence } from "framer-motion"
import { useAppStore } from "@/lib/store"
import { apiFetch, downloadUrl } from "@/lib/api"

interface DuplicatesResult {
  success?: boolean
  downloadUrl?: string
  filename: string
  totalRows?: number
  duplicateRows?: number
  remainingRows?: number
  preview?: {
    deleted: Record<string, unknown>[]
    remaining: Record<string, unknown>[]
  }
}

export function DuplicatesTool() {
  const { incrementActiveTasks, decrementActiveTasks, pushNotification } = useAppStore()
  const [file, setFile] = useState<File | null>(null)
  const [columns, setColumns] = useState<string[]>([])
  const [selectedColumn, setSelectedColumn] = useState("")
  const [keepOccurrence, setKeepOccurrence] = useState("first")
  const [isProcessing, setIsProcessing] = useState(false)
  const [isLoadingColumns, setIsLoadingColumns] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<DuplicatesResult | null>(null)
  const [preview, setPreview] = useState<Record<string, unknown>[]>([])
  const [previewOpen, setPreviewOpen] = useState(false)
  const [viewMode, setViewMode] = useState<"remaining" | "deleted">("remaining")

  const handleFileSelected = async (files: File[]) => {
    const selected = files[0]
    setFile(selected)
    setResult(null)
    setIsLoadingColumns(true)

    try {
      const formData = new FormData()
      formData.append("file", selected)

      const response = await apiFetch("/api/tools/columns", {
        method: "POST",
        body: formData,
      })

      const data = await response.json()
      if (data.success && data.sheets.length > 0) {
        setColumns(data.sheets[0].columns)
        setSelectedColumn(data.sheets[0].columns[0] || "")
        setPreview(data.preview || [])
      }
    } catch {
      toast.error("Failed to read file columns")
    } finally {
      setIsLoadingColumns(false)
    }
  }

  const handleRemoveDuplicates = async () => {
    if (!file || !selectedColumn) {
      toast.error("Please select a file and column")
      return
    }

    setIsProcessing(true)
    setProgress(20)
    incrementActiveTasks()

    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("column", selectedColumn)
      formData.append("keepOccurrence", keepOccurrence)

      setProgress(50)

      const response = await apiFetch("/api/tools/duplicates", {
        method: "POST",
        body: formData,
      })

      setProgress(80)

      // Check if response is a file download
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || "Failed to remove duplicates")
        setProgress(100)
        setResult(data)
        toast.success(`Removed ${data.duplicateRows} duplicate rows!`)
        pushNotification({
          title: "Duplicates removed",
          description: `${data.duplicateRows} of ${data.totalRows} rows removed by "${selectedColumn}"`,
          type: data.duplicateRows > 0 ? "success" : "info",
        })
      } else {
        // File download response
        const blob = await response.blob()
        const contentDisposition = response.headers.get("content-disposition") || "";
        const filenameMatch = contentDisposition.match(/filename="?(.+?)"?$/);
        const filename = filenameMatch ? filenameMatch[1] : "cleaned_data.xlsx";
        
        // Trigger download
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        
        setProgress(100)
        setResult({ success: true, filename })
        toast.success("Duplicates removed and file downloaded!")
        pushNotification({
          title: "Duplicates removed",
          description: `File downloaded: ${filename}`,
          type: "success",
        })
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to remove duplicates"
      toast.error(msg)
      pushNotification({ title: "Duplicate removal failed", description: msg, type: "error" })
    } finally {
      setIsProcessing(false)
      decrementActiveTasks()
      setTimeout(() => setProgress(0), 1000)
    }
  }

  const resetTool = () => {
    setFile(null)
    setColumns([])
    setSelectedColumn("")
    setResult(null)
    setPreview([])
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-500/10 text-rose-500">
                <CopyX className="h-4 w-4" />
              </div>
              <div>
                <CardTitle className="text-base">Remove Duplicates</CardTitle>
                <CardDescription>Find and remove duplicate rows from your data</CardDescription>
              </div>
            </div>
            {file && (
              <Button variant="ghost" size="sm" onClick={resetTool} className="h-7 text-xs">
                <RotateCcw className="h-3 w-3 mr-1" />
                Reset
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <FileDropzone
            multiple={false}
            onFilesSelected={handleFileSelected}
            label="Drop an Excel or CSV file here"
          />

          {isLoadingColumns && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Reading file columns...
            </div>
          )}

          {columns.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Check Duplicates In</Label>
                  <Select value={selectedColumn} onValueChange={setSelectedColumn}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select column" />
                    </SelectTrigger>
                    <SelectContent>
                      {columns.map(col => (
                        <SelectItem key={col} value={col}>{col}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Keep Occurrence</Label>
                  <RadioGroup value={keepOccurrence} onValueChange={setKeepOccurrence} className="flex gap-4 pt-2">
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="first" id="keep-first" />
                      <Label htmlFor="keep-first" className="text-sm">First</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="last" id="keep-last" />
                      <Label htmlFor="keep-last" className="text-sm">Last</Label>
                    </div>
                  </RadioGroup>
                </div>
              </div>

              {preview.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-muted-foreground">Original Data Preview</Label>
                    <Badge variant="secondary" className="text-[10px]">{preview.length} rows shown</Badge>
                  </div>
                  <DataTable
                    data={preview}
                    maxRows={50}
                    highlightRow={(row) => {
                      const val = row[selectedColumn]
                      const seen = new Set<unknown>()
                      let isDup = false
                      for (const r of preview) {
                        if (r === row) break
                        if (r[selectedColumn] === val && seen.has(val)) {
                          isDup = true
                          break
                        }
                        if (r[selectedColumn] === val) seen.add(val)
                      }
                      // Simple: highlight if value appears earlier
                      return false
                    }}
                  />
                </div>
              )}
            </motion.div>
          )}

          {isProcessing && (
            <div className="space-y-2">
              <Progress value={progress} className="h-2" />
              <p className="text-xs text-muted-foreground text-center">Removing duplicates...</p>
            </div>
          )}

          <Button onClick={handleRemoveDuplicates} disabled={isProcessing || !file || !selectedColumn} className="w-full">
            {isProcessing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <CopyX className="mr-2 h-4 w-4" />
                Remove Duplicates
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <AnimatePresence>
        {result && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            <Card className="border-rose-500/20 bg-rose-500/5">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-rose-500" />
                  <CardTitle className="text-base">Duplicates Removed</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="rounded-lg bg-background p-3">
                    <p className="text-xs text-muted-foreground">Total Rows</p>
                    <p className="text-lg font-semibold">{result.totalRows}</p>
                  </div>
                  <div className="rounded-lg bg-background p-3">
                    <p className="text-xs text-muted-foreground">Duplicates</p>
                    <p className="text-lg font-semibold text-rose-500">{result.duplicateRows}</p>
                  </div>
                  <div className="rounded-lg bg-background p-3">
                    <p className="text-xs text-muted-foreground">Remaining</p>
                    <p className="text-lg font-semibold text-emerald-500">{result.remainingRows}</p>
                  </div>
                </div>

                {/* Preview toggle between deleted and remaining */}
                {result.preview && (result.preview.deleted.length > 0 || result.preview.remaining.length > 0) && (
                  <div className="space-y-2">
                    <div className="flex gap-1 rounded-lg bg-muted/50 p-1">
                      <button
                        onClick={() => setViewMode("remaining")}
                        className={`flex-1 rounded-md px-3 py-1 text-xs font-medium transition-all ${
                          viewMode === "remaining"
                            ? "bg-background shadow-sm text-emerald-600 dark:text-emerald-400"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Kept ({result.preview.remaining.length}+)
                      </button>
                      <button
                        onClick={() => setViewMode("deleted")}
                        className={`flex-1 rounded-md px-3 py-1 text-xs font-medium transition-all ${
                          viewMode === "deleted"
                            ? "bg-background shadow-sm text-rose-600 dark:text-rose-400"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Deleted ({result.preview.deleted.length}+)
                      </button>
                    </div>
                    <DataTable
                      data={viewMode === "remaining" ? result.preview.remaining : result.preview.deleted}
                      maxRows={50}
                      searchable={false}
                      emptyMessage={viewMode === "remaining" ? "No remaining rows to preview" : "No duplicate rows were deleted"}
                    />
                  </div>
                )}

                <div className="flex gap-2">
                  {result.downloadUrl && (
                    <Button asChild className="flex-1">
                      <a href={downloadUrl(result.downloadUrl)} download>
                        <Download className="mr-2 h-4 w-4" />
                        Download
                      </a>
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => setPreviewOpen(true)} className="flex-1">
                    <Eye className="mr-2 h-4 w-4" />
                    Preview Full Data
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <DataPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        filename={result?.filename || ""}
        title="Cleaned Data Preview"
      />
    </div>
  )
}
