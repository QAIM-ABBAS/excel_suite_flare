"use client"

import { useState } from "react"
import { FileDropzone } from "@/components/file-dropzone"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { DataTable } from "@/components/data-table"
import {
  Replace as ReplaceIcon, Download, CheckCircle2, Loader2, RotateCcw, Zap, ArrowRight, Regex, CaseSensitive, Search,
} from "lucide-react"
import { toast } from "sonner"
import { motion, AnimatePresence } from "framer-motion"
import { useAppStore } from "@/lib/store"
import { apiFetch, downloadUrl } from "@/lib/api"

interface ChangePreview {
  row: number
  column: string
  before: string
  after: string
}

interface ReplaceResult {
  success?: boolean
  downloadUrl?: string
  filename: string
  totalRows?: number
  scopedColumns?: string[]
  matchMode?: string
  caseSensitive?: boolean
  totalMatches?: number
  cellsChanged?: number
  rowsAffected?: number
  changes?: ChangePreview[]
  preview?: Record<string, unknown>[]
}

type MatchMode = "contains" | "exact" | "startsWith" | "endsWith"

const MATCH_MODES: { value: MatchMode; label: string; hint: string }[] = [
  { value: "contains", label: "Contains", hint: "Match anywhere in cell" },
  { value: "exact", label: "Exact match", hint: "Whole cell must equal find text" },
  { value: "startsWith", label: "Starts with", hint: "Cell begins with find text" },
  { value: "endsWith", label: "Ends with", hint: "Cell ends with find text" },
]

