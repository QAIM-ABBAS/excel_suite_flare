"use client"

import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { motion } from "framer-motion"

interface ColumnOptionsProps {
  columns: string[]
  urlColumn: string
  onUrlColumnChange: (column: string) => void
  includeColumns: string[]
  onToggleColumn: (column: string) => void
  compress: boolean
  onCompressChange: (compress: boolean) => void
  disabled?: boolean
}

export function ColumnOptions({
  columns,
  urlColumn,
  onUrlColumnChange,
  includeColumns,
  onToggleColumn,
  compress,
  onCompressChange,
  disabled = false,
}: ColumnOptionsProps) {
  return (
    <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <div className="space-y-2">
        <Label>Select Image URL Column</Label>
        <Select value={urlColumn} onValueChange={onUrlColumnChange} disabled={disabled}>
          <SelectTrigger>
            <SelectValue placeholder="Select column containing image URLs" />
          </SelectTrigger>
          <SelectContent>
            {columns.map((col) => (
              <SelectItem key={col} value={col}>{col}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">
            Columns to Include in Export
          </Label>
          <Badge variant="secondary" className="text-[10px]">
            {includeColumns.length === 0 ? "All columns" : `${includeColumns.length} selected`}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {columns.filter((col) => col !== urlColumn).map((col) => {
            const active = includeColumns.includes(col)
            return (
              <button
                key={col}
                type="button"
                disabled={disabled}
                onClick={() => onToggleColumn(col)}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-all disabled:opacity-50 ${
                  active
                    ? "border-pink-500/40 bg-pink-500/10 text-pink-600 dark:text-pink-400"
                    : "border-border/50 bg-muted/30 hover:bg-muted/60"
                }`}
              >
                {col}
              </button>
            )
          })}
        </div>
        {includeColumns.length === 0 && (
          <p className="text-[10px] text-muted-foreground">
            No columns selected — all columns (except URL) will be included in the export.
          </p>
        )}
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border/50 p-3">
        <div className="space-y-0.5">
          <Label htmlFor="compress-images" className="text-sm">Compress images</Label>
          <p className="text-[10px] text-muted-foreground">
            Resize to max 400px — recommended for large files (1000+ rows)
          </p>
        </div>
        <Switch
          id="compress-images"
          checked={compress}
          onCheckedChange={onCompressChange}
          disabled={disabled}
        />
      </div>

      <div className="rounded-lg border border-pink-500/20 bg-pink-500/5 p-3">
        <p className="text-xs text-pink-600 dark:text-pink-400">
          <strong>How it works:</strong> Images are downloaded directly in your browser and embedded
          into an <strong>Excel file</strong> (real images in cells) or an <strong>HTML report</strong>.
          Supported formats: JPG, PNG, GIF, BMP, WebP.
        </p>
      </div>
    </motion.div>
  )
}
