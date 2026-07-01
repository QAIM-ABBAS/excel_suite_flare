"use client"

import { useState } from "react"
import { FileDropzone } from "@/components/file-dropzone"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { DataTable } from "@/components/data-table"
import { DataPreviewDialog } from "@/components/data-preview-dialog"
import {
  FlipHorizontal2, Download, CheckCircle2, Loader2, Eye, RotateCcw, ArrowRight, ArrowDown, Table2,
} from "lucide-react"
import { toast } from "sonner"
import { motion, AnimatePresence } from "framer-motion"
import { useAppStore } from "@/lib/store"
import { apiFetch, downloadUrl } from "@/lib/api"

type Mode = "transpose" | "unpivot"

interface TransposeResult {
  downloadUrl: string
  filename: string
  mode: Mode
  inputRows: number
  inputColumns: number
  outputRows: number
  outputColumns: string[]
  preview: Record<string, unknown>[]
}

export function TransposeTool() {
  const { incrementActiveTasks, decrementActiveTasks, pushNotification } = useAppStore()
  const [file, setFile] = useState<File | null>(null)
  const [columns, setColumns] = useState<string[]>([])
  const [preview, setPreview] = useState<Record<string, unknown>[]>([])
  const [isLoadingColumns, setIsLoadingColumns] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<TransposeResult | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [resultPreviewOpen, setResultPreviewOpen] = useState(false)

  const [mode, setMode] = useState<Mode>("transpose")
  const [idColumns, setIdColumns] = useState<string[]>([])
  const [varName, setVarName] = useState("variable")
  const [valueName, setValueName] = useState("value")

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
        setColumns(data.sheets[0].columns)
        setPreview(data.preview || [])
        setIdColumns([])
      }
    } catch {
      toast.error("Failed to read file columns")
    } finally {
      setIsLoadingColumns(false)
    }
  }

  const toggleIdColumn = (col: string) => {
    setIdColumns((prev) => (prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]))
  }

  const canRun = file && (mode === "transpose" || (mode === "unpivot" && idColumns.length > 0))

  const handleRun = async () => {
    if (!file) return
    setIsProcessing(true)
    setProgress(10)
    incrementActiveTasks()
    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("mode", mode)
      if (mode === "unpivot") {
        formData.append("idColumns", JSON.stringify(idColumns))
        formData.append("varName", varName || "variable")
        formData.append("valueName", valueName || "value")
      }

      setProgress(40)
      const response = await apiFetch("/api/tools/transpose", { method: "POST", body: formData })
      const data = await response.json()
      setProgress(90)

      if (data.success) {
        setResult(data)
        setProgress(100)
        const verb = mode === "transpose" ? "Transposed" : "Unpivoted"
        pushNotification({
          title: `${verb} successfully`,
          description: `${data.inputRows} rows × ${data.inputColumns} cols → ${data.outputRows} rows × ${data.outputColumns.length} cols`,
          type: "success",
        })
        toast.success(`${verb} — ${data.outputRows} rows generated`)
      } else {
        toast.error(data.error || "Operation failed")
        pushNotification({ title: "Operation failed", description: data.error, type: "error" })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error"
      toast.error(msg)
      pushNotification({ title: "Operation failed", description: msg, type: "error" })
    } finally {
      setIsProcessing(false)
      setTimeout(() => setProgress(0), 800)
      decrementActiveTasks()
    }
  }

  const handleReset = () => {
    setFile(null)
    setColumns([])
    setPreview([])
    setResult(null)
    setIdColumns([])
    setMode("transpose")
    setVarName("variable")
    setValueName("value")
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-500/10">
            <FlipHorizontal2 className="h-5 w-5 text-purple-500" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight">Transpose / Reshape</h2>
            <p className="text-sm text-muted-foreground">
              Swap rows and columns, or unpivot wide data into long format
            </p>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <span>1. Upload File</span>
            {file && (
              <Badge variant="secondary" className="text-[10px] gap-1">
                <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500" />
                {file.name}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!file ? (
            <FileDropzone onFilesSelected={handleFileSelected} />
          ) : (
            <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/30 p-3">
              <div className="flex items-center gap-2 min-w-0">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                <span className="text-sm truncate">{file.name}</span>
                <Badge variant="outline" className="text-[10px]">{(file.size / 1024).toFixed(1)} KB</Badge>
                {columns.length > 0 && <Badge variant="outline" className="text-[10px]">{columns.length} cols</Badge>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button size="sm" variant="ghost" onClick={() => setPreviewOpen(true)} className="h-7 text-xs">
                  <Eye className="mr-1 h-3 w-3" /> Preview
                </Button>
                <Button size="sm" variant="ghost" onClick={handleReset} className="h-7 text-xs">
                  <RotateCcw className="mr-1 h-3 w-3" /> Reset
                </Button>
              </div>
            </div>
          )}
          {isLoadingColumns && (
            <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Reading columns…
            </div>
          )}
        </CardContent>
      </Card>

      {columns.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. Choose Mode</CardTitle>
            <CardDescription>Pick how you want to reshape your data</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <motion.button
                type="button"
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                onClick={() => setMode("transpose")}
                className={`text-left rounded-lg border p-4 transition-all ${
                  mode === "transpose"
                    ? "border-purple-500/40 bg-purple-500/5 shadow-sm"
                    : "border-border/50 bg-card hover:border-purple-500/20"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                    mode === "transpose" ? "bg-purple-500/20 text-purple-500" : "bg-muted text-muted-foreground"
                  }`}>
                    <FlipHorizontal2 className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold">Transpose</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      Classic rows ↔ columns swap. Matrix transpose.
                    </div>
                    <div className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
                      <span className="rounded bg-muted px-1.5 py-0.5">rows</span>
                      <ArrowRight className="h-2.5 w-2.5" />
                      <span className="rounded bg-muted px-1.5 py-0.5">cols</span>
                      <span>and</span>
                      <span className="rounded bg-muted px-1.5 py-0.5">cols</span>
                      <ArrowRight className="h-2.5 w-2.5" />
                      <span className="rounded bg-muted px-1.5 py-0.5">rows</span>
                    </div>
                  </div>
                </div>
              </motion.button>

              <motion.button
                type="button"
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                onClick={() => setMode("unpivot")}
                className={`text-left rounded-lg border p-4 transition-all ${
                  mode === "unpivot"
                    ? "border-purple-500/40 bg-purple-500/5 shadow-sm"
                    : "border-border/50 bg-card hover:border-purple-500/20"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                    mode === "unpivot" ? "bg-purple-500/20 text-purple-500" : "bg-muted text-muted-foreground"
                  }`}>
                    <ArrowDown className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold">Unpivot (Wide → Long)</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      Keep ID columns fixed, melt remaining columns into variable/value pairs.
                    </div>
                    <div className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
                      <span className="rounded bg-muted px-1.5 py-0.5">wide table</span>
                      <ArrowRight className="h-2.5 w-2.5" />
                      <span className="rounded bg-muted px-1.5 py-0.5">long table</span>
                    </div>
                  </div>
                </div>
              </motion.button>
            </div>

            <AnimatePresence>
              {mode === "unpivot" && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden space-y-3"
                >
                  <div className="rounded-lg border border-border/50 bg-muted/30 p-3 space-y-2">
                    <Label className="text-xs flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-purple-500" />
                      ID Columns (kept fixed) — click to toggle
                    </Label>
                    <div className="flex flex-wrap gap-1.5">
                      {columns.map((col) => {
                        const active = idColumns.includes(col)
                        return (
                          <button
                            key={col}
                            type="button"
                            onClick={() => toggleIdColumn(col)}
                            className={`rounded-full px-2.5 py-1 text-xs transition-all border ${
                              active
                                ? "border-purple-500/40 bg-purple-500/15 text-purple-500"
                                : "border-border/50 bg-card hover:border-purple-500/20"
                            }`}
                          >
                            {col}
                          </button>
                        )
                      })}
                    </div>
                    {idColumns.length > 0 && (
                      <div className="text-[10px] text-muted-foreground">
                        {idColumns.length} ID column{idColumns.length === 1 ? "" : "s"} ·{" "}
                        {columns.length - idColumns.length} value column{columns.length - idColumns.length === 1 ? "" : "s"} will be melted
                      </div>
                    )}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="var-name" className="text-xs">Variable Column Name</Label>
                      <Input
                        id="var-name"
                        value={varName}
                        onChange={(e) => setVarName(e.target.value)}
                        placeholder="variable"
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="value-name" className="text-xs">Value Column Name</Label>
                      <Input
                        id="value-name"
                        value={valueName}
                        onChange={(e) => setValueName(e.target.value)}
                        placeholder="value"
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex items-center gap-2 pt-1">
              <Button
                onClick={handleRun}
                disabled={!canRun || isProcessing}
                className="bg-purple-600 hover:bg-purple-700 text-white"
              >
                {isProcessing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FlipHorizontal2 className="mr-2 h-4 w-4" />
                )}
                {mode === "transpose" ? "Transpose Data" : "Unpivot Data"}
              </Button>
              <Badge variant="outline" className="text-[10px]">
                {mode === "transpose" ? "Transpose mode" : `${idColumns.length} ID cols`}
              </Badge>
            </div>

            {progress > 0 && (
              <Progress value={progress} className="h-1" />
            )}
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {result && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          <Card className="relative overflow-hidden border-purple-500/20">
            <div className="absolute -top-12 -right-12 h-40 w-40 rounded-full bg-purple-500/10 blur-3xl" />
            <CardContent className="relative pt-6">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-purple-500" />
                    <h3 className="text-lg font-semibold">
                      {result.mode === "transpose" ? "Transposed" : "Unpivoted"} Successfully
                    </h3>
                    <Badge variant="secondary" className="text-[10px]">{result.filename}</Badge>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="rounded-md bg-muted px-2 py-1 tabular-nums">
                      {result.inputRows} rows × {result.inputColumns} cols
                    </span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    <span className="rounded-md bg-purple-500/10 text-purple-500 px-2 py-1 tabular-nums">
                      {result.outputRows} rows × {result.outputColumns.length} cols
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setResultPreviewOpen(true)}>
                    <Eye className="mr-1 h-3.5 w-3.5" /> Preview Result
                  </Button>
                  <Button asChild>
                    <a href={downloadUrl(result.downloadUrl)} download>
                      <Download className="mr-2 h-4 w-4" />
                      Download
                    </a>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Table2 className="h-4 w-4" />
                Output Preview
              </CardTitle>
              <CardDescription>First 20 rows of the result</CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable data={result.preview} maxHeight={400} />
            </CardContent>
          </Card>
        </motion.div>
      )}

      <DataPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        data={preview}
        title="Original File Preview"
      />
      <DataPreviewDialog
        open={resultPreviewOpen}
        onOpenChange={setResultPreviewOpen}
        data={result?.preview || []}
        title="Result Preview"
      />
    </div>
  )
}
