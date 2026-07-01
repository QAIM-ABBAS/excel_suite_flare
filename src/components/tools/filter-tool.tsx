"use client"

import { useState } from "react"
import { FileDropzone } from "@/components/file-dropzone"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { DataTable } from "@/components/data-table"
import { DataPreviewDialog } from "@/components/data-preview-dialog"
import { Filter as FilterIcon, Download, CheckCircle2, Loader2, Eye, RotateCcw, Plus, Trash2, Zap } from "lucide-react"
import { toast } from "sonner"
import { motion, AnimatePresence } from "framer-motion"
import { useAppStore } from "@/lib/store"
import { apiFetch, downloadUrl } from "@/lib/api"

type Operator =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "starts_with"
  | "ends_with"
  | "greater_than"
  | "less_than"
  | "greater_or_equal"
  | "less_or_equal"
  | "is_empty"
  | "is_not_empty"

interface Condition {
  id: string
  column: string
  operator: Operator
  value: string
}

interface FilterResult {
  downloadUrl: string
  filename: string
  totalRows: number
  matchedRows: number
  removedRows: number
  preview: Record<string, unknown>[]
}

const OPERATORS: { value: Operator; label: string; needsValue: boolean }[] = [
  { value: "equals", label: "Equals", needsValue: true },
  { value: "not_equals", label: "Not equals", needsValue: true },
  { value: "contains", label: "Contains", needsValue: true },
  { value: "not_contains", label: "Not contains", needsValue: true },
  { value: "starts_with", label: "Starts with", needsValue: true },
  { value: "ends_with", label: "Ends with", needsValue: true },
  { value: "greater_than", label: "Greater than", needsValue: true },
  { value: "less_than", label: "Less than", needsValue: true },
  { value: "greater_or_equal", label: "Greater or equal", needsValue: true },
  { value: "less_or_equal", label: "Less or equal", needsValue: true },
  { value: "is_empty", label: "Is empty", needsValue: false },
  { value: "is_not_empty", label: "Is not empty", needsValue: false },
]

let conditionSeq = 0
const newConditionId = () => `cond-${++conditionSeq}-${Date.now()}`

