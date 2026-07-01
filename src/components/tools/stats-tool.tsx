"use client"

import { useState } from "react"
import { FileDropzone } from "@/components/file-dropzone"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import {
  BarChart3,
  Download,
  CheckCircle2,
  Loader2,
  RotateCcw,
  Hash,
  Type,
  Sigma,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react"
import { toast } from "sonner"
import { motion, AnimatePresence } from "framer-motion"
import { useAppStore } from "@/lib/store"
import { apiFetch, downloadUrl } from "@/lib/api"

interface ColumnStats {
  column: string
  type: "numeric" | "text" | "mixed" | "empty"
  count: number
  distinct: number
  missing: number
  sum?: number
  avg?: number
  min?: number
  max?: number
  median?: number
  stdDev?: number
  minLength?: number
  maxLength?: number
  topValues?: { value: string; count: number }[]
}

interface StatsResult {
  downloadUrl?: string
  filename?: string
  totalRows: number
  totalColumns: number
  stats: ColumnStats[]
}

const typeColor: Record<ColumnStats["type"], string> = {
  numeric: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  text: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  mixed: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  empty: "bg-muted text-muted-foreground",
}

const typeIcon: Record<ColumnStats["type"], typeof Hash> = {
  numeric: Hash,
  text: Type,
  mixed: Sigma,
  empty: Minus,
}

function formatNumber(n: number | undefined): string {
  if (n === undefined || n === null || isNaN(n)) return "-"
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M"
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(2) + "K"
  if (Number.isInteger(n)) return n.toLocaleString()
  return n.toFixed(2)
}

export function StatsTool() {
  const { incrementActiveTasks, decrementActiveTasks, pushNotification } = useAppStore()
  const [file, setFile] = useState<File | null>(null)
  const [isLoadingColumns, setIsLoadingColumns] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<StatsResult | null>(null)

  const handleFileSelected = async (files: File[]) => {
    const selected = files[0]
    setFile(selected)
    setResult(null)
    setIsLoadingColumns(true)
    try {
      // Validate the file is readable by querying columns quickly
      const formData = new FormData()
      formData.append("file", selected)
      const response = await apiFetch("/api/tools/columns", { method: "POST", body: formData })
      const data = await response.json()
      if (!data.success) throw new Error(data.error || "Failed to read file")
    } catch {
      toast.error("Failed to read file columns")
    } finally {
      setIsLoadingColumns(false)
    }
  }

  const handleAnalyze = async () => {
    if (!file) {
      toast.error("Please select a file first")
      return
    }
    setIsProcessing(true)
    setProgress(20)
    incrementActiveTasks()
    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("generateReport", "true")
      setProgress(50)
      const response = await apiFetch("/api/tools/stats", { method: "POST", body: formData })
      setProgress(80)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Failed to analyze data")
      setProgress(100)
      setResult(data)
      toast.success(`Analyzed ${data.totalColumns} columns across ${data.totalRows} rows`)
      pushNotification({
        title: "Statistics computed",
        description: `${data.totalRows} rows × ${data.totalColumns} columns analyzed`,
        type: "success",
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to analyze data"
      toast.error(msg)
      pushNotification({ title: "Statistics failed", description: msg, type: "error" })
    } finally {
      setIsProcessing(false)
      decrementActiveTasks()
      setTimeout(() => setProgress(0), 1000)
    }
  }

  const resetTool = () => {
    setFile(null)
    setResult(null)
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-500">
                <BarChart3 className="h-4 w-4" />
              </div>
              <div>
                <CardTitle className="text-base">Statistics &amp; Summary</CardTitle>
                <CardDescription>Compute descriptive statistics for every column</CardDescription>
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
              Reading file...
            </div>
          )}

          {file && !isLoadingColumns && (
            <div className="rounded-lg border border-border/50 bg-muted/20 p-3 text-sm">
              <span className="text-muted-foreground">Selected: </span>
              <span className="font-medium">{file.name}</span>
              <span className="text-muted-foreground"> ({(file.size / 1024).toFixed(1)} KB)</span>
            </div>
          )}

          {isProcessing && (
            <div className="space-y-2">
              <Progress value={progress} className="h-2" />
              <p className="text-xs text-muted-foreground text-center">Computing statistics...</p>
            </div>
          )}

          <Button onClick={handleAnalyze} disabled={isProcessing || !file} className="w-full">
            {isProcessing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <BarChart3 className="mr-2 h-4 w-4" />
                Analyze &amp; Generate Report
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <AnimatePresence>
        {result && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
            {/* Summary header card */}
            <Card className="border-indigo-500/20 bg-indigo-500/5">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-indigo-500" />
                    <CardTitle className="text-base">Analysis Complete</CardTitle>
                  </div>
                  {result.downloadUrl && (
                    <Button asChild size="sm">
                      <a href={downloadUrl(result.downloadUrl)} download>
                        <Download className="mr-1.5 h-3.5 w-3.5" />
                        Download Report
                      </a>
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="rounded-lg bg-background p-3">
                    <p className="text-xs text-muted-foreground">Total Rows</p>
                    <p className="text-lg font-semibold">{result.totalRows.toLocaleString()}</p>
                  </div>
                  <div className="rounded-lg bg-background p-3">
                    <p className="text-xs text-muted-foreground">Total Columns</p>
                    <p className="text-lg font-semibold">{result.totalColumns}</p>
                  </div>
                  <div className="rounded-lg bg-background p-3">
                    <p className="text-xs text-muted-foreground">Cells</p>
                    <p className="text-lg font-semibold">
                      {(result.totalRows * result.totalColumns).toLocaleString()}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Per-column stat cards */}
            <div className="grid gap-4 md:grid-cols-2">
              {result.stats.map((s, i) => {
                const TypeIcon = typeIcon[s.type] || Minus
                return (
                  <motion.div
                    key={s.column}
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.04 }}
                  >
                    <Card className="overflow-hidden h-full">
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between gap-2">
                          <CardTitle className="text-sm truncate" title={s.column}>
                            {s.column}
                          </CardTitle>
                          <Badge className={`text-[10px] gap-1 ${typeColor[s.type]}`}>
                            <TypeIcon className="h-2.5 w-2.5" />
                            {s.type}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {/* Base stats */}
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Filled</p>
                            <p className="text-sm font-semibold">{s.count}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Distinct</p>
                            <p className="text-sm font-semibold">{s.distinct}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Missing</p>
                            <p className="text-sm font-semibold text-rose-500">{s.missing}</p>
                          </div>
                        </div>

                        {/* Numeric stats */}
                        {(s.type === "numeric" || s.type === "mixed") && (
                          <div className="grid grid-cols-2 gap-1.5 text-xs">
                            {[
                              { label: "Sum", value: formatNumber(s.sum) },
                              { label: "Avg", value: formatNumber(s.avg) },
                              { label: "Min", value: formatNumber(s.min) },
                              { label: "Max", value: formatNumber(s.max) },
                              { label: "Median", value: formatNumber(s.median) },
                              { label: "Std Dev", value: formatNumber(s.stdDev) },
                            ].map((m) => (
                              <div key={m.label} className="flex items-center justify-between rounded-md bg-muted/40 px-2 py-1">
                                <span className="text-muted-foreground">{m.label}</span>
                                <span className="font-medium tabular-nums">{m.value}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Text length stats */}
                        {(s.type === "text" || s.type === "mixed") && s.minLength !== undefined && (
                          <div className="grid grid-cols-2 gap-1.5 text-xs">
                            <div className="flex items-center justify-between rounded-md bg-muted/40 px-2 py-1">
                              <span className="text-muted-foreground">Min Length</span>
                              <span className="font-medium tabular-nums">{s.minLength}</span>
                            </div>
                            <div className="flex items-center justify-between rounded-md bg-muted/40 px-2 py-1">
                              <span className="text-muted-foreground">Max Length</span>
                              <span className="font-medium tabular-nums">{s.maxLength}</span>
                            </div>
                          </div>
                        )}

                        {/* Top values */}
                        {s.topValues && s.topValues.length > 0 && (
                          <div className="space-y-1.5">
                            <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
                              Top Values
                            </Label>
                            <div className="space-y-1">
                              {s.topValues.slice(0, 3).map((tv, idx) => {
                                const pct = s.count > 0 ? (tv.count / s.count) * 100 : 0
                                return (
                                  <div key={idx} className="space-y-0.5">
                                    <div className="flex items-center justify-between text-xs">
                                      <span className="truncate font-mono pr-2" title={tv.value}>
                                        {tv.value || <span className="italic text-muted-foreground">(blank)</span>}
                                      </span>
                                      <span className="text-muted-foreground tabular-nums shrink-0">
                                        {tv.count} ({pct.toFixed(0)}%)
                                      </span>
                                    </div>
                                    <div className="h-1 rounded-full bg-muted overflow-hidden">
                                      <motion.div
                                        initial={{ width: 0 }}
                                        animate={{ width: `${pct}%` }}
                                        transition={{ duration: 0.6, ease: "easeOut", delay: 0.1 + idx * 0.05 }}
                                        className="h-full bg-primary/70"
                                      />
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </motion.div>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
