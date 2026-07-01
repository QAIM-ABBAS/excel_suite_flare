"use client"

import { useState } from "react"
import { FileDropzone } from "@/components/file-dropzone"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { DataTable } from "@/components/data-table"
import { DataPreviewDialog } from "@/components/data-preview-dialog"
import {
  Table2, Download, CheckCircle2, Loader2, Eye, RotateCcw, Plus, Trash2, Zap, Sigma,
} from "lucide-react"
import { toast } from "sonner"
import { motion, AnimatePresence } from "framer-motion"
import { useAppStore } from "@/lib/store"
import { apiFetch, downloadUrl } from "@/lib/api"

type AggFn =
  | "sum"
  | "avg"
  | "count"
  | "count_distinct"
  | "min"
  | "max"
  | "first"
  | "last"

interface Aggregation {
  id: string
  column: string
  function: AggFn
  alias: string
}

interface PivotResult {
  success?: boolean
  downloadUrl?: string
  filename: string
  totalRows?: number
  groupCount?: number
  groupBy?: string[]
  aggregations?: Aggregation[]
  preview?: Record<string, unknown>[]
}

const AGG_FUNCTIONS: { value: AggFn; label: string; needsColumn: boolean }[] = [
  { value: "sum", label: "Sum", needsColumn: true },
  { value: "avg", label: "Average", needsColumn: true },
  { value: "count", label: "Count", needsColumn: true },
  { value: "count_distinct", label: "Count Distinct", needsColumn: true },
  { value: "min", label: "Minimum", needsColumn: true },
  { value: "max", label: "Maximum", needsColumn: true },
  { value: "first", label: "First", needsColumn: true },
  { value: "last", label: "Last", needsColumn: true },
]

let aggSeq = 0
const newAggId = () => `agg-${++aggSeq}-${Date.now()}`

