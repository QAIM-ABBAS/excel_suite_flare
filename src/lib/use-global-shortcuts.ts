"use client"

import { useEffect } from "react"
import { useAppStore, type ToolView } from "@/lib/store"

/**
 * Global keyboard shortcuts hook.
 * Implements:
 *   g d  → Dashboard
 *   g s  → Settings
 *   g a  → About
 *   g m  → Merge
 *   g c  → Convert (CSV ⇄ Excel)
 *   g f  → Data Filter
 *   g t  → staTs (Statistics)
 *   g p  → Pivot
 *   g v  → Validate
 *   g r  → Transpose
 *
 * The pattern is "two-key sequence": press `g`, then within 1 second press the
 * second key. Only triggers when no input/textarea is focused.
 */
export function useGlobalShortcuts() {
  const setCurrentView = useAppStore((s) => s.setCurrentView)

  useEffect(() => {
    let gPressed = false
    let gTimer: ReturnType<typeof setTimeout> | null = null

    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable

      // Ignore if user is typing or if any modifier (ctrl/alt/meta) is held,
      // except shift is fine for letters.
      if (isTyping || e.ctrlKey || e.altKey || e.metaKey) {
        gPressed = false
        if (gTimer) clearTimeout(gTimer)
        return
      }

      const key = e.key.toLowerCase()

      if (key === "g" && !gPressed) {
        gPressed = true
        if (gTimer) clearTimeout(gTimer)
        gTimer = setTimeout(() => {
          gPressed = false
        }, 1000)
        return
      }

      if (gPressed) {
        const map: Record<string, ToolView> = {
          d: "dashboard",
          s: "settings",
          a: "about",
          m: "merge",
          c: "convert",
          f: "filter",
          t: "stats",
          p: "pivot",
          v: "validate",
          r: "transpose",
        }
        const target = map[key]
        if (target) {
          e.preventDefault()
          setCurrentView(target)
        }
        gPressed = false
        if (gTimer) clearTimeout(gTimer)
      }
    }

    window.addEventListener("keydown", handler)
    return () => {
      window.removeEventListener("keydown", handler)
      if (gTimer) clearTimeout(gTimer)
    }
  }, [setCurrentView])
}
