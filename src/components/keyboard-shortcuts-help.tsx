"use client"

import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Keyboard } from "lucide-react"

interface ShortcutItem {
  keys: string[]
  label: string
  group: string
}

const SHORTCUTS: ShortcutItem[] = [
  { keys: ["Ctrl", "K"], label: "Open command palette", group: "Global" },
  { keys: ["?"], label: "Show this shortcuts dialog", group: "Global" },
  { keys: ["Esc"], label: "Close dialog / palette", group: "Global" },
  { keys: ["G", "D"], label: "Go to Dashboard", group: "Navigation" },
  { keys: ["G", "S"], label: "Go to Settings", group: "Navigation" },
  { keys: ["G", "A"], label: "Go to About", group: "Navigation" },
  { keys: ["G", "M"], label: "Go to Merge Files", group: "Navigation" },
  { keys: ["G", "C"], label: "Go to CSV ⇄ Excel", group: "Navigation" },
  { keys: ["G", "F"], label: "Go to Data Filter", group: "Navigation" },
  { keys: ["G", "T"], label: "Go to Statistics", group: "Navigation" },
  { keys: ["G", "P"], label: "Go to Pivot / Group-By", group: "Navigation" },
  { keys: ["G", "V"], label: "Go to Data Validation", group: "Navigation" },
  { keys: ["G", "R"], label: "Go to Transpose / Reshape", group: "Navigation" },
  { keys: ["↑", "↓"], label: "Navigate command palette results", group: "Command Palette" },
  { keys: ["↵"], label: "Select highlighted command", group: "Command Palette" },
]

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function KeyboardShortcutsHelp({ open, onOpenChange }: Props) {
  // Group shortcuts by group
  const groups = SHORTCUTS.reduce<Record<string, ShortcutItem[]>>((acc, s) => {
    if (!acc[s.group]) acc[s.group] = []
    acc[s.group].push(s)
    return acc
  }, {})

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden top-[20%] translate-y-0">
        <DialogTitle className="sr-only">Keyboard Shortcuts</DialogTitle>
        <DialogDescription className="sr-only">
          List of available keyboard shortcuts in the application.
        </DialogDescription>

        <div className="flex items-center gap-2 border-b border-border/50 px-4 py-3">
          <Keyboard className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Keyboard Shortcuts</h2>
        </div>

        <div className="max-h-[60vh] overflow-y-auto scrollbar-thin p-2">
          {Object.entries(groups).map(([group, items]) => (
            <div key={group} className="mb-3 last:mb-0">
              <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group}
              </p>
              <div className="space-y-0.5">
                {items.map((s, idx) => (
                  <div
                    key={`${s.label}-${idx}`}
                    className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-muted/40 transition-colors"
                  >
                    <span className="text-xs">{s.label}</span>
                    <div className="flex items-center gap-1">
                      {s.keys.map((k, i) => (
                        <kbd
                          key={`${k}-${i}`}
                          className="inline-flex h-5 min-w-5 select-none items-center justify-center rounded border bg-muted px-1.5 font-mono text-[10px] font-medium"
                        >
                          {k}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-border/50 px-3 py-2 text-[10px] text-muted-foreground">
          Tip: press <kbd className="inline-flex h-4 select-none items-center rounded border bg-muted px-1 font-mono">?</kbd> anywhere to open this dialog.
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Hook that wires the "?" key (when no input is focused) to open the help dialog.
 * Returns [open, setOpen] for the consumer to render the dialog.
 */
export function useKeyboardShortcutsHelp() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable

      if (e.key === "?" && !isTyping) {
        e.preventDefault()
        setOpen((v) => !v)
      }
      if (e.key === "Escape" && open) {
        setOpen(false)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [open])

  return [open, setOpen] as const
}
