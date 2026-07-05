"use client"

/**
 * State machine for the Download Images tool.
 *
 * Owns the whole batch lifecycle (start → progress → done/cancelled),
 * the global active-task counter, toasts, and in-app notifications, so the
 * component tree stays purely presentational. Cancellation is instant via
 * AbortController and unmounting mid-run cannot leak the task counter.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { useAppStore } from "@/lib/store"
import { downloadImages, type ImageResult } from "@/lib/image-downloader"

export type JobPhase = "idle" | "running" | "done"

export interface JobProgress {
  done: number
  total: number
  success: number
  fail: number
}

const INITIAL_PROGRESS: JobProgress = { done: 0, total: 0, success: 0, fail: 0 }

export interface StartOptions {
  /** Longest image side in px; 0 keeps original size */
  maxDimension: number
}

export function useImageDownloadJob() {
  const { incrementActiveTasks, decrementActiveTasks, pushNotification } = useAppStore()

  const [phase, setPhase] = useState<JobPhase>("idle")
  const [progress, setProgress] = useState<JobProgress>(INITIAL_PROGRESS)
  const [results, setResults] = useState<ImageResult[]>([])

  const abortRef = useRef<AbortController | null>(null)
  const taskActiveRef = useRef(false)

  const beginTask = useCallback(() => {
    if (!taskActiveRef.current) {
      taskActiveRef.current = true
      incrementActiveTasks()
    }
  }, [incrementActiveTasks])

  const endTask = useCallback(() => {
    if (taskActiveRef.current) {
      taskActiveRef.current = false
      decrementActiveTasks()
    }
  }, [decrementActiveTasks])

  // Unmount safety: stop in-flight downloads and release the task counter
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      endTask()
    }
  }, [endTask])

  const start = useCallback(
    async (urls: string[], options: StartOptions) => {
      if (abortRef.current) return // already running

      const controller = new AbortController()
      abortRef.current = controller
      const counters = { success: 0, fail: 0 }

      setPhase("running")
      setResults([])
      setProgress({ done: 0, total: urls.length, success: 0, fail: 0 })
      beginTask()

      try {
        const outcome = await downloadImages(urls, {
          maxDimension: options.maxDimension,
          signal: controller.signal,
          onProgress: (done, latest) => {
            if (latest.status === "success") counters.success++
            else if (latest.status === "failed") counters.fail++
            setProgress({ done, total: urls.length, success: counters.success, fail: counters.fail })
          },
        })

        setResults(outcome.results)
        setPhase(outcome.results.length > 0 ? "done" : "idle")

        if (outcome.aborted) {
          toast.info(`Cancelled — ${outcome.results.length} of ${urls.length} images processed`)
        } else {
          toast.success(`Processed ${counters.success} images successfully`)
          if (counters.fail > 0) toast.warning(`${counters.fail} images failed to download`)
          pushNotification({
            title: "Image batch complete",
            description: `${counters.success} succeeded, ${counters.fail} failed of ${urls.length} total`,
            type: counters.fail > 0 ? "warning" : "success",
          })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Image processing failed"
        toast.error(message)
        pushNotification({ title: "Image batch failed", description: message, type: "error" })
        setPhase("idle")
        setProgress(INITIAL_PROGRESS)
      } finally {
        abortRef.current = null
        endTask()
      }
    },
    [beginTask, endTask, pushNotification],
  )

  const cancel = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setPhase("idle")
    setProgress(INITIAL_PROGRESS)
    setResults([])
  }, [])

  return { phase, progress, results, start, cancel, reset }
}