export function FilterTool() {
  const { incrementActiveTasks, decrementActiveTasks, pushNotification } = useAppStore()
  const [file, setFile] = useState<File | null>(null)
  const [columns, setColumns] = useState<string[]>([])
  const [conditions, setConditions] = useState<Condition[]>([])
  const [combineWith, setCombineWith] = useState<"AND" | "OR">("AND")
  const [isLoadingColumns, setIsLoadingColumns] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<FilterResult | null>(null)
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
      const response = await apiFetch("/api/tools/columns", {
        method: "POST",
        body: formData,
      })
      const data = await response.json()
      if (data.success && data.sheets.length > 0) {
        const cols = data.sheets[0].columns
        setColumns(cols)
        setPreview(data.preview || [])
        // Seed with a default first condition
        if (cols.length > 0) {
          setConditions([
            {
              id: newConditionId(),
              column: cols[0],
              operator: "contains",
              value: "",
            },
          ])
        }
      }
    } catch {
      toast.error("Failed to read file columns")
    } finally {
      setIsLoadingColumns(false)
    }
  }

  const addCondition = () => {
    if (columns.length === 0) return
    setConditions((prev) => [
      ...prev,
      {
        id: newConditionId(),
        column: columns[0],
        operator: "contains",
        value: "",
      },
    ])
  }

  const removeCondition = (id: string) => {
    setConditions((prev) => (prev.length > 1 ? prev.filter((c) => c.id !== id) : prev))
  }

  const updateCondition = (id: string, patch: Partial<Condition>) => {
    setConditions((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  const handleFilter = async () => {
    if (!file || conditions.length === 0) {
      toast.error("Please select a file and add at least one condition")
      return
    }
    // Validate value present for operators that need it
    for (const c of conditions) {
      const opDef = OPERATORS.find((o) => o.value === c.operator)
      if (opDef?.needsValue && c.value.trim() === "") {
        toast.error(`Please enter a value for the "${opDef.label}" condition`)
        return
      }
    }

    setIsProcessing(true)
    setProgress(20)
    incrementActiveTasks()
    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("conditions", JSON.stringify(conditions))
      formData.append("combineWith", combineWith)
      setProgress(50)
      const response = await apiFetch("/api/tools/filter", {
        method: "POST",
        body: formData,
      })
      setProgress(80)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Failed to filter data")
      setProgress(100)
      setResult(data)
      toast.success(
        `Filtered: ${data.matchedRows} of ${data.totalRows} rows matched (${data.removedRows} removed)`
      )
      pushNotification({
        title: "Filter complete",
        description: `${data.matchedRows} of ${data.totalRows} rows matched (${conditions.length} condition${conditions.length === 1 ? "" : "s"}, ${combineWith})`,
        type: data.matchedRows > 0 ? "success" : "warning",
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to filter data"
      toast.error(msg)
      pushNotification({ title: "Filter failed", description: msg, type: "error" })
    } finally {
      setIsProcessing(false)
      decrementActiveTasks()
      setTimeout(() => setProgress(0), 1000)
    }
  }

  const resetTool = () => {
    setFile(null)
    setColumns([])
    setConditions([])
    setResult(null)
    setPreview([])
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-500/10 text-orange-500">
                <FilterIcon className="h-4 w-4" />
              </div>
              <div>
                <CardTitle className="text-base">Data Filter</CardTitle>
                <CardDescription>Filter rows by one or more conditions</CardDescription>
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
              {/* Combine toggle */}
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Match conditions</Label>
                <RadioGroup
                  value={combineWith}
                  onValueChange={(v) => setCombineWith(v as "AND" | "OR")}
                  className="flex gap-4"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="AND" id="filter-and" />
                    <Label htmlFor="filter-and" className="text-sm">ALL conditions (AND)</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="OR" id="filter-or" />
                    <Label htmlFor="filter-or" className="text-sm">ANY condition (OR)</Label>
                  </div>
                </RadioGroup>
              </div>

              {/* Conditions list */}
              <div className="space-y-2">
                <AnimatePresence initial={false}>
                  {conditions.map((c, idx) => {
                    const opDef = OPERATORS.find((o) => o.value === c.operator)
                    return (
                      <motion.div
                        key={c.id}
                        layout
                        initial={{ opacity: 0, y: -5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, x: -10 }}
                        className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1.4fr_auto] gap-2 items-end rounded-lg border border-border/50 bg-muted/20 p-2"
                      >
                        <div className="space-y-1">
                          <Label className="text-[10px] text-muted-foreground">Column</Label>
                          <Select value={c.column} onValueChange={(v) => updateCondition(c.id, { column: v })}>
                            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {columns.map((col) => (
                                <SelectItem key={col} value={col}>{col}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] text-muted-foreground">Operator</Label>
                          <Select
                            value={c.operator}
                            onValueChange={(v) => updateCondition(c.id, { operator: v as Operator })}
                          >
                            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {OPERATORS.map((o) => (
                                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] text-muted-foreground">Value</Label>
                          <Input
                            className="h-9"
                            value={c.value}
                            disabled={!opDef?.needsValue}
                            placeholder={opDef?.needsValue ? "Type a value..." : "No value needed"}
                            onChange={(e) => updateCondition(c.id, { value: e.target.value })}
                          />
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 shrink-0"
                          disabled={conditions.length === 1}
                          onClick={() => removeCondition(c.id)}
                          title="Remove condition"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </motion.div>
                    )
                  })}
                </AnimatePresence>

                <Button variant="outline" size="sm" onClick={addCondition} className="w-full border-dashed">
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add Condition
                </Button>
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
              <p className="text-xs text-muted-foreground text-center">Filtering rows...</p>
            </div>
          )}

          <Button onClick={handleFilter} disabled={isProcessing || !file || conditions.length === 0} className="w-full">
            {isProcessing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Zap className="mr-2 h-4 w-4" />
                Apply {conditions.length} Filter{conditions.length === 1 ? "" : "s"}
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <AnimatePresence>
        {result && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            <Card className="border-orange-500/20 bg-orange-500/5">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-orange-500" />
                  <CardTitle className="text-base">Rows Filtered</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="rounded-lg bg-background p-3">
                    <p className="text-xs text-muted-foreground">Total Rows</p>
                    <p className="text-lg font-semibold">{result.totalRows}</p>
                  </div>
                  <div className="rounded-lg bg-background p-3">
                    <p className="text-xs text-muted-foreground">Matched</p>
                    <p className="text-lg font-semibold text-emerald-500">{result.matchedRows}</p>
                  </div>
                  <div className="rounded-lg bg-background p-3">
                    <p className="text-xs text-muted-foreground">Removed</p>
                    <p className="text-lg font-semibold text-rose-500">{result.removedRows}</p>
                  </div>
                </div>

                {result.preview.length > 0 ? (
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Filtered Preview (first 10 rows)</Label>
                    <DataTable data={result.preview} maxRows={10} searchable={false} />
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                    No rows matched the filter conditions.
                  </div>
                )}

                <div className="flex gap-2">
                  <Button asChild className="flex-1" disabled={result.matchedRows === 0}>
                    <a href={downloadUrl(result.downloadUrl)} download>
                      <Download className="mr-2 h-4 w-4" />
                      Download
                    </a>
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setPreviewOpen(true)}
                    className="flex-1"
                    disabled={result.matchedRows === 0}
                  >
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
        title="Filtered Data Preview"
      />
    </div>
  )
}
