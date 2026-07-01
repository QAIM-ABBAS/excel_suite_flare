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
  ShieldCheck, Download, CheckCircle2, Loader2, Eye, RotateCcw, Zap,
  AlertTriangle, AlertCircle, Info, TrendingUp, Type, Hash, Calendar, ToggleLeft,
} from "lucide-react"
import { toast } from "sonner"
import { motion, AnimatePresence } from "framer-motion"
import { useAppStore } from "@/lib/store"
import { apiFetch, downloadUrl } from "@/lib/api"

type CheckName =
  | "empty_cells"
  | "mixed_types"
  | "duplicate_keys"
  | "email_format"
  | "url_format"
  | "date_format"
  | "constant_columns"
  | "whitespace"
  | "unique_counts"
  | "outliers"

interface Issue {
  row: number
  column: string
  value: unknown
  message: string
  severity: "info" | "warning" | "error"
}

interface ColumnReport {
  column: string
  totalCells: number
  emptyCells: number
  whitespaceOnly: number
  uniqueValues: number
  detectedType: "number" | "text" | "date" | "boolean" | "mixed"
  isConstant: boolean
  min?: number | string
  max?: number | string
  mean?: number
}

interface ValidateResult {
  downloadUrl: string
  filename: string
  summary: {
    totalRows: number
    totalColumns: number
    totalCells: number
    emptyCells: number
    uniqueIssues: number
    errors: number
    warnings: number
    infos: number
    constantColumns: number
    mixedTypeColumns: number
  }
  overallScore: number
  columnReports: ColumnReport[]
  issues: Issue[]
  checksRun: CheckName[]
}

const AVAILABLE_CHECKS: { id: CheckName; label: string; description: string; needsInput?: "primary" | "email" | "url" | "date" }[] = [
  { id: "empty_cells", label: "Empty Cells", description: "Flag any blank cells" },
  { id: "whitespace", label: "Whitespace-only", description: "Cells that only contain spaces" },
  { id: "mixed_types", label: "Mixed Types", description: "Non-numeric values in numeric columns" },
  { id: "constant_columns", label: "Constant Columns", description: "Columns where every value is identical" },
  { id: "outliers", label: "Outliers (IQR)", description: "Statistical outliers in numeric columns" },
  { id: "duplicate_keys", label: "Duplicate Primary Keys", description: "Repeated values in primary key column", needsInput: "primary" },
  { id: "email_format", label: "Email Format", description: "Validate email pattern", needsInput: "email" },
  { id: "url_format", label: "URL Format", description: "Validate URL pattern", needsInput: "url" },
  { id: "date_format", label: "Date Format", description: "Validate YYYY-MM-DD format", needsInput: "date" },
]

const typeIconMap: Record<string, typeof Hash> = {
  number: Hash,
  text: Type,
  date: Calendar,
  boolean: ToggleLeft,
  mixed: AlertTriangle,
}

const typeColorMap: Record<string, string> = {
  number: "bg-cyan-500/10 text-cyan-500",
  text: "bg-violet-500/10 text-violet-500",
  date: "bg-amber-500/10 text-amber-500",
  boolean: "bg-emerald-500/10 text-emerald-500",
  mixed: "bg-rose-500/10 text-rose-500",
}

