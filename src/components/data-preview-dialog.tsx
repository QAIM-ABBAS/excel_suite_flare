"use client"

import { useEffect, useState, useRef } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { DataTable } from "@/components/data-table"
import { Loader2, FileSpreadsheet } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { apiFetch } from "@/lib/api"

interface DataPreviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  filename?: string
  data?: Record<string, unknown>[]
  title?: string
}

interface PreviewData {
  sheetName: string
  totalRows: number
  columns: string[]
  data: Record<string, unknown>[]
}

export function DataPreviewDialog({
  open,
  onOpenChange,
  filename,
  data: initialData,
  title = "Data Preview",
}: DataPreviewDialogProps) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<PreviewData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loadingRef = useRef<string | null>(null)

  // Handle direct data prop
  useEffect(() => {
    if (initialData && initialData.length > 0) {
      const columns = Object.keys(initialData[0])
      setData({
        sheetName: "Preview",
        totalRows: initialData.length,
        columns,
        data: initialData,
      })
    } else if (initialData) {
      setData({
        sheetName: "Preview",
        totalRows: 0,
        columns: [],
        data: [],
      })
    }
  }, [initialData])

  // Handle filename prop - fetch from API
  useEffect(() => {
    if (!open || !filename || initialData) return
    if (loadingRef.current === filename) return
    loadingRef.current = filename

    let cancelled = false
    // Set loading in a microtask to avoid synchronous setState in effect
    Promise.resolve().then(() => {
      if (cancelled) return
      setLoading(true)
      setError(null)
    })

    apiFetch(`/api/tools/preview?file=${encodeURIComponent(filename)}&rows=100`)
      .then(res => res.json())
      .then(result => {
        if (cancelled) return
        if (result.success) {
          setData(result)
        } else {
          setError(result.error || "Failed to load preview")
        }
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load preview")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
      loadingRef.current = null
    }
  }, [open, filename, initialData])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-primary" />
            {title}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-2">
            <span className="truncate">{filename}</span>
            {data && (
              <>
                <Badge variant="secondary" className="text-[10px]">{data.totalRows} rows</Badge>
                <Badge variant="secondary" className="text-[10px]">{data.columns.length} columns</Badge>
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="text-center py-16">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          ) : data ? (
            <DataTable data={data.data} maxRows={100} emptyMessage="File is empty" />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
