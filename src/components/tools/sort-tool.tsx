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
import { ArrowUpDown, Download, CheckCircle2, Loader2, Eye, RotateCcw, ArrowUp, ArrowDown } from "lucide-react"
import { toast } from "sonner"
import { motion, AnimatePresence } from "framer-motion"
import { useAppStore } from "@/lib/store"
import { apiFetch, downloadUrl } from "@/lib/api"

interface SortResult {
  downloadUrl: string
  filename: string
  totalRows: number
  sortedBy: string
  order: string
  preview: Record<string, unknown>[]
}

export function SortTool() {
  const { incrementActiveTasks, decrementActiveTasks, pushNotification } = useAppStore()
  const [file, setFile] = useState<File | null>(null)
  const [columns, setColumns] = useState<string[]>([])
  const [selectedColumn, setSelectedColumn] = useState("")
  const [order, setOrder] = useState("asc")
  const [isProcessing, setIsProcessing] = useState(false)
  const [isLoadingColumns, setIsLoadingColumns] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<SortResult | null>(null)
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

  const handleSort = async () => {
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
      formData.append("order", order)

      setProgress(50)

      const response = await apiFetch("/api/tools/sort", {
        method: "POST",
        body: formData,
      })

      setProgress(80)
      const data = await response.json()

      if (!response.ok) throw new Error(data.error || "Failed to sort data")

      setProgress(100)
      setResult(data)
      toast.success(`Data sorted by "${selectedColumn}" (${order === "asc" ? "ascending" : "descending"})!`)
      pushNotification({
        title: "Sort complete",
        description: `${data.totalRows} rows sorted by "${selectedColumn}" ${order === "asc" ? "ascending" : "descending"}`,
        type: "success",
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to sort data"
      toast.error(msg)
      pushNotification({ title: "Sort failed", description: msg, type: "error" })
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
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-500">
                <ArrowUpDown className="h-4 w-4" />
              </div>
              <div>
                <CardTitle className="text-base">Data Sorter</CardTitle>
                <CardDescription>Sort your data by any column</CardDescription>
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
                  <Label>Sort By Column</Label>
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
                  <Label>Sort Order</Label>
                  <RadioGroup value={order} onValueChange={setOrder} className="flex gap-4 pt-2">
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="asc" id="sort-asc" />
                      <Label htmlFor="sort-asc" className="text-sm flex items-center gap-1">
                        <ArrowUp className="h-3 w-3" />
                        Ascending
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="desc" id="sort-desc" />
                      <Label htmlFor="sort-desc" className="text-sm flex items-center gap-1">
                        <ArrowDown className="h-3 w-3" />
                        Descending
                      </Label>
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
                  <DataTable data={preview} maxRows={50} searchable={false} />
                </div>
              )}
            </motion.div>
          )}

          {isProcessing && (
            <div className="space-y-2">
              <Progress value={progress} className="h-2" />
              <p className="text-xs text-muted-foreground text-center">Sorting data...</p>
            </div>
          )}

          <Button onClick={handleSort} disabled={isProcessing || !file || !selectedColumn} className="w-full">
            {isProcessing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <ArrowUpDown className="mr-2 h-4 w-4" />
                Sort Data
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <AnimatePresence>
        {result && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            <Card className="border-cyan-500/20 bg-cyan-500/5">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-cyan-500" />
                  <CardTitle className="text-base">Data Sorted</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="rounded-lg bg-background p-3">
                    <p className="text-xs text-muted-foreground">Total Rows</p>
                    <p className="text-lg font-semibold">{result.totalRows}</p>
                  </div>
                  <div className="rounded-lg bg-background p-3">
                    <p className="text-xs text-muted-foreground">Sorted By</p>
                    <p className="text-lg font-semibold truncate">{result.sortedBy}</p>
                  </div>
                  <div className="rounded-lg bg-background p-3">
                    <p className="text-xs text-muted-foreground">Order</p>
                    <p className="text-lg font-semibold flex items-center gap-1">
                      {result.order === "asc" ? (
                        <><ArrowUp className="h-4 w-4 text-emerald-500" /> Asc</>
                      ) : (
                        <><ArrowDown className="h-4 w-4 text-rose-500" /> Desc</>
                      )}
                    </p>
                  </div>
                </div>

                {result.preview.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Sorted Preview (first 10 rows)</Label>
                    <DataTable data={result.preview} maxRows={10} searchable={false} />
                  </div>
                )}

                <div className="flex gap-2">
                  <Button asChild className="flex-1">
                    <a href={downloadUrl(result.downloadUrl)} download>
                      <Download className="mr-2 h-4 w-4" />
                      Download
                    </a>
                  </Button>
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
        title="Sorted Data Preview"
      />
    </div>
  )
}
