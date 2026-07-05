"use client"

import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Download,
  FileSpreadsheet,
  Loader2,
  Image as ImageIcon,
} from "lucide-react"
import { toast } from "sonner"
import { motion } from "framer-motion"
import type { ImageResult, Row } from "@/lib/image-downloader"
import { buildImagesXlsx, buildImagesHtml, downloadBlob } from "@/lib/image-exports"

type ViewMode = "all" | "success" | "failed"
type ExportKind = "xlsx" | "html"

const PAGE_SIZE = 50

interface ResultsCardProps {
  results: ImageResult[]
  rows: Row[]
  /** Data columns to include in exports (URL column excluded) */
  columns: string[]
  baseName: string
}

export function ResultsCard({ results, rows, columns, baseName }: ResultsCardProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("all")
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [building, setBuilding] = useState<ExportKind | null>(null)

  const successCount = useMemo(() => results.filter((r) => r.status === "success").length, [results])
  const failCount = useMemo(() => results.filter((r) => r.status === "failed").length, [results])

  const filteredResults = useMemo(() => {
    if (viewMode === "success") return results.filter((r) => r.status === "success")
    if (viewMode === "failed") return results.filter((r) => r.status === "failed")
    return results
  }, [results, viewMode])

  const changeViewMode = (mode: ViewMode) => {
    setViewMode(mode)
    setVisibleCount(PAGE_SIZE)
  }

  const handleExport = async (kind: ExportKind) => {
    setBuilding(kind)
    try {
      const input = { baseName, columns, rows, results }
      const blob = kind === "xlsx" ? await buildImagesXlsx(input) : buildImagesHtml(input)
      downloadBlob(blob, `${baseName}_images.${kind === "xlsx" ? "xlsx" : "html"}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to build file"
      toast.error(message)
    } finally {
      setBuilding(null)
    }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
      <Card className="border-pink-500/20 bg-pink-500/5">
        <CardHeader>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-pink-500" />
            <CardTitle className="text-base">Images Processed</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-3">
            <StatBox icon={<ImageIcon className="h-3 w-3 text-muted-foreground" />} label="Total Rows" value={results.length} />
            <StatBox icon={<CheckCircle2 className="h-3 w-3 text-emerald-500" />} label="Success" value={successCount} valueClassName="text-emerald-500" />
            <StatBox icon={<XCircle className="h-3 w-3 text-rose-500" />} label="Failed" value={failCount} valueClassName="text-rose-500" />
          </div>

          {failCount > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
              <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <p className="text-sm text-amber-600 dark:text-amber-400">
                {failCount} image(s) failed to download. The corresponding rows are kept in the export with their original URLs.
              </p>
            </div>
          )}

          {results.length > 0 && (
            <div className="space-y-2">
              <div className="flex gap-1 rounded-lg bg-muted/50 p-1">
                <FilterTab active={viewMode === "all"} onClick={() => changeViewMode("all")}>
                  All ({results.length})
                </FilterTab>
                <FilterTab active={viewMode === "success"} onClick={() => changeViewMode("success")} activeClassName="text-emerald-600 dark:text-emerald-400">
                  Success ({successCount})
                </FilterTab>
                <FilterTab active={viewMode === "failed"} onClick={() => changeViewMode("failed")} activeClassName="text-rose-600 dark:text-rose-400">
                  Failed ({failCount})
                </FilterTab>
              </div>

              <div className="max-h-60 overflow-auto rounded-lg border border-border/50 bg-muted/30">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
                    <tr className="border-b border-border/50">
                      <th className="text-left px-2 py-1.5 text-[10px] text-muted-foreground font-medium">Row</th>
                      <th className="text-left px-2 py-1.5 text-[10px] text-muted-foreground font-medium">URL</th>
                      <th className="text-left px-2 py-1.5 text-[10px] text-muted-foreground font-medium">Status</th>
                      <th className="text-left px-2 py-1.5 text-[10px] text-muted-foreground font-medium">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredResults.slice(0, visibleCount).map((r) => (
                      <tr key={r.row} className={`border-b border-border/30 ${r.status === "failed" ? "bg-rose-500/5" : ""}`}>
                        <td className="px-2 py-1.5 text-muted-foreground tabular-nums">{r.row}</td>
                        <td className="px-2 py-1.5 truncate max-w-[160px]" title={r.url}>{r.url}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          <StatusBadge status={r.status} />
                        </td>
                        <td className="px-2 py-1.5 max-w-[200px]" title={r.error}>
                          {r.error ? <span className="text-rose-500 dark:text-rose-400 break-all">{r.error}</span> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {filteredResults.length > visibleCount && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full h-7 text-xs"
                  onClick={() => setVisibleCount((c) => c + PAGE_SIZE * 2)}
                >
                  Show more ({filteredResults.length - visibleCount} remaining)
                </Button>
              )}
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            <Button onClick={() => handleExport("xlsx")} disabled={building !== null}>
              {building === "xlsx" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="mr-2 h-4 w-4" />
              )}
              Download Excel with Images
            </Button>
            <Button variant="outline" onClick={() => handleExport("html")} disabled={building !== null}>
              {building === "html" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Download HTML Report
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}

function StatBox({
  icon,
  label,
  value,
  valueClassName = "",
}: {
  icon: React.ReactNode
  label: string
  value: number
  valueClassName?: string
}) {
  return (
    <div className="rounded-lg bg-background p-3 text-center">
      <div className="flex items-center justify-center gap-1.5 mb-1">
        {icon}
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
      <p className={`text-lg font-semibold ${valueClassName}`}>{value}</p>
    </div>
  )
}

function FilterTab({
  active,
  onClick,
  activeClassName = "",
  children,
}: {
  active: boolean
  onClick: () => void
  activeClassName?: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-md px-3 py-1 text-xs font-medium transition-all ${
        active ? `bg-background shadow-sm ${activeClassName}` : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  )
}

function StatusBadge({ status }: { status: ImageResult["status"] }) {
  if (status === "success") {
    return (
      <Badge variant="secondary" className="text-[9px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
        Success
      </Badge>
    )
  }
  if (status === "skipped") {
    return (
      <Badge variant="secondary" className="text-[9px] bg-muted text-muted-foreground">
        Skipped
      </Badge>
    )
  }
  return (
    <Badge variant="secondary" className="text-[9px] bg-rose-500/10 text-rose-600 dark:text-rose-400">
      Failed
    </Badge>
  )
}