export function ValidateTool() {
  const { incrementActiveTasks, decrementActiveTasks, pushNotification } = useAppStore()
  const [file, setFile] = useState<File | null>(null)
  const [columns, setColumns] = useState<string[]>([])
  const [preview, setPreview] = useState<Record<string, unknown>[]>([])
  const [isLoadingColumns, setIsLoadingColumns] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<ValidateResult | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)

  // Check selection
  const [checks, setChecks] = useState<CheckName[]>([
    "empty_cells",
    "whitespace",
    "mixed_types",
    "constant_columns",
    "outliers",
  ])

  // Format-specific column assignments
  const [primaryKey, setPrimaryKey] = useState<string>("")
  const [emailColumns, setEmailColumns] = useState<string[]>([])
  const [urlColumns, setUrlColumns] = useState<string[]>([])
  const [dateColumns, setDateColumns] = useState<string[]>([])

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
        setPrimaryKey("")
        setEmailColumns([])
        setUrlColumns([])
        setDateColumns([])
      }
    } catch {
      toast.error("Failed to read file columns")
    } finally {
      setIsLoadingColumns(false)
    }
  }

  const toggleCheck = (id: CheckName) => {
    setChecks((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]))
  }

  const toggleColumnInList = (col: string, list: string[], setter: (v: string[]) => void) => {
    setter(list.includes(col) ? list.filter((c) => c !== col) : [...list, col])
  }

  const canRun = file && checks.length > 0

  const handleValidate = async () => {
    if (!file) return
    setIsProcessing(true)
    setProgress(10)
    incrementActiveTasks()
    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("checks", JSON.stringify(checks))
      if (primaryKey) formData.append("primaryKey", primaryKey)
      if (emailColumns.length > 0) formData.append("emailColumns", JSON.stringify(emailColumns))
      if (urlColumns.length > 0) formData.append("urlColumns", JSON.stringify(urlColumns))
      if (dateColumns.length > 0) formData.append("dateColumns", JSON.stringify(dateColumns))

      setProgress(40)
      const response = await apiFetch("/api/tools/validate", { method: "POST", body: formData })
      const data = await response.json()
      setProgress(90)

      if (data.success) {
        setResult(data)
        setProgress(100)
        const score = data.overallScore
        const severity = score >= 80 ? "success" : score >= 50 ? "warning" : "error"
        pushNotification({
          title: "Validation complete",
          description: `Quality score ${score}/100 — ${data.summary.errors} errors, ${data.summary.warnings} warnings`,
          type: severity,
        })
        toast.success(`Validation complete — score ${score}/100`)
      } else {
        toast.error(data.error || "Validation failed")
        pushNotification({ title: "Validation failed", description: data.error, type: "error" })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error"
      toast.error(msg)
      pushNotification({ title: "Validation failed", description: msg, type: "error" })
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
    setChecks(["empty_cells", "whitespace", "mixed_types", "constant_columns", "outliers"])
    setPrimaryKey("")
    setEmailColumns([])
    setUrlColumns([])
    setDateColumns([])
  }

  const scoreColor =
    result && result.overallScore >= 80
      ? "text-emerald-500"
      : result && result.overallScore >= 50
      ? "text-amber-500"
      : "text-rose-500"

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-lime-500/10">
            <ShieldCheck className="h-5 w-5 text-lime-500" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight">Data Validation / Quality Check</h2>
            <p className="text-sm text-muted-foreground">
              Scan for empty cells, type mismatches, duplicate keys, format violations, and outliers
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
            <CardTitle className="text-base">2. Select Checks</CardTitle>
            <CardDescription>Toggle the checks you want to run on your data</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {AVAILABLE_CHECKS.map((check) => {
                const active = checks.includes(check.id)
                return (
                  <motion.button
                    key={check.id}
                    type="button"
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    onClick={() => toggleCheck(check.id)}
                    className={`text-left rounded-lg border p-3 transition-all ${
                      active
                        ? "border-lime-500/40 bg-lime-500/5 shadow-sm"
                        : "border-border/50 bg-card hover:border-lime-500/20"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <div className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        active ? "border-lime-500 bg-lime-500 text-white" : "border-muted-foreground/30"
                      }`}>
                        {active && <CheckCircle2 className="h-3 w-3" />}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{check.label}</div>
                        <div className="text-[11px] text-muted-foreground">{check.description}</div>
                      </div>
                    </div>
                  </motion.button>
                )
              })}
            </div>

            {/* Conditional inputs based on selected checks */}
            <AnimatePresence>
              {checks.includes("duplicate_keys") && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="rounded-lg border border-border/50 bg-muted/30 p-3 space-y-2">
                    <Label className="text-xs">Primary Key Column (for duplicate detection)</Label>
                    <Select value={primaryKey} onValueChange={setPrimaryKey}>
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="Select a column" />
                      </SelectTrigger>
                      <SelectContent>
                        {columns.map((col) => (
                          <SelectItem key={col} value={col}>{col}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {(checks.includes("email_format") || checks.includes("url_format") || checks.includes("date_format")) && columns.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden space-y-3"
                >
                  {checks.includes("email_format") && (
                    <div className="rounded-lg border border-border/50 bg-muted/30 p-3 space-y-2">
                      <Label className="text-xs flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-rose-500" />
                        Email Columns — click to toggle
                      </Label>
                      <div className="flex flex-wrap gap-1.5">
                        {columns.map((col) => {
                          const active = emailColumns.includes(col)
                          return (
                            <button
                              key={col}
                              type="button"
                              onClick={() => toggleColumnInList(col, emailColumns, setEmailColumns)}
                              className={`rounded-full px-2.5 py-1 text-xs transition-all border ${
                                active
                                  ? "border-rose-500/40 bg-rose-500/15 text-rose-500"
                                  : "border-border/50 bg-card hover:border-rose-500/20"
                              }`}
                            >
                              {col}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                  {checks.includes("url_format") && (
                    <div className="rounded-lg border border-border/50 bg-muted/30 p-3 space-y-2">
                      <Label className="text-xs flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-sky-500" />
                        URL Columns — click to toggle
                      </Label>
                      <div className="flex flex-wrap gap-1.5">
                        {columns.map((col) => {
                          const active = urlColumns.includes(col)
                          return (
                            <button
                              key={col}
                              type="button"
                              onClick={() => toggleColumnInList(col, urlColumns, setUrlColumns)}
                              className={`rounded-full px-2.5 py-1 text-xs transition-all border ${
                                active
                                  ? "border-sky-500/40 bg-sky-500/15 text-sky-500"
                                  : "border-border/50 bg-card hover:border-sky-500/20"
                              }`}
                            >
                              {col}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                  {checks.includes("date_format") && (
                    <div className="rounded-lg border border-border/50 bg-muted/30 p-3 space-y-2">
                      <Label className="text-xs flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-amber-500" />
                        Date Columns — click to toggle
                      </Label>
                      <div className="flex flex-wrap gap-1.5">
                        {columns.map((col) => {
                          const active = dateColumns.includes(col)
                          return (
                            <button
                              key={col}
                              type="button"
                              onClick={() => toggleColumnInList(col, dateColumns, setDateColumns)}
                              className={`rounded-full px-2.5 py-1 text-xs transition-all border ${
                                active
                                  ? "border-amber-500/40 bg-amber-500/15 text-amber-500"
                                  : "border-border/50 bg-card hover:border-amber-500/20"
                              }`}
                            >
                              {col}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex items-center gap-2 pt-1">
              <Button
                onClick={handleValidate}
                disabled={!canRun || isProcessing}
                className="bg-lime-600 hover:bg-lime-700 text-white"
              >
                {isProcessing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="mr-2 h-4 w-4" />
                )}
                Run Validation
              </Button>
              <Badge variant="outline" className="text-[10px]">
                {checks.length} check{checks.length === 1 ? "" : "s"} selected
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
          {/* Score hero */}
          <Card className="relative overflow-hidden border-lime-500/20">
            <div className="absolute -top-12 -right-12 h-40 w-40 rounded-full bg-lime-500/10 blur-3xl" />
            <CardContent className="relative pt-6">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className={`h-5 w-5 ${scoreColor}`} />
                    <h3 className="text-lg font-semibold">Quality Report</h3>
                    <Badge variant="secondary" className="text-[10px]">
                      {result.filename}
                    </Badge>
                  </div>
                  <div className="flex items-baseline gap-3">
                    <span className={`text-5xl font-bold tabular-nums ${scoreColor}`}>
                      {result.overallScore}
                    </span>
                    <span className="text-sm text-muted-foreground">/ 100 quality score</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="flex items-center gap-1 text-rose-500">
                      <AlertCircle className="h-3 w-3" />
                      {result.summary.errors} errors
                    </span>
                    <span className="flex items-center gap-1 text-amber-500">
                      <AlertTriangle className="h-3 w-3" />
                      {result.summary.warnings} warnings
                    </span>
                    <span className="flex items-center gap-1 text-sky-500">
                      <Info className="h-3 w-3" />
                      {result.summary.infos} info
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button asChild>
                    <a href={downloadUrl(result.downloadUrl)} download>
                      <Download className="mr-2 h-4 w-4" />
                      Download Report
                    </a>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Summary stats grid */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="bg-gradient-to-br from-sky-500/10 to-transparent border-sky-500/20">
              <CardContent className="pt-4 pb-4">
                <p className="text-xs text-muted-foreground">Total Cells</p>
                <p className="text-2xl font-bold tabular-nums">{result.summary.totalCells}</p>
                <p className="text-[10px] text-muted-foreground mt-1">{result.summary.totalRows} rows × {result.summary.totalColumns} cols</p>
              </CardContent>
            </Card>
            <Card className="bg-gradient-to-br from-rose-500/10 to-transparent border-rose-500/20">
              <CardContent className="pt-4 pb-4">
                <p className="text-xs text-muted-foreground">Empty Cells</p>
                <p className="text-2xl font-bold tabular-nums">{result.summary.emptyCells}</p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {result.summary.totalCells > 0 ? ((result.summary.emptyCells / result.summary.totalCells) * 100).toFixed(1) : 0}% of cells
                </p>
              </CardContent>
            </Card>
            <Card className="bg-gradient-to-br from-amber-500/10 to-transparent border-amber-500/20">
              <CardContent className="pt-4 pb-4">
                <p className="text-xs text-muted-foreground">Constant Columns</p>
                <p className="text-2xl font-bold tabular-nums">{result.summary.constantColumns}</p>
                <p className="text-[10px] text-muted-foreground mt-1">Single-value columns</p>
              </CardContent>
            </Card>
            <Card className="bg-gradient-to-br from-fuchsia-500/10 to-transparent border-fuchsia-500/20">
              <CardContent className="pt-4 pb-4">
                <p className="text-xs text-muted-foreground">Mixed-Type Columns</p>
                <p className="text-2xl font-bold tabular-nums">{result.summary.mixedTypeColumns}</p>
                <p className="text-[10px] text-muted-foreground mt-1">Type inconsistencies</p>
              </CardContent>
            </Card>
          </div>

          {/* Column reports */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Type className="h-4 w-4" />
                Column Reports
              </CardTitle>
              <CardDescription>Detailed statistics for each column</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-md border border-border/50 max-h-96 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/80 backdrop-blur z-10">
                    <tr className="border-b border-border/50">
                      <th className="text-left p-2 font-medium">Column</th>
                      <th className="text-left p-2 font-medium">Type</th>
                      <th className="text-right p-2 font-medium">Empty</th>
                      <th className="text-right p-2 font-medium">Whitespace</th>
                      <th className="text-right p-2 font-medium">Unique</th>
                      <th className="text-left p-2 font-medium">Min</th>
                      <th className="text-left p-2 font-medium">Max</th>
                      <th className="text-right p-2 font-medium">Mean</th>
                      <th className="text-center p-2 font-medium">Constant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.columnReports.map((col, idx) => {
                      const TypeIcon = typeIconMap[col.detectedType] || Type
                      return (
                        <tr key={col.column} className={`border-b border-border/30 ${idx % 2 === 0 ? "" : "bg-muted/20"}`}>
                          <td className="p-2 font-medium">{col.column}</td>
                          <td className="p-2">
                            <Badge variant="outline" className={`text-[10px] gap-1 ${typeColorMap[col.detectedType]}`}>
                              <TypeIcon className="h-2.5 w-2.5" />
                              {col.detectedType}
                            </Badge>
                          </td>
                          <td className="p-2 text-right tabular-nums">
                            {col.emptyCells > 0 ? (
                              <span className="text-rose-500 font-medium">{col.emptyCells}</span>
                            ) : (
                              <span className="text-muted-foreground">0</span>
                            )}
                          </td>
                          <td className="p-2 text-right tabular-nums">
                            {col.whitespaceOnly > 0 ? (
                              <span className="text-amber-500 font-medium">{col.whitespaceOnly}</span>
                            ) : (
                              <span className="text-muted-foreground">0</span>
                            )}
                          </td>
                          <td className="p-2 text-right tabular-nums">{col.uniqueValues}</td>
                          <td className="p-2 text-muted-foreground truncate max-w-32">{String(col.min ?? "—")}</td>
                          <td className="p-2 text-muted-foreground truncate max-w-32">{String(col.max ?? "—")}</td>
                          <td className="p-2 text-right tabular-nums">{col.mean ?? "—"}</td>
                          <td className="p-2 text-center">
                            {col.isConstant ? (
                              <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-500 border-amber-500/30">Yes</Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Issues list */}
          {result.issues.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-rose-500" />
                  Issues Found
                  <Badge variant="secondary" className="text-[10px]">{result.issues.length} shown</Badge>
                </CardTitle>
                <CardDescription>First 200 issues — full list in downloaded report</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="max-h-96 overflow-y-auto rounded-md border border-border/50">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted/80 backdrop-blur z-10">
                      <tr className="border-b border-border/50">
                        <th className="text-left p-2 font-medium">Row</th>
                        <th className="text-left p-2 font-medium">Column</th>
                        <th className="text-left p-2 font-medium">Value</th>
                        <th className="text-center p-2 font-medium">Severity</th>
                        <th className="text-left p-2 font-medium">Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.issues.map((issue, idx) => (
                        <tr key={idx} className={`border-b border-border/30 ${idx % 2 === 0 ? "" : "bg-muted/20"}`}>
                          <td className="p-2 tabular-nums">{issue.row === 0 ? "—" : issue.row}</td>
                          <td className="p-2 font-medium">{issue.column}</td>
                          <td className="p-2 font-mono text-muted-foreground truncate max-w-32">{String(issue.value ?? "")}</td>
                          <td className="p-2 text-center">
                            <Badge
                              variant="outline"
                              className={`text-[10px] ${
                                issue.severity === "error"
                                  ? "bg-rose-500/10 text-rose-500 border-rose-500/30"
                                  : issue.severity === "warning"
                                  ? "bg-amber-500/10 text-amber-500 border-amber-500/30"
                                  : "bg-sky-500/10 text-sky-500 border-sky-500/30"
                              }`}
                            >
                              {issue.severity}
                            </Badge>
                          </td>
                          <td className="p-2 text-muted-foreground">{issue.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {result.issues.length === 0 && (
            <Card className="border-emerald-500/30 bg-emerald-500/5">
              <CardContent className="flex items-center justify-center py-10">
                <div className="text-center">
                  <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto mb-2" />
                  <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">No issues found</p>
                  <p className="text-xs text-muted-foreground mt-1">Your data passes all selected checks</p>
                </div>
              </CardContent>
            </Card>
          )}
        </motion.div>
      )}

      <DataPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        data={preview}
        title="Original File Preview"
      />
    </div>
  )
}
