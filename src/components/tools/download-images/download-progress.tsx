"use client"

import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Square } from "lucide-react"
import type { JobProgress } from "@/hooks/use-image-download-job"

interface DownloadProgressProps {
  progress: JobProgress
  onCancel: () => void
}

export function DownloadProgress({ progress, onCancel }: DownloadProgressProps) {
  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div className="space-y-2">
      <Progress value={percent} className="h-2" />
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {progress.done}/{progress.total} images ({progress.success} ok, {progress.fail} failed)
        </p>
        <Button variant="outline" size="sm" onClick={onCancel} className="h-7 text-xs">
          <Square className="h-3 w-3 mr-1" />
          Cancel
        </Button>
      </div>
    </div>
  )
}