export function PivotTool() {
  const { incrementActiveTasks, decrementActiveTasks, pushNotification } = useAppStore()
  const [file, setFile] = useState<File | null>(null)
  const [columns, setColumns] = useState<string[]>([])
  const [groupBy, setGroupBy] = useState<string[]>([])
  const [aggregations, setAggregations] = useState<Aggregation[]>([])
  const [isLoadingColumns, setIsLoadingColumns] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<PivotResult | null>(null)
  const [preview, setPreview] = useState<Record<string, unknown>[]>([])
  const [previewOpen, setPreviewOpen] = useState(false)

  const handleFileSelected = async (files: File[]) => {
    const selected = files[0]
    setFile(selected)
    setResult(null)
    setIsLoadingColumns(true)
    try {
      const formData = new FormData()
      formData.append("file", selected)
      const response = await apiFetch("/api/tools/columns", { method: "POST", body: formData })
      const data = await response.json()
      if (data.success && data.sheets.length > 0) {
        const cols = data.sheets[0].columns
        setColumns(cols)
        setPreview(data.preview || [])
        setGroupBy([])
        setAggregations([])
      }
    } catch {
      toast.error("Failed to read file columns")
    } finally {
      setIsLoadingColumns(false)
    }
  }

  const toggleGroupBy = (col: string) => {
    setGroupBy((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]
    )
  }

  const addAggregation = () => {
    if (columns.length === 0) return
    const firstCol = columns[0]
    setAggregations((prev) => [
      ...prev,
      {
        id: newAggId(),
        column: firstCol,
        function: "sum",
        alias: `${firstCol}_sum`,
      },
    ])
  }

  const removeAggregation = (id: string) => {
    setAggregations((prev) => prev.filter((a) => a.id !== id))
  }

  const updateAggregation = (id: string, patch: Partial<Aggregation>) => {
    setAggregations((prev) =>
      prev.map((a) => {
        const next = { ...a, ...patch }
        // Auto-regenerate alias if user hasn't customized it (matches default pattern)
        if (patch.function || patch.column) {
          const defaultAlias = `${a.column}_${a.function}`
          if (a.alias === defaultAlias || a.alias === "") {
            next.alias = `${next.column}_${next.function}`
          }
        }
        return next
      })
    )
  }

  const handlePivot = async () => {
    if (!file) {
      toast.error("Please select a file first")
      return
    }
    if (groupBy.length === 0) {
      toast.error("Select at least one column to group by")
      return
    }
    if (aggregations.length === 0) {
      toast.error("Add at least one aggregation")
      return
    }

    setIsProcessing(true)
    setProgress(20)
    incrementActiveTasks()
    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("groupBy", JSON.stringify(groupBy))
      formData.append("aggregations", JSON.stringify(aggregations.map(({ id: _id, ...rest }) => rest)))
      setProgress(50)
      const response = await apiFetch("/api/tools/pivot", { method: "POST", body: formData })
      setProgress(80)

      // Check if response is a file download
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || "Failed to aggregate data")
        setProgress(100)
        setResult(data)
        toast.success(
          `Aggregated ${data.totalRows} rows into ${data.groupCount} groups`
        )
        pushNotification({
          title: "Pivot complete",
          description: `${data.totalRows} rows → ${data.groupCount} groups by ${groupBy.join(", ")}`,
          type: "success",
        })
      } else {
        // File download response
        const blob = await response.blob()
        const contentDisposition = response.headers.get("content-disposition") || "";
        const filenameMatch = contentDisposition.match(/filename="?(.+?)"?$/);
        const filename = filenameMatch ? filenameMatch[1] : "pivoted_data.xlsx";
        
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
        toast.success("Pivot completed and file downloaded!")
        pushNotification({
          title: "Pivot complete",
          description: `File downloaded: ${filename}`,
          type: "success",
        })
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to aggregate data"
      toast.error(msg)
      pushNotification({ title: "Pivot failed", description: msg, type: "error" })
    } finally {
      setIsProcessing(false)
      decrementActiveTasks()
      setTimeout(() => setProgress(0), 1000)
    }
  }

  const resetTool = () => {
    setFile(null)
    setColumns([])
    setGroupBy([])
    setAggregations([])
    setResult(null)
    setPreview([])
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-500/10 text-teal-500">
                <Table2 className="h-4 w-4" />
              </div>
              <div>
                <CardTitle className="text-base">Pivot / Group-By Aggregator</CardTitle>
                <CardDescription>Group rows and aggregate values into a summary table</CardDescription>
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
          <FileDropzone multiple={false} onFilesSelected={handleFileSelected} label="Drop an Excel or CSV file here" />

          {isLoadingColumns && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Reading file columns...
            </div>
          )}

          {columns.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
              {/* Group-by columns selector */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">
                    Group By Columns <span className="text-destructive">*</span>
                  </Label>
                  <Badge variant="secondary" className="text-[10px]">{groupBy.length} selected</Badge>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {columns.map((col) => {
                    const active = groupBy.includes(col)
                    return (
                      <button
                        key={col}
                        type="button"
                        onClick={() => toggleGroupBy(col)}
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-all ${
                          active
                            ? "border-teal-500/40 bg-teal-500/10 text-teal-600 dark:text-teal-400"
                            : "border-border/50 bg-muted/30 hover:bg-muted/60"
                        }`}
                      >
                        <Sigma className="h-3 w-3" />
                        {col}
                      </button>
                    )
                  })}
                </div>
                {groupBy.length > 0 && (
                  <p className="text-[10px] text-muted-foreground">
                    Grouping by: <span className="font-mono">{groupBy.join(" → ")}</span>
                  </p>
                )}
              </div>

              {/* Aggregations builder */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Aggregations</Label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={addAggregation}
                    className="h-6 text-[11px] border-dashed"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add
                  </Button>
                </div>

                <AnimatePresence initial={false}>
                  {aggregations.map((agg) => (
                    <motion.div
                      key={agg.id}
                      layout
                      initial={{ opacity: 0, y: -5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -10 }}
                      className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1.2fr_auto] gap-2 items-end rounded-lg border border-border/50 bg-muted/20 p-2"
                    >
                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground">Column</Label>
                        <Select value={agg.column} onValueChange={(v) => updateAggregation(agg.id, { column: v })}>
                          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {columns.map((col) => (
                              <SelectItem key={col} value={col}>{col}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground">Function</Label>
                        <Select
                          value={agg.function}
                          onValueChange={(v) => updateAggregation(agg.id, { function: v as AggFn })}
                        >
                          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {AGG_FUNCTIONS.map((f) => (
                              <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground">Output Column Name</Label>
                        <Input
                          className="h-9"
                          value={agg.alias}
                          onChange={(e) => updateAggregation(agg.id, { alias: e.target.value })}
                          placeholder="auto"
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 shrink-0"
                        onClick={() => removeAggregation(agg.id)}
                        title="Remove aggregation"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </motion.div>
                  ))}
                </AnimatePresence>

                {aggregations.length === 0 && (
                  <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                    No aggregations yet. Click "Add" to compute sum, avg, count, etc.
                  </div>
                )}
              </div>

              {preview.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-muted-foreground">Original Data Preview</Label>
                    <Badge variant="secondary" className="text-[10px]">{preview.length} rows shown</Badge>
                  </div>
                  <DataTable data={preview} maxRows={50} searchable={false} />
                </div>
              )}
            </motion.div>
          )}

          {isProcessing && (
            <div className="space-y-2">
              <Progress value={progress} className="h-2" />
              <p className="text-xs text-muted-foreground text-center">Aggregating data...</p>
            </div>
          )}

          <Button
            onClick={handlePivot}
            disabled={isProcessing || !file || groupBy.length === 0 || aggregations.length === 0}
            className="w-full"
          >
            {isProcessing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Zap className="mr-2 h-4 w-4" />
                Aggregate {aggregations.length > 0 ? `(${aggregations.length} ${aggregations.length === 1 ? "metric" : "metrics"})` : ""}
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <AnimatePresence>
        {result && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            <Card className="border-teal-500/20 bg-teal-500/5">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-teal-500" />
                  <CardTitle className="text-base">Aggregation Complete</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="rounded-lg bg-background p-3">
                    <p className="text-xs text-muted-foreground">Source Rows</p>
                    <p className="text-lg font-semibold">{result.totalRows}</p>
                  </div>
                  <div className="rounded-lg bg-background p-3">
                    <p className="text-xs text-muted-foreground">Output Groups</p>
                    <p className="text-lg font-semibold text-teal-500">{result.groupCount || 0}</p>
                  </div>
                  <div className="rounded-lg bg-background p-3">
                    <p className="text-xs text-muted-foreground">Group By</p>
                    <p className="text-sm font-semibold truncate" title={result.groupBy?.join(", ")}>
                      {result.groupBy?.join(", ")}
                    </p>
                  </div>
                </div>

                {result.preview && result.preview.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Pivot Preview (first 20 rows)</Label>
                    <DataTable data={result.preview} maxRows={20} searchable />
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
        title="Pivot Table Preview"
      />
    </div>
  )
}
