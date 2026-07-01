"use client"

import { useAppStore, type ToolView } from "@/lib/store"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { GitMerge, ArrowLeftRight, CopyX, UserCheck, Download, ImageDown, FileSpreadsheet, Clock, ArrowRight, Zap, Shield, Sparkles, ArrowUpDown, TrendingUp, Activity, Filter, BarChart3, Table2, Clock3, Replace, ShieldCheck, FlipHorizontal2, X, type LucideIcon } from "lucide-react"
import { motion } from "framer-motion"
import { useEffect, useState } from "react"

interface ToolMeta {
  id: ToolView
  title: string
  description: string
  icon: LucideIcon
  color: string
  bg: string
  gradient: string
  tag?: string
}

const tools: ToolMeta[] = [
  {
    id: "merge",
    title: "Merge Files",
    description: "Combine multiple Excel or CSV files into one",
    icon: GitMerge,
    color: "text-emerald-500",
    bg: "bg-emerald-500/10",
    gradient: "from-emerald-500/20",
    tag: "Popular",
  },
  {
    id: "convert",
    title: "CSV ⇄ Excel",
    description: "Convert between CSV and Excel formats",
    icon: ArrowLeftRight,
    color: "text-amber-500",
    bg: "bg-amber-500/10",
    gradient: "from-amber-500/20",
  },
  {
    id: "duplicates",
    title: "Remove Duplicates",
    description: "Find and remove duplicate rows from your data",
    icon: CopyX,
    color: "text-rose-500",
    bg: "bg-rose-500/10",
    gradient: "from-rose-500/20",
  },
  {
    id: "sort",
    title: "Data Sorter",
    description: "Sort your data by any column ascending or descending",
    icon: ArrowUpDown,
    color: "text-cyan-500",
    bg: "bg-cyan-500/10",
    gradient: "from-cyan-500/20",
    tag: "New",
  },
  {
    id: "filter",
    title: "Data Filter",
    description: "Filter rows by one or more conditions (AND / OR)",
    icon: Filter,
    color: "text-orange-500",
    bg: "bg-orange-500/10",
    gradient: "from-orange-500/20",
    tag: "New",
  },
  {
    id: "replace",
    title: "Find & Replace",
    description: "Search and replace text with scope control and preview",
    icon: Replace,
    color: "text-fuchsia-500",
    bg: "bg-fuchsia-500/10",
    gradient: "from-fuchsia-500/20",
    tag: "New",
  },
  {
    id: "validate",
    title: "Data Validation",
    description: "Scan for empty cells, type mismatches, duplicate keys, and outliers",
    icon: ShieldCheck,
    color: "text-lime-500",
    bg: "bg-lime-500/10",
    gradient: "from-lime-500/20",
    tag: "New",
  },
  {
    id: "transpose",
    title: "Transpose / Reshape",
    description: "Swap rows and columns, or unpivot wide data to long format",
    icon: FlipHorizontal2,
    color: "text-purple-500",
    bg: "bg-purple-500/10",
    gradient: "from-purple-500/20",
    tag: "New",
  },
  {
    id: "stats",
    title: "Statistics",
    description: "Compute descriptive statistics for every column",
    icon: BarChart3,
    color: "text-indigo-500",
    bg: "bg-indigo-500/10",
    gradient: "from-indigo-500/20",
    tag: "New",
  },
  {
    id: "pivot",
    title: "Pivot / Group-By",
    description: "Group rows and aggregate values into a summary table",
    icon: Table2,
    color: "text-teal-500",
    bg: "bg-teal-500/10",
    gradient: "from-teal-500/20",
    tag: "New",
  },
  {
    id: "attendance",
    title: "Attendance Checker",
    description: "Calculate attendance statistics from spreadsheets",
    icon: UserCheck,
    color: "text-sky-500",
    bg: "bg-sky-500/10",
    gradient: "from-sky-500/20",
  },
  {
    id: "download-excel",
    title: "Download Excel",
    description: "Download Excel files from a URL",
    icon: Download,
    color: "text-violet-500",
    bg: "bg-violet-500/10",
    gradient: "from-violet-500/20",
  },
  {
    id: "download-images",
    title: "Download Images",
    description: "Embed images into Excel from URLs",
    icon: ImageDown,
    color: "text-pink-500",
    bg: "bg-pink-500/10",
    gradient: "from-pink-500/20",
  },
]

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06 },
  },
}

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 },
}

