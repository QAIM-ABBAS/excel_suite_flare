"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { FileSpreadsheet, Zap, Shield, Code, Github, Heart, Sparkles, ArrowLeftRight, GitMerge, CopyX, UserCheck, Download, ImageDown, ArrowUpDown, Filter, BarChart3, Table2, Replace, ShieldCheck, FlipHorizontal2 } from "lucide-react"
import { useAppStore } from "@/lib/store"
import { motion } from "framer-motion"

const features = [
  { icon: GitMerge, title: "Merge Files", description: "Combine multiple Excel/CSV files with header mismatch detection" },
  { icon: ArrowLeftRight, title: "Format Conversion", description: "Convert between CSV and Excel with custom delimiters" },
  { icon: CopyX, title: "Duplicate Removal", description: "Find and remove duplicates with first/last occurrence options" },
  { icon: ArrowUpDown, title: "Data Sorter", description: "Sort data by any column ascending or descending" },
  { icon: Filter, title: "Data Filter", description: "Filter rows by multiple conditions with AND / OR logic" },
  { icon: Replace, title: "Find & Replace", description: "Search and replace text with scope control and change preview" },
  { icon: ShieldCheck, title: "Data Validation", description: "Scan for empty cells, type mismatches, duplicate keys, format violations, and outliers" },
  { icon: FlipHorizontal2, title: "Transpose / Reshape", description: "Swap rows and columns, or unpivot wide-format data into long format" },
  { icon: BarChart3, title: "Statistics & Summary", description: "Compute descriptive statistics for every column" },
  { icon: Table2, title: "Pivot / Group-By", description: "Group rows and aggregate values into summary tables" },
  { icon: UserCheck, title: "Attendance Tracking", description: "Calculate attendance statistics and export PDF reports" },
  { icon: Download, title: "URL Downloads", description: "Download spreadsheet files from any web URL" },
  { icon: ImageDown, title: "Image Embedding", description: "Batch download images and embed into Excel spreadsheets" },
]

const stats = [
  { label: "Tools", value: "13" },
  { label: "Max File Size", value: "50MB" },
  { label: "Formats", value: "3" },
  { label: "Version", value: "2.3.0" },
]

export function AboutView() {
  const { setCurrentView } = useAppStore()

  return (
    <div className="space-y-6 max-w-3xl">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <Card className="relative overflow-hidden">
          <div className="absolute top-0 right-0 -mt-16 -mr-16 h-48 w-48 rounded-full bg-primary/5 blur-3xl" />
          <CardHeader className="relative">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-lg">
                <FileSpreadsheet className="h-7 w-7" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-xl">Excel Automation Suite</CardTitle>
                  <Badge variant="secondary" className="text-[10px]">v2.3.0</Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">Professional spreadsheet automation tools</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="relative space-y-4">
            <p className="text-sm text-muted-foreground leading-relaxed">
              A comprehensive suite of tools for automating Excel and CSV file operations.
              Built with modern web technologies for speed, reliability, and an exceptional user experience.
              Process thousands of rows in seconds with our optimized backend.
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {stats.map((stat) => (
                <div key={stat.label} className="rounded-lg border border-border/50 bg-muted/30 p-3 text-center">
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                  <p className="text-lg font-bold mt-1">{stat.value}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Features</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {features.map((feature, i) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className="flex items-start gap-3 rounded-lg border border-border/50 p-3 hover:bg-muted/30 transition-colors"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                <feature.icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium">{feature.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{feature.description}</p>
              </div>
            </motion.div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="bg-gradient-to-br from-emerald-500/5 to-transparent border-emerald-500/10">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-emerald-500" />
              <CardTitle className="text-sm">Performance</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="text-xs text-muted-foreground space-y-1.5">
              <li className="flex items-center gap-1.5">
                <span className="h-1 w-1 rounded-full bg-emerald-500" />
                Supports datasets of 100,000+ rows
              </li>
              <li className="flex items-center gap-1.5">
                <span className="h-1 w-1 rounded-full bg-emerald-500" />
                Streaming data processing
              </li>
              <li className="flex items-center gap-1.5">
                <span className="h-1 w-1 rounded-full bg-emerald-500" />
                Async image downloads
              </li>
            </ul>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-sky-500/5 to-transparent border-sky-500/10">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-sky-500" />
              <CardTitle className="text-sm">Security</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="text-xs text-muted-foreground space-y-1.5">
              <li className="flex items-center gap-1.5">
                <span className="h-1 w-1 rounded-full bg-sky-500" />
                Strict upload validation
              </li>
              <li className="flex items-center gap-1.5">
                <span className="h-1 w-1 rounded-full bg-sky-500" />
                Path traversal protection
              </li>
              <li className="flex items-center gap-1.5">
                <span className="h-1 w-1 rounded-full bg-sky-500" />
                URL validation & timeouts
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Code className="h-3.5 w-3.5 text-primary" />
              <span>Built with Next.js 16, TypeScript, Tailwind CSS, Prisma, and shadcn/ui</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Github className="h-3.5 w-3.5" />
              <span>Open architecture</span>
              <span className="opacity-50">·</span>
              <span>Made with</span>
              <Heart className="h-3 w-3 text-rose-500 fill-rose-500" />
              <span>for productivity</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="text-center pb-4">
        <button
          onClick={() => setCurrentView("dashboard")}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Back to Dashboard
        </button>
      </div>
    </div>
  )
}
