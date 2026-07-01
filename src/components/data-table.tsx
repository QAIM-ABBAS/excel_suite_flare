"use client"

import { useState, useMemo } from "react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ChevronLeft, ChevronRight, Search, Inbox } from "lucide-react"

interface DataTableProps {
  data: Record<string, unknown>[]
  maxRows?: number
  searchable?: boolean
  emptyMessage?: string
  highlightRow?: (row: Record<string, unknown>, index: number) => boolean
}

export function DataTable({
  data,
  maxRows = 50,
  searchable = true,
  emptyMessage = "No data to display",
  highlightRow,
}: DataTableProps) {
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(0)
  const pageSize = 8

  const columns = useMemo(() => {
    if (data.length === 0) return []
    return Object.keys(data[0])
  }, [data])

  const filteredData = useMemo(() => {
    if (!search) return data
    const lower = search.toLowerCase()
    return data.filter(row =>
      Object.values(row).some(val =>
        String(val ?? "").toLowerCase().includes(lower)
      )
    )
  }, [data, search])

  const totalPages = Math.max(1, Math.ceil(Math.min(filteredData.length, maxRows) / pageSize))
  const currentPage = Math.min(page, totalPages - 1)
  const paginatedData = filteredData.slice(
    currentPage * pageSize,
    Math.min((currentPage + 1) * pageSize, maxRows)
  )

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border/50 py-8 px-4 text-center">
        <Inbox className="h-8 w-8 text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {searchable && (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search in data..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(0)
            }}
            className="h-8 pl-8 text-xs"
          />
        </div>
      )}

      <div className="rounded-lg border border-border/50 overflow-hidden">
        <div className="max-h-72 overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-muted/50 backdrop-blur-sm z-10">
              <TableRow className="border-border/50 hover:bg-transparent">
                <TableHead className="w-10 text-[10px] text-muted-foreground font-medium">#</TableHead>
                {columns.map(col => (
                  <TableHead key={col} className="text-[10px] text-muted-foreground font-medium whitespace-nowrap">
                    {col}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedData.map((row, i) => {
                const actualIndex = currentPage * pageSize + i
                const isHighlighted = highlightRow?.(row, actualIndex)
                return (
                  <TableRow
                    key={i}
                    className={`border-border/30 ${isHighlighted ? "bg-rose-500/5" : "hover:bg-muted/40"}`}
                  >
                    <TableCell className="text-[10px] text-muted-foreground tabular-nums">
                      {actualIndex + 1}
                    </TableCell>
                    {columns.map(col => {
                      const val = row[col]
                      const strVal = String(val ?? "")
                      return (
                        <TableCell
                          key={col}
                          className="text-xs whitespace-nowrap max-w-[180px] truncate"
                          title={strVal}
                        >
                          {val === null || val === undefined || strVal === "" ? (
                            <span className="text-muted-foreground/40 italic">empty</span>
                          ) : strVal}
                        </TableCell>
                      )
                    })}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary" className="text-[10px]">
            {filteredData.length} rows
          </Badge>
          {filteredData.length > maxRows && (
            <span className="text-[10px]">(showing first {maxRows})</span>
          )}
          <span className="text-[10px]">{columns.length} columns</span>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={currentPage === 0}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="text-xs text-muted-foreground tabular-nums px-1">
              {currentPage + 1} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={currentPage >= totalPages - 1}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
