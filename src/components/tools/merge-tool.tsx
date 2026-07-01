"use client"

import { useState } from "react"
import { FileDropzone } from "@/components/file-dropzone"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { DataTable } from "@/components/data-table"
import { DataPreviewDialog } from "@/components/data-preview-dialog"
import { GitMerge, Download, Trash2, AlertTriangle, CheckCircle2, Loader2, Eye, FileSpreadsheet } from "lucide-react"
import { toast } from "sonner"
import { motion, AnimatePresence } from "framer-motion"
import { useAppStore } from "@/lib/store"
import { apiFetch, downloadUrl } from "@/lib/api"

interface MergeResult {
  success?: boolean
  downloadUrl?: string
  filename: string
  totalRows?: number
  headers?: string[]
  hasMismatch?: boolean
  mismatchWarning?: string
  preview?: Record<string, unknown>[]
}

export function MergeTool() {
  const { incrementActiveTasks, decrementActiveTasks, pushNotification } = useAppStore()
  const [files, setFiles] = useState<File[]>([])
  const [outputFormat, setOutputFormat] = useState("xlsx")
  const [outputFilename, setOutputFilename] = useState("merged")
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<MergeResult | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)

  const handleFilesSelected = (newFiles: File[]) => {
    setFiles(prev => [...prev, ...newFiles])
    setResult(null)
  }

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index))
    setResult(null)
  }

  const clearAll = () => {
    setFiles([])
    setResult(null)
  }

  const handleMerge = async () => {
    if (files.length < 2) {
      toast.error("Please upload at least 2 files to merge")
      return
    }

    setIsProcessing(true)
    setProgress(10)
    incrementActiveTasks()

    try {
      const formData = new FormData()
      files.forEach(file => formData.append("files", file))
      formData.append("outputFormat", outputFormat)
      formData.append("outputFilename", outputFilename)

      setProgress(40)

      const response = await apiFetch("/api/tools/merge", {
        method: "POST",
        body: formData,
      })

      setProgress(80)

      // Check if response is a file download
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const data = await response.json()
        if (!response.ok) {
          throw new Error(data.error || "Merge failed")
        }
        setProgress(100)
        setResult(data)
        toast.success(`Merged ${files.length} files successfully! ${data.totalRows} total rows.`)
      } else {
        // File download response
        const blob = await response.blob()
        const contentDisposition = response.headers.get("content-disposition") || "";
        const filenameMatch = contentDisposition.match(/filename="?(.+?)"?$/);
        const filename = filenameMatch ? filenameMatch[1] : "merged_output.xlsx";
        
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
        setResult({ success: true, filename, totalRows: 0 })
        toast.success(`Merged ${files.length} files successfully!`)
        pushNotification({
          title: "Merge complete",
          description: `${files.length} files merged → ${filename}`,
          type: "success",
        })
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Merge failed"
      toast.error(msg)
      pushNotification({ title: "Merge failed", description: msg, type: "error" })
    } finally {
      setIsProcessing(false)
      decrementActiveTasks()
      setTimeout(() => setProgress(0), 1000)
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
              <GitMerge className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-base">Merge Excel / CSV Files</CardTitle>
              <CardDescription>Combine multiple files into one</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <FileDropzone
            multiple
            onFilesSelected={handleFilesSelected}
            label="Drop Excel or CSV files here"
            description="Upload 2 or more files to merge"
          />

          <AnimatePresence>
            {files.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-2"
              >
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Uploaded Files ({files.length})</Label>
                  <Button variant="ghost" size="sm" onClick={clearAll} className="h-7 text-xs text-muted-foreground">
                    Clear All
                  </Button>
                </div>
                {files.map((file, index) => (
                  <motion.div
                    key={`${file.name}-${index}`}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/30 px-3 py-2"
                  >
                    <div className="flex items-center gap-2 text-sm min-w-0">
                      <FileSpreadsheet className="h-4 w-4 text-emerald-500 shrink-0" />
                      <span className="truncate max-w-[200px]">{file.name}</span>
                      <Badge variant="secondary" className="text-[10px] shrink-0">
                        {(file.size / 1024).toFixed(1)} KB
                      </Badge>
                    </div>
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => removeFile(index)}>
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </motion.div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Output Format</Label>
              <RadioGroup value={outputFormat} onValueChange={setOutputFormat} className="flex gap-4">
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="xlsx" id="xlsx" />
                  <Label htmlFor="xlsx" className="text-sm">Excel (.xlsx)</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="csv" id="csv" />
                  <Label htmlFor="csv" className="text-sm">CSV (.csv)</Label>
                </div>
              </RadioGroup>
            </div>
            <div className="space-y-2">
              <Label htmlFor="filename">Output Filename</Label>
              <Input
                id="filename"
                value={outputFilename}
                onChange={(e) => setOutputFilename(e.target.value)}
                placeholder="merged"
                className="h-9"
              />
            </div>
          </div>

          {isProcessing && (
            <div className="space-y-2">
              <Progress value={progress} className="h-2" />
              <p className="text-xs text-muted-foreground text-center">Processing...</p>
            </div>
          )}

          <Button
            onClick={handleMerge}
            disabled={isProcessing || files.length < 2}
            className="w-full"
          >
            {isProcessing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Merging...
              </>
            ) : (
              <>
                <GitMerge className="mr-2 h-4 w-4" />
                Merge {files.length} Files
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <Card className="border-emerald-500/20 bg-emerald-500/5">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  <CardTitle className="text-base">Merge Complete</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {result.hasMismatch && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                    <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                    <p className="text-sm text-amber-600 dark:text-amber-400">{result.mismatchWarning}</p>
                  </div>
                )}
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-lg bg-background p-3">
                    <p className="text-xs text-muted-foreground">Total Rows</p>
                    <p className="text-lg font-semibold">{result.totalRows || 0}</p>
                  </div>
                  <div className="rounded-lg bg-background p-3">
                    <p className="text-xs text-muted-foreground">Columns</p>
                    <p className="text-lg font-semibold">{result.headers?.length || 0}</p>
                  </div>
                </div>

                {result.headers && result.headers.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Merged Columns</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {result.headers.map(h => (
                        <Badge key={h} variant="outline" className="text-[10px]">
                          {h}
                        </Badge>
                      ))}
                    </div>
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
                    Preview Data
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
        title="Merged Data Preview"
      />
    </div>
  )
}
