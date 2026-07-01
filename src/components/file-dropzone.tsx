"use client"

import { useCallback, useId, useState } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Upload, FileSpreadsheet, X, FolderOpen } from "lucide-react"
import { motion } from "framer-motion"

interface FileDropzoneProps {
  accept?: string
  multiple?: boolean
  onFilesSelected: (files: File[]) => void
  maxSize?: number // in MB
  label?: string
  description?: string
}

export function FileDropzone({
  accept = ".xlsx,.xls,.csv",
  multiple = false,
  onFilesSelected,
  maxSize = 50,
  label = "Drop files here or click to browse",
  description = "Supports Excel and CSV files up to 50MB",
}: FileDropzoneProps) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Unique input id to avoid clashing when multiple dropzones are mounted at once
  const inputId = useId()

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const validateAndProcess = useCallback((fileList: FileList | File[]) => {
    const files = Array.from(fileList)
    const maxBytes = maxSize * 1024 * 1024

    for (const file of files) {
      if (file.size > maxBytes) {
        setError(`File "${file.name}" exceeds ${maxSize}MB limit`)
        return
      }
      const ext = file.name.substring(file.name.lastIndexOf(".")).toLowerCase()
      const allowed = accept.split(",").map(a => a.trim())
      if (!allowed.includes(ext)) {
        setError(`File type "${ext}" is not supported`)
        return
      }
    }

    setError(null)
    onFilesSelected(files)
  }, [accept, maxSize, onFilesSelected])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    validateAndProcess(e.dataTransfer.files)
  }, [validateAndProcess])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      validateAndProcess(e.target.files)
    }
  }, [validateAndProcess])

  return (
    <div className="space-y-2">
      <motion.div
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
      >
        <Card
          className={`relative cursor-pointer border-2 border-dashed transition-all duration-200 ${
            isDragOver
              ? "border-primary bg-primary/5 scale-[1.02]"
              : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30"
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => document.getElementById(inputId)?.click()}
        >
          <div className="flex flex-col items-center justify-center py-10 px-6 text-center">
            <motion.div
              animate={{ y: isDragOver ? -5 : 0, scale: isDragOver ? 1.1 : 1 }}
              transition={{ type: "spring", stiffness: 300 }}
              className={`flex h-14 w-14 items-center justify-center rounded-2xl ${
                isDragOver ? "bg-primary/15 text-primary" : "bg-muted/60 text-muted-foreground"
              } mb-3 transition-colors`}
            >
              {isDragOver ? (
                <FileSpreadsheet className="h-7 w-7" />
              ) : (
                <Upload className="h-7 w-7" />
              )}
            </motion.div>
            <p className="text-sm font-medium">{label}</p>
            <p className="text-xs text-muted-foreground mt-1">{description}</p>
            <div className="mt-4 flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs pointer-events-none"
                onClick={(e) => {
                  e.stopPropagation()
                  document.getElementById(inputId)?.click()
                }}
              >
                <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                Browse Files
              </Button>
              <span className="text-[10px] text-muted-foreground">or drag &amp; drop</span>
            </div>
          </div>
          <input
            id={inputId}
            type="file"
            accept={accept}
            multiple={multiple}
            className="hidden"
            onChange={handleChange}
          />
        </Card>
      </motion.div>
      {error && (
        <motion.p
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-xs text-destructive flex items-center gap-1"
        >
          <X className="h-3 w-3" />
          {error}
        </motion.p>
      )}
    </div>
  )
}
