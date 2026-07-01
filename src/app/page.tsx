"use client"

import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { CommandPalette } from "@/components/command-palette"
import { NotificationsPopover } from "@/components/notifications-popover"
import { AppFooter } from "@/components/app-footer"
import { KeyboardShortcutsHelp, useKeyboardShortcutsHelp } from "@/components/keyboard-shortcuts-help"
import { useGlobalShortcuts } from "@/lib/use-global-shortcuts"
import { useAppStore } from "@/lib/store"
import { DashboardView } from "@/components/dashboard-view"
import { MergeTool } from "@/components/tools/merge-tool"
import { ConvertTool } from "@/components/tools/convert-tool"
import { DuplicatesTool } from "@/components/tools/duplicates-tool"
import { SortTool } from "@/components/tools/sort-tool"
import { FilterTool } from "@/components/tools/filter-tool"
import { StatsTool } from "@/components/tools/stats-tool"
import { PivotTool } from "@/components/tools/pivot-tool"
import { ReplaceTool } from "@/components/tools/replace-tool"
import { ValidateTool } from "@/components/tools/validate-tool"
import { TransposeTool } from "@/components/tools/transpose-tool"
import { AttendanceTool } from "@/components/tools/attendance-tool"
import { DownloadExcelTool } from "@/components/tools/download-excel-tool"
import { DownloadImagesTool } from "@/components/tools/download-images-tool"
import { SettingsView } from "@/components/settings-view"
import { AboutView } from "@/components/about-view"
import { Separator } from "@/components/ui/separator"
import { GitMerge, ArrowLeftRight, CopyX, UserCheck, Download, ImageDown, LayoutDashboard, Settings, Info, ArrowUpDown, Filter, BarChart3, Table2, Loader2, Replace, ShieldCheck, FlipHorizontal2 } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import type { ToolView } from "@/lib/store"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

const viewMeta: Record<ToolView, { title: string; description: string; icon: typeof LayoutDashboard }> = {
  dashboard: { title: "Dashboard", description: "Overview and quick access to tools", icon: LayoutDashboard },
  merge: { title: "Merge Files", description: "Combine multiple files into one", icon: GitMerge },
  convert: { title: "CSV ⇄ Excel Converter", description: "Convert between formats", icon: ArrowLeftRight },
  duplicates: { title: "Remove Duplicates", description: "Clean duplicate rows", icon: CopyX },
  sort: { title: "Data Sorter", description: "Sort data by column", icon: ArrowUpDown },
  filter: { title: "Data Filter", description: "Filter rows by conditions", icon: Filter },
  stats: { title: "Statistics & Summary", description: "Analyze column statistics", icon: BarChart3 },
  pivot: { title: "Pivot / Group-By", description: "Group rows and aggregate values", icon: Table2 },
  replace: { title: "Find & Replace", description: "Search and replace text across cells", icon: Replace },
  validate: { title: "Data Validation", description: "Scan for quality issues", icon: ShieldCheck },
  transpose: { title: "Transpose / Reshape", description: "Swap rows/columns or unpivot", icon: FlipHorizontal2 },
  attendance: { title: "Attendance Checker", description: "Check student attendance", icon: UserCheck },
  "download-excel": { title: "Download Excel from URL", description: "Fetch files from the web", icon: Download },
  "download-images": { title: "Download Images into Excel", description: "Embed images into spreadsheets", icon: ImageDown },
  settings: { title: "Settings", description: "Preferences and history", icon: Settings },
  about: { title: "About", description: "About Excel Suite", icon: Info },
}

export default function Home() {
  const { currentView, activeTasks } = useAppStore()
  const meta = viewMeta[currentView] || viewMeta.dashboard
  const [shortcutsOpen, setShortcutsOpen] = useKeyboardShortcutsHelp()

  // Wire g+key navigation shortcuts
  useGlobalShortcuts()

  const renderView = () => {
    switch (currentView) {
      case "dashboard": return <DashboardView />
      case "merge": return <MergeTool />
      case "convert": return <ConvertTool />
      case "duplicates": return <DuplicatesTool />
      case "sort": return <SortTool />
      case "filter": return <FilterTool />
      case "stats": return <StatsTool />
      case "pivot": return <PivotTool />
      case "replace": return <ReplaceTool />
      case "validate": return <ValidateTool />
      case "transpose": return <TransposeTool />
      case "attendance": return <AttendanceTool />
      case "download-excel": return <DownloadExcelTool />
      case "download-images": return <DownloadImagesTool />
      case "settings": return <SettingsView />
      case "about": return <AboutView />
      default: return <DashboardView />
    }
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="flex flex-col min-h-svh">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border/50 bg-background/80 backdrop-blur-md px-4 lg:px-6">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-5" />
          <div className="flex items-center gap-2 min-w-0">
            <meta.icon className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="flex items-center gap-2 min-w-0">
              <h1 className="text-sm font-semibold truncate">{meta.title}</h1>
              <Separator orientation="vertical" className="hidden sm:block h-4" />
              <span className="hidden sm:block text-xs text-muted-foreground truncate">{meta.description}</span>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {/* Active task indicator */}
            {activeTasks > 0 && (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1.5 rounded-full border border-border/50 bg-muted/40 px-2.5 py-1 text-xs">
                      <Loader2 className="h-3 w-3 animate-spin text-primary" />
                      <span className="tabular-nums font-medium">{activeTasks}</span>
                      <span className="hidden sm:inline text-muted-foreground">running</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>{activeTasks} background task{activeTasks === 1 ? "" : "s"} in progress</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            <NotificationsPopover />
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentView}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              {renderView()}
            </motion.div>
          </AnimatePresence>
        </main>

        <AppFooter onOpenShortcuts={() => setShortcutsOpen(true)} />
      </SidebarInset>

      <CommandPalette />
      <KeyboardShortcutsHelp open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </SidebarProvider>
  )
}
