"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { DataPreviewDialog } from "@/components/data-preview-dialog"
import { Download, Loader2, CheckCircle2, ExternalLink, Eye, Shield, FileSpreadsheet, Clock } from "lucide-react"
import { toast } from "sonner"
import { motion, AnimatePresence } from "framer-motion"
import { useAppStore } from "@/lib/store"
import { apiFetch } from "@/lib/api"

interface DownloadResult {
  fileContent: string
  filename: string
  size: number
}

export function DownloadExcelTool() {
  const { incrementActiveTasks, decrementActiveTasks, pushNotification } = useAppStore()
  const [url, setUrl] = useState("")
  const [filename, setFilename] = useState("")
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<DownloadResult | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)

  const handleDownload = async () => {
    if (!url) {
      toast.error("Please enter a URL")
      return
    }

    // Basic URL validation
    try {
      const parsed = new URL(url)
      if (!["http:", "https:"].includes(parsed.protocol)) {
        toast.error("Only HTTP/HTTPS URLs are supported")
        return
      }
    } catch {
      toast.error("Please enter a valid URL")
      return
    }

    setIsProcessing(true)
    setProgress(10)
    setResult(null)
    incrementActiveTasks()

    try {
      // Simulate progress while downloading
      const progressInterval = setInterval(() => {
        setProgress(prev => Math.min(prev + 5, 80))
      }, 500)

      const response = await apiFetch("/api/tools/download-excel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, filename: filename || undefined }),
      })

      clearInterval(progressInterval)
      setProgress(90)

      const data = await response.json()

      if (!response.ok) throw new Error(data.error || "Download failed")

      setProgress(100)
      setResult(data)
      toast.success("File downloaded successfully!")
      pushNotification({
        title: "Download complete",
        description: `${data.filename} (${(data.size / 1024).toFixed(1)} KB)`,
        type: "success",
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Download failed"
      toast.error(msg)
      pushNotification({ title: "Download failed", description: msg, type: "error" })
    } finally {
      setIsProcessing(false)
      decrementActiveTasks()
      setTimeout(() => setProgress(0), 1000)
    }
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }

  const canPreview = result?.filename.endsWith(".xlsx") || result?.filename.endsWith(".csv")

  return (
    <div className="space-y-6 max-w-3xl">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10 text-violet-500">
              <Download className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-base">Download Excel from URL</CardTitle>
              <CardDescription>Download spreadsheet files from the web</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="url">File URL</Label>
            <div className="relative">
              <ExternalLink className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                id="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/data.xlsx"
                className="h-9 pl-9"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && url) handleDownload()
                }}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="filename">Custom Filename (optional)</Label>
            <Input
              id="filename"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              placeholder="my-data"
              className="h-9"
            />
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
            <Shield className="h-4 w-4 text-violet-500 mt-0.5 shrink-0" />
            <div className="text-xs text-violet-600 dark:text-violet-400 space-y-1">
              <p><strong>Security:</strong> URLs are validated (HTTP/HTTPS only) with a 30-second timeout.</p>
              <p>Maximum download size: 50MB</p>
            </div>
          </div>

          {isProcessing && (
            <div className="space-y-2">
              <Progress value={progress} className="h-2" />
              <p className="text-xs text-muted-foreground text-center">Downloading file...</p>
            </div>
          )}

          <Button onClick={handleDownload} disabled={isProcessing || !url} className="w-full">
            {isProcessing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Downloading...
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" />
                Download File
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <AnimatePresence>
        {result && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            <Card className="border-violet-500/20 bg-violet-500/5">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-violet-500" />
                  <CardTitle className="text-base">Download Complete</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3 rounded-lg bg-background p-3">
                  <FileSpreadsheet className="h-8 w-8 text-violet-500 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{result.filename}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant="secondary" className="text-[10px]">{formatSize(result.size)}</Badge>
                      <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                        <Clock className="h-2.5 w-2.5" />
                        Just now
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button asChild className="flex-1">
                    <a href={result.fileContent} download={result.filename}>
                      <Download className="mr-2 h-4 w-4" />
                      Save to Device
                    </a>
                  </Button>
                  {canPreview && (
                    <Button variant="outline" onClick={() => setPreviewOpen(true)} className="flex-1">
                      <Eye className="mr-2 h-4 w-4" />
                      Preview Data
                    </Button>
                  )}
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
        title="Downloaded Data Preview"
      />
    </div>
  )
}