interface FileRecord {
  id: string
  filename: string
  originalName: string
  tool: string
  status: string
  createdAt: string
}

const toolLabelMap: Record<string, string> = {
  merge: "Merge",
  convert: "Convert",
  duplicates: "Duplicates",
  sort: "Sort",
  filter: "Filter",
  replace: "Replace",
  validate: "Validate",
  transpose: "Transpose",
  stats: "Stats",
  pivot: "Pivot",
  attendance: "Attendance",
  "download-excel": "Download",
  "download-images": "Images",
}

const toolColorMap: Record<string, string> = {
  merge: "bg-emerald-500/10 text-emerald-500",
  convert: "bg-amber-500/10 text-amber-500",
  duplicates: "bg-rose-500/10 text-rose-500",
  sort: "bg-cyan-500/10 text-cyan-500",
  filter: "bg-orange-500/10 text-orange-500",
  replace: "bg-fuchsia-500/10 text-fuchsia-500",
  validate: "bg-lime-500/10 text-lime-500",
  transpose: "bg-purple-500/10 text-purple-500",
  stats: "bg-indigo-500/10 text-indigo-500",
  pivot: "bg-teal-500/10 text-teal-500",
  attendance: "bg-sky-500/10 text-sky-500",
  "download-excel": "bg-violet-500/10 text-violet-500",
  "download-images": "bg-pink-500/10 text-pink-500",
}

// Quick lookup of icon by tool id for recently used chips
const toolIconMap: Record<string, LucideIcon> = {
  merge: GitMerge,
  convert: ArrowLeftRight,
  duplicates: CopyX,
  sort: ArrowUpDown,
  filter: Filter,
  replace: Replace,
  validate: ShieldCheck,
  transpose: FlipHorizontal2,
  stats: BarChart3,
  pivot: Table2,
  attendance: UserCheck,
  "download-excel": Download,
  "download-images": ImageDown,
}

