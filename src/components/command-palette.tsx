"use client"

import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { useAppStore, type ToolView } from "@/lib/store"
import {
  LayoutDashboard, GitMerge, ArrowLeftRight, CopyX,
  UserCheck, Download, ImageDown, Settings, Info,
  Search, CornerDownLeft, ArrowUpDown, Filter, BarChart3, Table2, Replace, ShieldCheck, FlipHorizontal2
} from "lucide-react"
import { cn } from "@/lib/utils"

interface CommandItem {
  id: ToolView
  label: string
  description: string
  icon: typeof LayoutDashboard
  keywords: string[]
  shortcut?: string
}

const commands: CommandItem[] = [
  { id: "dashboard", label: "Dashboard", description: "Go to dashboard", icon: LayoutDashboard, keywords: ["home", "main"] },
  { id: "merge", label: "Merge Files", description: "Combine multiple Excel/CSV files", icon: GitMerge, keywords: ["combine", "join", "union"] },
  { id: "convert", label: "CSV ⇄ Excel", description: "Convert between CSV and Excel", icon: ArrowLeftRight, keywords: ["transform", "csv", "xlsx"] },
  { id: "duplicates", label: "Remove Duplicates", description: "Delete duplicate rows", icon: CopyX, keywords: ["dedupe", "unique", "clean"] },
  { id: "sort", label: "Data Sorter", description: "Sort data by any column", icon: ArrowUpDown, keywords: ["order", "arrange", "ascending", "descending"] },
  { id: "filter", label: "Data Filter", description: "Filter rows by conditions", icon: Filter, keywords: ["where", "query", "match", "condition", "and", "or"] },
  { id: "replace", label: "Find & Replace", description: "Search and replace text in cells", icon: Replace, keywords: ["substitute", "swap", "search", "regex", "find"] },
  { id: "validate", label: "Data Validation", description: "Scan for quality issues", icon: ShieldCheck, keywords: ["quality", "check", "empty", "duplicate", "outlier", "format"] },
  { id: "transpose", label: "Transpose / Reshape", description: "Swap rows/columns or unpivot", icon: FlipHorizontal2, keywords: ["flip", "rotate", "unpivot", "melt", "reshape", "wide", "long"] },
  { id: "stats", label: "Statistics & Summary", description: "Compute column statistics", icon: BarChart3, keywords: ["summary", "sum", "average", "min", "max", "describe", "analyze"] },
  { id: "pivot", label: "Pivot / Group-By", description: "Group rows and aggregate values", icon: Table2, keywords: ["group", "aggregate", "summarize", "pivot", "crosstab"] },
  { id: "attendance", label: "Attendance Checker", description: "Check student attendance", icon: UserCheck, keywords: ["student", "class", "present"] },
  { id: "download-excel", label: "Download Excel from URL", description: "Download files from the web", icon: Download, keywords: ["url", "fetch", "remote"] },
  { id: "download-images", label: "Download Images", description: "Embed images into Excel", icon: ImageDown, keywords: ["pictures", "photos", "embed"] },
  { id: "settings", label: "Settings", description: "View settings and file history", icon: Settings, keywords: ["preferences", "config"] },
  { id: "about", label: "About", description: "About Excel Suite", icon: Info, keywords: ["help", "info"] },
]

export function CommandPalette() {
  const { setCurrentView, currentView } = useAppStore()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Keyboard shortcut: Ctrl+K / Cmd+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setOpen(prev => !prev)
      }
      if (e.key === "Escape" && open) {
        setOpen(false)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [open])

  // Reset search and selection when opening - use callback wrapper
  const handleOpenChange = (next: boolean) => {
    if (next) {
      setSearch("")
      setSelectedIndex(0)
    }
    setOpen(next)
  }

  const filtered = commands.filter(cmd => {
    const q = search.toLowerCase()
    return (
      cmd.label.toLowerCase().includes(q) ||
      cmd.description.toLowerCase().includes(q) ||
      cmd.keywords.some(k => k.includes(q))
    )
  })

  const handleSelect = (id: ToolView) => {
    setCurrentView(id)
    setOpen(false)
  }

  // Keyboard navigation within results
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSelectedIndex(i => Math.min(i + 1, filtered.length - 1))
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setSelectedIndex(i => Math.max(i - 1, 0))
      } else if (e.key === "Enter") {
        e.preventDefault()
        if (filtered[selectedIndex]) {
          handleSelect(filtered[selectedIndex].id)
        }
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [open, filtered, selectedIndex])

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-xl p-0 gap-0 overflow-hidden top-[20%] translate-y-0">
          <DialogTitle className="sr-only">Command Palette</DialogTitle>
          <div className="flex items-center border-b border-border/50 px-3">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <input
              autoFocus
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setSelectedIndex(0)
              }}
              placeholder="Type a command or search..."
              className="flex h-11 w-full bg-transparent py-3 px-2 text-sm outline-none placeholder:text-muted-foreground"
            />
            <kbd className="hidden sm:inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">
              ESC
            </kbd>
          </div>

          <div className="max-h-80 overflow-auto p-1">
            {filtered.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-sm text-muted-foreground">No results found</p>
              </div>
            ) : (
              filtered.map((cmd, index) => {
                const isActive = index === selectedIndex
                const isCurrent = cmd.id === currentView
                return (
                  <button
                    key={cmd.id}
                    onClick={() => handleSelect(cmd.id)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors",
                      isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                    )}
                  >
                    <div className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-md shrink-0",
                      isActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                    )}>
                      <cmd.icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{cmd.label}</span>
                        {isCurrent && (
                          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">Current</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{cmd.description}</p>
                    </div>
                    {isActive && (
                      <CornerDownLeft className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    )}
                  </button>
                )
              })
            )}
          </div>

          <div className="border-t border-border/50 px-3 py-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
            <div className="flex items-center gap-2">
              <kbd className="inline-flex h-4 select-none items-center rounded border bg-muted px-1 font-mono text-[9px]">↑↓</kbd>
              <span>Navigate</span>
              <kbd className="inline-flex h-4 select-none items-center rounded border bg-muted px-1 font-mono text-[9px]">↵</kbd>
              <span>Select</span>
            </div>
            <span>Excel Suite Command Palette</span>
          </div>
        </DialogContent>
      </Dialog>

      {/* Floating trigger button - bottom right */}
      <button
        onClick={() => handleOpenChange(true)}
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-border/50 bg-background/80 backdrop-blur-md px-3 py-1.5 text-xs shadow-lg hover:shadow-xl hover:bg-background transition-all"
        title="Open command palette (Ctrl+K)"
      >
        <Search className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="hidden sm:inline text-muted-foreground">Quick Search</span>
        <kbd className="hidden sm:inline-flex h-4 select-none items-center gap-0.5 rounded border bg-muted px-1 font-mono text-[9px] text-muted-foreground">
          ⌘K
        </kbd>
      </button>
    </>
  )
}