export function ReplaceTool() {
  const { incrementActiveTasks, decrementActiveTasks, pushNotification } = useAppStore()
  const [file, setFile] = useState<File | null>(null)
  const [columns, setColumns] = useState<string[]>([])
  const [selectedColumns, setSelectedColumns] = useState<string[]>([])
  const [find, setFind] = useState("")
  const [replace, setReplace] = useState("")
  const [matchMode, setMatchMode] = useState<MatchMode>("contains")
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [useRegex, setUseRegex] = useState(false)
  const [preview, setPreview] = useState<Record<string, unknown>[]>([])
  const [isLoadingColumns, setIsLoadingColumns] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<ReplaceResult | null>(null)

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
        setSelectedColumns([]) // empty = all columns by default
      }
    } catch {
      toast.error("Failed to read file columns")
    } finally {
      setIsLoadingColumns(false)
    }
  }

  const toggleColumn = (col: string) => {
    setSelectedColumns((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]
    )
  }

  const handleReplace = async () => {
    if (!file) {
      toast.error("Please select a file first")
      return
    }
    if (!find) {
      toast.error("Please enter text to find")
      return
    }
    if (useRegex) {
      try {
        new RegExp(find)
      } catch {
        toast.error("Invalid regular expression syntax")
        return
      }
    }

    setIsProcessing(true)
    setProgress(20)
    incrementActiveTasks()
    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("find", find)
      formData.append("replace", replace)
      formData.append("columns", JSON.stringify(selectedColumns))
      formData.append("matchMode", matchMode)
      formData.append("caseSensitive", String(caseSensitive))
      formData.append("useRegex", String(useRegex))

      setProgress(50)
      const response = await apiFetch("/api/tools/replace", { method: "POST", body: formData })
      setProgress(80)

      // Check if response is a file download
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || "Failed to perform find & replace")
        setProgress(100)
        setResult(data)
        toast.success(
          `Replaced ${data.totalMatches} match${data.totalMatches === 1 ? "" : "es"} across ${data.cellsChanged} cell${data.cellsChanged === 1 ? "" : "s"}`
        )
        pushNotification({
          title: "Find & Replace complete",
          description: `${data.totalMatches} matches in ${data.cellsChanged} cells (${data.rowsAffected} rows)`,
          type: data.totalMatches > 0 ? "success" : "info",
        })
      } else {
        // File download response
        const blob = await response.blob()
        const contentDisposition = response.headers.get("content-disposition") || "";
        const filenameMatch = contentDisposition.match(/filename="?(.+?)"?$/);
        const filename = filenameMatch ? filenameMatch[1] : "replaced_data.xlsx";
        
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
        toast.success("Find & Replace completed and file downloaded!")
        pushNotification({
          title: "Find & Replace complete",
          description: `File downloaded: ${filename}`,
          type: "success",
        })
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to perform find & replace"
      toast.error(msg)
      pushNotification({ title: "Find & Replace failed", description: msg, type: "error" })
    } finally {
      setIsProcessing(false)
      decrementActiveTasks()
      setTimeout(() => setProgress(0), 1000)
    }
  }

  const resetTool = () => {
    setFile(null)
    setColumns([])
    setSelectedColumns([])
    setFind("")
    setReplace("")
    setResult(null)
    setPreview([])
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-fuchsia-500/10 text-fuchsia-500">
                <ReplaceIcon className="h-4 w-4" />
              </div>
              <div>
                <CardTitle className="text-base">Find &amp; Replace</CardTitle>
                <CardDescription>Search and replace text across cells with scope control</CardDescription>
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
              {/* Find + Replace inputs */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground flex items-center gap-1">
                    <Search className="h-3 w-3" />
                    Find <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    value={find}
                    onChange={(e) => setFind(e.target.value)}
                    placeholder={useRegex ? "Enter regex pattern..." : "Text to find..."}
                    className="font-mono text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground flex items-center gap-1">
                    <ArrowRight className="h-3 w-3" />
                    Replace with
                  </Label>
                  <Input
                    value={replace}
                    onChange={(e) => setReplace(e.target.value)}
                    placeholder="Replacement text (can be empty)..."
                    className="font-mono text-sm"
                  />
                </div>
              </div>

              {/* Match options */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Match Mode</Label>
                  <Select
                    value={matchMode}
                    onValueChange={(v) => setMatchMode(v as MatchMode)}
                    disabled={useRegex}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MATCH_MODES.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                          <span className="ml-1 text-[10px] text-muted-foreground">— {m.hint}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end gap-4 pb-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Switch checked={caseSensitive} onCheckedChange={setCaseSensitive} />
                    <span className="text-xs flex items-center gap-1">
                      <CaseSensitive className="h-3 w-3" />
                      Case sensitive
                    </span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Switch checked={useRegex} onCheckedChange={setUseRegex} />
                    <span className="text-xs flex items-center gap-1">
                      <Regex className="h-3 w-3" />
                      Regex
                    </span>
                  </label>
                </div>
              </div>

              {/* Column scope chips */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">
                    Scope (columns to search)
                  </Label>
                  <Badge variant="secondary" className="text-[10px]">
                    {selectedColumns.length === 0 ? "All columns" : `${selectedColumns.length} selected`}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {columns.map((col) => {
                    const active = selectedColumns.includes(col)
                    return (
                      <button
                        key={col}
                        type="button"
                        onClick={() => toggleColumn(col)}
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-all ${
                          active
                            ? "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400"
                            : "border-border/50 bg-muted/30 hover:bg-muted/60"
                        }`}
                      >
                        {col}
                      </button>
                    )
                  })}
                </div>
                {selectedColumns.length === 0 && (
                  <p className="text-[10px] text-muted-foreground">
                    No columns selected — search will apply to all columns.
                  </p>
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
              <p className="text-xs text-muted-foreground text-center">Replacing matches...</p>
            </div>
          )}

          <Button
            onClick={handleReplace}
            disabled={isProcessing || !file || !find}
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
                Find &amp; Replace
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <AnimatePresence>
        {result && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            <Card className="border-fuchsia-500/20 bg-fuchsia-500/5">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-fuchsia-500" />
                  <CardTitle className="text-base">Replace Complete</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2 sm:grid-cols-4">
                  <div className="rounded-lg bg-background p-3">
                    <p className="text-xs text-muted-foreground">Total Matches</p>
                    <p className="text-lg font-semibold text-fuchsia-500">{result.totalMatches || 0}</p>
                  </div>
                  <div className="rounded-lg bg-background p-3">
                    <p className="text-xs text-muted-foreground">Cells Changed</p>
                    <p className="text-lg font-semibold">{result.cellsChanged || 0}</p>
                  </div>
                  <div className="rounded-lg bg-background p-3">
                    <p className="text-xs text-muted-foreground">Rows Affected</p>
                    <p className="text-lg font-semibold">{result.rowsAffected || 0}</p>
                  </div>
                  <div className="rounded-lg bg-background p-3">
                    <p className="text-xs text-muted-foreground">Total Rows</p>
                    <p className="text-lg font-semibold">{result.totalRows || 0}</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="secondary" className="text-[10px]">
                    Mode: {useRegex ? "regex" : matchMode}
                  </Badge>
                  <Badge variant="secondary" className="text-[10px]">
                    Case: {caseSensitive ? "sensitive" : "insensitive"}
                  </Badge>
                  <Badge variant="secondary" className="text-[10px]">
                    Scope: {(result.scopedColumns?.length || 0) === columns.length ? "all columns" : `${result.scopedColumns?.length || 0} columns`}
                  </Badge>
                </div>

                {/* Change preview list */}
                {result.changes && result.changes.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">
                      Change Preview ({result.changes.length}{(result.totalMatches || 0) > 50 ? " of first 50" : ""} shown)
                    </Label>
                    <div className="max-h-72 overflow-y-auto scrollbar-thin rounded-lg border border-border/50">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
                          <tr>
                            <th className="px-2 py-1.5 text-left font-medium">Row</th>
                            <th className="px-2 py-1.5 text-left font-medium">Column</th>
                            <th className="px-2 py-1.5 text-left font-medium">Before</th>
                            <th className="px-2 py-1.5 text-left font-medium">After</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.changes.map((c, i) => (
                            <tr key={i} className="border-t border-border/30 hover:bg-muted/30">
                              <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{c.row}</td>
                              <td className="px-2 py-1.5 font-mono">{c.column}</td>
                              <td className="px-2 py-1.5 font-mono text-rose-500/90">{c.before || <span className="italic text-muted-foreground">(empty)</span>}</td>
                              <td className="px-2 py-1.5 font-mono text-emerald-500/90">{c.after || <span className="italic text-muted-foreground">(empty)</span>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {result.totalMatches === 0 && (
                  <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                    No matches found. Try adjusting your search criteria.
                  </div>
                )}

                <div className="flex gap-2">
                  {result.downloadUrl && (
                    <Button asChild className="flex-1" disabled={(result.totalMatches || 0) === 0}>
                      <a href={downloadUrl(result.downloadUrl)} download>
                        <Download className="mr-2 h-4 w-4" />
                        Download
                      </a>
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