export function DashboardView() {
  const { setCurrentView, recentTools, clearRecentTools } = useAppStore()
  const [recentFiles, setRecentFiles] = useState<FileRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [totalFiles, setTotalFiles] = useState(0)
  const [toolStats, setToolStats] = useState<Record<string, number>>({})

  useEffect(() => {
    fetch("/api/tools/history")
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setRecentFiles(data.records.slice(0, 5))
          setTotalFiles(data.records.length)
          const stats: Record<string, number> = {}
          for (const r of data.records) {
            stats[r.tool] = (stats[r.tool] || 0) + 1
          }
          setToolStats(stats)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return "Just now"
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    return d.toLocaleDateString()
  }

  const recentToolMeta = recentTools
    .map((id) => tools.find((t) => t.id === id))
    .filter((t): t is ToolMeta => Boolean(t))
    .slice(0, 5)

  return (
    <div className="space-y-6">
      {/* Hero Section with animated background blobs */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-br from-primary/5 via-primary/10 to-transparent p-6 lg:p-8"
      >
        {/* Animated background blobs */}
        <motion.div
          animate={{ x: [0, 30, 0], y: [0, -20, 0], scale: [1, 1.1, 1] }}
          transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-0 right-0 -mt-8 -mr-8 h-40 w-40 rounded-full bg-primary/10 blur-3xl"
        />
        <motion.div
          animate={{ x: [0, -20, 0], y: [0, 25, 0], scale: [1, 1.15, 1] }}
          transition={{ duration: 15, repeat: Infinity, ease: "easeInOut", delay: 2 }}
          className="absolute bottom-0 left-1/3 -mb-12 h-32 w-32 rounded-full bg-emerald-500/10 blur-3xl dark:bg-emerald-500/5"
        />

        <div className="relative flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-xs font-medium text-primary uppercase tracking-wider">Excel Automation Suite</span>
            </div>
            <h2 className="text-2xl lg:text-3xl font-bold tracking-tight">Welcome back</h2>
            <p className="text-muted-foreground text-sm max-w-md">
              Process, convert, and analyze your spreadsheet files with {tools.length} powerful automation tools. Fast, secure, and easy to use.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" className="gap-1">
              <Zap className="h-3 w-3 text-amber-500" />
              {totalFiles} files processed
            </Badge>
            <Badge variant="secondary" className="gap-1">
              <Shield className="h-3 w-3 text-emerald-500" />
              Secure
            </Badge>
          </div>
        </div>

        {/* Recently used tools chips */}
        {recentToolMeta.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="relative mt-5 flex items-center gap-2 flex-wrap"
          >
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Clock3 className="h-3 w-3" />
              Recently used:
            </span>
            {recentToolMeta.map((tool, i) => (
              <motion.button
                key={tool.id}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.4 + i * 0.05 }}
                whileHover={{ scale: 1.05, y: -1 }}
                onClick={() => setCurrentView(tool.id)}
                className={`group inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-background/60 backdrop-blur px-2.5 py-1 text-xs transition-colors hover:border-primary/40`}
              >
                <tool.icon className={`h-3 w-3 ${tool.color}`} />
                <span className="font-medium">{tool.title}</span>
              </motion.button>
            ))}
            <button
              onClick={clearRecentTools}
              className="inline-flex items-center justify-center rounded-full border border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/60 p-1 transition-colors"
              title="Clear recently used list"
              aria-label="Clear recently used tools"
            >
              <X className="h-3 w-3" />
            </button>
          </motion.div>
        )}
      </motion.div>

      {/* Tools Grid */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold">Tools</h3>
            <Badge variant="secondary" className="text-[10px]">{tools.length} available</Badge>
          </div>
        </div>

        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {tools.map((tool) => (
            <motion.div key={tool.id} variants={item} whileHover={{ y: -4 }} transition={{ type: "spring", stiffness: 300 }}>
              <Card
                className="relative cursor-pointer overflow-hidden transition-all duration-300 hover:shadow-xl hover:border-primary/30 group h-full"
                onClick={() => setCurrentView(tool.id)}
                role="button"
                tabIndex={0}
                aria-label={`Open ${tool.title} tool: ${tool.description}`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    setCurrentView(tool.id)
                  }
                }}
              >
                {/* Gradient overlay on hover */}
                <div className={`absolute inset-0 bg-gradient-to-br ${tool.gradient} to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />
                {/* Top accent bar */}
                <div className={`absolute top-0 left-0 right-0 h-0.5 ${tool.bg.replace('/10', '/60')} opacity-0 group-hover:opacity-100 transition-opacity`} />

                <CardHeader className="relative pb-3">
                  <div className="flex items-center justify-between">
                    <motion.div
                      whileHover={{ rotate: 6, scale: 1.1 }}
                      transition={{ type: "spring", stiffness: 400 }}
                      className={`inline-flex h-11 w-11 items-center justify-center rounded-xl ${tool.bg} ${tool.color}`}
                    >
                      <tool.icon className="h-5 w-5" />
                    </motion.div>
                    {tool.tag && (
                      <Badge variant="secondary" className="text-[10px] gap-1">
                        <Sparkles className="h-2.5 w-2.5" />
                        {tool.tag}
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="relative">
                  <CardTitle className="text-base flex items-center gap-1">
                    {tool.title}
                    <ArrowRight className="h-3.5 w-3.5 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all text-muted-foreground" />
                  </CardTitle>
                  <CardDescription className="mt-1">{tool.description}</CardDescription>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      </div>

      {/* Recent Files + Quick Stats */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Recent Files - takes 2 columns */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-lg font-semibold">Recent Files</h3>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setCurrentView("settings")} className="text-xs h-7">
              View All <ArrowRight className="ml-1 h-3 w-3" />
            </Button>
          </div>

          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-16 rounded-lg border border-border/50 bg-muted/30 animate-pulse" />
              ))}
            </div>
          ) : recentFiles.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-10 text-center">
                <FileSpreadsheet className="h-10 w-10 text-muted-foreground/50 mb-3" />
                <p className="text-sm font-medium text-muted-foreground">No recent files</p>
                <p className="text-xs text-muted-foreground/70 mt-1">Start using a tool to see your history here</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {recentFiles.map((file, i) => (
                <motion.div
                  key={file.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="flex items-center gap-3 rounded-lg border border-border/50 bg-card hover:bg-muted/30 hover:border-border transition-all p-3 group"
                >
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${toolColorMap[file.tool] || "bg-muted text-muted-foreground"}`}>
                    <FileSpreadsheet className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{file.originalName}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant="secondary" className="text-[10px] h-4">
                        {toolLabelMap[file.tool] || file.tool}
                      </Badge>
                      <Badge variant={file.status === "completed" ? "secondary" : "destructive"} className="text-[10px] h-4">
                        {file.status}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">{formatDate(file.createdAt)}</span>
                    </div>
                  </div>
                  {file.status === "completed" && (
                    <a
                      href={`/api/tools/download?file=${encodeURIComponent(file.filename)}`}
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Button variant="ghost" size="icon" className="h-7 w-7">
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                    </a>
                  )}
                </motion.div>
              ))}
            </div>
          )}
        </div>

        {/* Quick Stats - 1 column */}
        <div className="space-y-3">
          <h3 className="text-lg font-semibold">Quick Stats</h3>
          <div className="space-y-3">
            <Card className="relative overflow-hidden bg-gradient-to-br from-emerald-500/10 to-emerald-500/0 border-emerald-500/20">
              <div className="absolute -top-4 -right-4 h-16 w-16 rounded-full bg-emerald-500/10 blur-2xl" />
              <CardContent className="relative pt-4 pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">Files Processed</p>
                    <motion.p
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="text-3xl font-bold mt-1 tabular-nums"
                    >
                      {totalFiles}
                    </motion.p>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
                    <FileSpreadsheet className="h-5 w-5 text-emerald-500" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="relative overflow-hidden bg-gradient-to-br from-sky-500/10 to-sky-500/0 border-sky-500/20">
              <div className="absolute -top-4 -right-4 h-16 w-16 rounded-full bg-sky-500/10 blur-2xl" />
              <CardContent className="relative pt-4 pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-sky-600 dark:text-sky-400 font-medium">Tools Available</p>
                    <motion.p
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="text-3xl font-bold mt-1 tabular-nums"
                    >
                      {tools.length}
                    </motion.p>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-500/10">
                    <Zap className="h-5 w-5 text-sky-500" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="relative overflow-hidden bg-gradient-to-br from-violet-500/10 to-violet-500/0 border-violet-500/20">
              <div className="absolute -top-4 -right-4 h-16 w-16 rounded-full bg-violet-500/10 blur-2xl" />
              <CardContent className="relative pt-4 pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-violet-600 dark:text-violet-400 font-medium">Max File Size</p>
                    <p className="text-3xl font-bold mt-1">50<span className="text-base font-normal text-muted-foreground"> MB</span></p>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/10">
                    <Shield className="h-5 w-5 text-violet-500" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Tool Usage Insights */}
      {totalFiles > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-lg font-semibold">Usage Insights</h3>
            <Badge variant="secondary" className="text-[10px]">{Object.keys(toolStats).length} tools used</Badge>
          </div>
          <Card>
            <CardContent className="pt-6">
              <div className="space-y-3">
                {Object.entries(toolStats)
                  .sort(([, a], [, b]) => b - a)
                  .map(([tool, count], idx) => {
                    const maxCount = Math.max(...Object.values(toolStats))
                    const percentage = maxCount > 0 ? (count / maxCount) * 100 : 0
                    const Icon = toolIconMap[tool] || FileSpreadsheet
                    return (
                      <motion.div
                        key={tool}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        className="flex items-center gap-3"
                      >
                        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${toolColorMap[tool] || "bg-muted text-muted-foreground"}`}>
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-medium">{toolLabelMap[tool] || tool}</span>
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {count} {count === 1 ? "file" : "files"}
                              {idx === 0 && count > 0 && (
                                <span className="ml-1 inline-flex items-center gap-0.5 text-amber-500">
                                  <TrendingUp className="h-2.5 w-2.5" />
                                </span>
                              )}
                            </span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${percentage}%` }}
                              transition={{ duration: 0.8, ease: "easeOut", delay: 0.1 + idx * 0.05 }}
                              className="h-full rounded-full bg-gradient-to-r from-primary/60 to-primary"
                            />
                          </div>
                        </div>
                      </motion.div>
                    )
                  })}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
