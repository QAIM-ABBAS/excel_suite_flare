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
import { DataPreviewDialog } from "@/components/data-preview-dialog"
import { ArrowLeftRight, Download, CheckCircle2, Loader2, Eye, FileSpreadsheet } from "lucide-react"
import { toast } from "sonner"
import { motion, AnimatePresence } from "framer-motion"
import { useAppStore } from "@/lib/store"
import { apiFetch, downloadUrl } from "@/lib/api"

interface ConvertResult {
  success?: boolean
  downloadUrl?: string
  filename: string
  sheets?: string[]
}

export function ConvertTool() {
  const { incrementActiveTasks, decrementActiveTasks, pushNotification } = useAppStore()
  const [file, setFile] = useState<File | null>(null)
  const [targetFormat, setTargetFormat] = useState("xlsx")
  const [sheets, setSheets] = useState<string[]>([])
  const [selectedSheet, setSelectedSheet] = useState("")
  const [delimiter, setDelimiter] = useState(",")
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<ConvertResult | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)

  const handleFileSelected = async (files: File[]) => {
    const selected = files[0]
    setFile(selected)
    setResult(null)

    // Get sheet names
    try {
      const formData = new FormData()
      formData.append("file", selected)

      const response = await apiFetch("/api/tools/columns", {
        method: "POST",
        body: formData,
      })

      const data = await response.json()
      if (data.success) {
        setSheets(data.sheets.map((s: { name: string }) => s.name))
        setSelectedSheet(data.sheets[0]?.name || "")
      }
    } catch {
      // Ignore - sheet selection is optional
    }
  }

  const handleConvert = async () => {
    if (!file) {
      toast.error("Please upload a file first")
      return
    }

    setIsProcessing(true)
    setProgress(20)
    incrementActiveTasks()

    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("targetFormat", targetFormat)
      if (selectedSheet) formData.append("sheetName", selectedSheet)
      formData.append("delimiter", delimiter)

      setProgress(50)

      const response = await apiFetch("/api/tools/convert", {
        method: "POST",
        body: formData,
      })

      setProgress(80)

      // Check if response is a file download
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || "Conversion failed")
        setProgress(100)
        setResult(data)
        toast.success("File converted successfully!")
      } else {
        // File download response
        const blob = await response.blob()
        const contentDisposition = response.headers.get("content-disposition") || "";
        const filenameMatch = contentDisposition.match(/filename="?(.+?)"?$/);
        const filename = filenameMatch ? filenameMatch[1] : `converted.${targetFormat}`;
        
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
        toast.success("File converted successfully!")
      }
      pushNotification({
        title: "Conversion complete",
        description: `${file.name} → ${targetFormat.toUpperCase()}`,
        type: "success",
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Conversion failed"
      toast.error(msg)
      pushNotification({ title: "Conversion failed", description: msg, type: "error" })
    } finally {
      setIsProcessing(false)
      decrementActiveTasks()
      setTimeout(() => setProgress(0), 1000)
    }
  }

  const detectedFormat = file?.name.endsWith(".csv") ? "CSV" : "Excel"
  const canConvert = targetFormat === "xlsx" ? "CSV → Excel" : "Excel → CSV"
  const showDelimiter = targetFormat === "csv" || (file?.name.endsWith(".csv") ?? false)

  return (
    <div className="space-y-6 max-w-3xl">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
              <ArrowLeftRight className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-base">CSV ⇄ Excel Converter</CardTitle>
              <CardDescription>Convert between CSV and Excel formats</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <FileDropzone
            multiple={false}
            onFilesSelected={handleFileSelected}
            label="Drop an Excel or CSV file here"
            description="Supports .xlsx, .xls, and .csv files"
          />

          {file && (
            <div className="rounded-lg border border-border/50 bg-muted/30 p-3">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-amber-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{detectedFormat} format • {(file.size / 1024).toFixed(1)} KB</p>
                </div>
                {sheets.length > 0 && (
                  <Badge variant="secondary" className="text-[10px] shrink-0">
                    {sheets.length} sheet{sheets.length > 1 ? "s" : ""}
                  </Badge>
                )}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>Convert To</Label>
            <RadioGroup value={targetFormat} onValueChange={setTargetFormat} className="flex gap-4">
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="xlsx" id="to-xlsx" />
                <Label htmlFor="to-xlsx" className="text-sm">Excel (.xlsx)</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="csv" id="to-csv" />
                <Label htmlFor="to-csv" className="text-sm">CSV (.csv)</Label>
              </div>
            </RadioGroup>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {sheets.length > 1 && targetFormat === "csv" && (
              <div className="space-y-2">
                <Label>Select Sheet</Label>
                <Select value={selectedSheet} onValueChange={setSelectedSheet}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select sheet" />
                  </SelectTrigger>
                  <SelectContent>
                    {sheets.map(sheet => (
                      <SelectItem key={sheet} value={sheet}>{sheet}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {showDelimiter && (
              <div className="space-y-2">
                <Label>CSV Delimiter</Label>
                <Select value={delimiter} onValueChange={setDelimiter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select delimiter" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value=",">Comma (,)</SelectItem>
                    <SelectItem value=";">Semicolon (;)</SelectItem>
                    <SelectItem value="\t">Tab</SelectItem>
                    <SelectItem value="|">Pipe (|)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {isProcessing && (
            <div className="space-y-2">
              <Progress value={progress} className="h-2" />
              <p className="text-xs text-muted-foreground text-center">Converting...</p>
            </div>
          )}

          <Button onClick={handleConvert} disabled={isProcessing || !file} className="w-full">
            {isProcessing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Converting...
              </>
            ) : (
              <>
                <ArrowLeftRight className="mr-2 h-4 w-4" />
                Convert {canConvert}
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <AnimatePresence>
        {result && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            <Card className="border-amber-500/20 bg-amber-500/5">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-amber-500" />
                  <CardTitle className="text-base">Conversion Complete</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-lg bg-background p-3">
                  <p className="text-xs text-muted-foreground">Output File</p>
                  <p className="text-sm font-medium truncate">{result.filename}</p>
                </div>
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
                    <Eye className="h-4 w-4" />
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
        title="Converted Data Preview"
      />
    </div>
  )
}
