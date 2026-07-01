"use client"

import { useState } from "react"
import { FileDropzone } from "@/components/file-dropzone"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Progress } from "@/components/ui/progress"
import { UserCheck, Loader2, CheckCircle2, FileDown, RotateCcw, TrendingUp, TrendingDown, XCircle } from "lucide-react"
import { toast } from "sonner"
import { motion, AnimatePresence } from "framer-motion"
import { useAppStore } from "@/lib/store"
import { apiFetch } from "@/lib/api"

interface AttendanceReport {
  rollNumber: string
  totalClasses: number
  presentCount: number
  absentCount: number
  attendancePercentage: string
  details?: { class: string; status: string }[]
}

export function AttendanceTool() {
  const { incrementActiveTasks, decrementActiveTasks, pushNotification } = useAppStore()
  const [file, setFile] = useState<File | null>(null)
  const [columns, setColumns] = useState<string[]>([])
  const [selectedColumn, setSelectedColumn] = useState("")
  const [rollNumber, setRollNumber] = useState("")
  const [isProcessing, setIsProcessing] = useState(false)
  const [isLoadingColumns, setIsLoadingColumns] = useState(false)
  const [progress, setProgress] = useState(0)
  const [report, setReport] = useState<AttendanceReport | null>(null)

  const handleFileSelected = async (files: File[]) => {
    const selected = files[0]
    setFile(selected)
    setReport(null)
    setIsLoadingColumns(true)

    try {
      const formData = new FormData()
      formData.append("file", selected)

      const response = await apiFetch("/api/tools/columns", {
        method: "POST",
        body: formData,
      })

      const data = await response.json()
      if (data.success && data.sheets.length > 0) {
        setColumns(data.sheets[0].columns)
        setSelectedColumn(data.sheets[0].columns[0] || "")
      }
    } catch {
      toast.error("Failed to read file columns")
    } finally {
      setIsLoadingColumns(false)
    }
  }

  const handleCheck = async () => {
    if (!file || !selectedColumn || !rollNumber) {
      toast.error("Please fill in all fields")
      return
    }

    setIsProcessing(true)
    setProgress(20)
    incrementActiveTasks()

    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("column", selectedColumn)
      formData.append("rollNumber", rollNumber)

      setProgress(50)

      const response = await apiFetch("/api/tools/attendance", {
        method: "POST",
        body: formData,
      })

      setProgress(80)
      const data = await response.json()

      if (!response.ok) throw new Error(data.error || "Failed to check attendance")

      setProgress(100)
      setReport(data.report)
      toast.success("Attendance report generated!")
      pushNotification({
        title: "Attendance checked",
        description: `Roll ${rollNumber}: ${data.report.attendancePercentage}% (${data.report.presentCount}/${data.report.totalClasses} classes)`,
        type: Number(data.report.attendancePercentage) >= 75 ? "success" : "warning",
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to check attendance"
      toast.error(msg)
      pushNotification({ title: "Attendance check failed", description: msg, type: "error" })
    } finally {
      setIsProcessing(false)
      decrementActiveTasks()
      setTimeout(() => setProgress(0), 1000)
    }
  }

  const resetTool = () => {
    setFile(null)
    setColumns([])
    setSelectedColumn("")
    setRollNumber("")
    setReport(null)
  }

  const handleExportPDF = () => {
    if (!report) return

    const printWindow = window.open("", "_blank", "width=800,height=900")
    if (!printWindow) {
      toast.error("Please allow popups to export PDF")
      return
    }

    const percentage = parseFloat(report.attendancePercentage)
    const status = percentage >= 75 ? "Good Standing" : percentage >= 50 ? "Needs Improvement" : "Critical"
    const statusColor = percentage >= 75 ? "#10b981" : percentage >= 50 ? "#f59e0b" : "#ef4444"
    const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })

    const detailsRows = report.details?.map(d => {
      const isPresent = d.status.toLowerCase() === "present" || d.status.toLowerCase() === "p"
      return `
        <tr>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb;">${d.class}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">
            <span style="display: inline-block; padding: 2px 10px; border-radius: 9999px; font-size: 11px; font-weight: 600;
              background: ${isPresent ? "#dcfce7" : "#fee2e2"}; color: ${isPresent ? "#16a34a" : "#dc2626"};">
              ${isPresent ? "Present" : "Absent"}
            </span>
          </td>
        </tr>
      `
    }).join("") || ""

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Attendance Report - ${report.rollNumber}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 40px; color: #1f2937; background: #fff; }
          .header { display: flex; align-items: center; gap: 12px; padding-bottom: 20px; border-bottom: 2px solid #e5e7eb; margin-bottom: 24px; }
          .logo { width: 40px; height: 40px; background: #0f172a; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: white; font-size: 18px; }
          .title { font-size: 20px; font-weight: 700; }
          .subtitle { font-size: 12px; color: #6b7280; }
          .info-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 24px; }
          .info-card { padding: 16px; border: 1px solid #e5e7eb; border-radius: 8px; text-align: center; }
          .info-label { font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; }
          .info-value { font-size: 24px; font-weight: 700; margin-top: 4px; }
          .percentage-card { background: linear-gradient(135deg, ${statusColor}15, ${statusColor}05); border: 1px solid ${statusColor}30; padding: 24px; border-radius: 12px; text-align: center; margin-bottom: 24px; }
          .percentage-value { font-size: 48px; font-weight: 800; color: ${statusColor}; }
          .percentage-status { font-size: 14px; color: #6b7280; margin-top: 4px; }
          .section-title { font-size: 14px; font-weight: 600; margin-bottom: 12px; color: #374151; }
          table { width: 100%; border-collapse: collapse; font-size: 13px; }
          th { padding: 8px 12px; text-align: left; background: #f9fafb; border-bottom: 2px solid #e5e7eb; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; }
          .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #9ca3af; text-align: center; }
          .meta { display: flex; justify-content: space-between; font-size: 12px; color: #6b7280; margin-bottom: 16px; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="logo">ES</div>
          <div>
            <div class="title">Attendance Report</div>
            <div class="subtitle">Excel Automation Suite</div>
          </div>
        </div>

        <div class="meta">
          <span>Roll Number: <strong>${report.rollNumber}</strong></span>
          <span>Generated: ${dateStr}</span>
        </div>

        <div class="percentage-card">
          <div class="percentage-value">${report.attendancePercentage}%</div>
          <div class="percentage-status">${status}</div>
        </div>

        <div class="info-grid">
          <div class="info-card">
            <div class="info-label">Total Classes</div>
            <div class="info-value" style="color: #0f172a;">${report.totalClasses}</div>
          </div>
          <div class="info-card">
            <div class="info-label">Present</div>
            <div class="info-value" style="color: #10b981;">${report.presentCount}</div>
          </div>
          <div class="info-card">
            <div class="info-label">Absent</div>
            <div class="info-value" style="color: #ef4444;">${report.absentCount}</div>
          </div>
        </div>

        ${report.details && report.details.length > 0 ? `
          <div class="section-title">Detailed Breakdown</div>
          <table>
            <thead>
              <tr>
                <th>Class / Date</th>
                <th style="text-align: center;">Status</th>
              </tr>
            </thead>
            <tbody>
              ${detailsRows}
            </tbody>
          </table>
        ` : ""}

        <div class="footer">
          Generated by Excel Automation Suite • ${dateStr}
        </div>
      </body>
      </html>
    `)
    printWindow.document.close()

    setTimeout(() => {
      printWindow.print()
    }, 500)
  }

  const percentage = report ? parseFloat(report.attendancePercentage) : 0
  const statusColor = percentage >= 75 ? "text-emerald-500" : percentage >= 50 ? "text-amber-500" : "text-rose-500"
  const statusBg = percentage >= 75 ? "from-emerald-500/10" : percentage >= 50 ? "from-amber-500/10" : "from-rose-500/10"

  return (
    <div className="space-y-6 max-w-3xl">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/10 text-sky-500">
                <UserCheck className="h-4 w-4" />
              </div>
              <div>
                <CardTitle className="text-base">Attendance Checker</CardTitle>
                <CardDescription>Calculate attendance statistics from spreadsheets</CardDescription>
              </div>
            </div>
            {file && (
              <Button variant="ghost" size="sm" onClick={resetTool} className="h-7 text-xs">
                <RotateCcw className="h-3 w-3 mr-1" />
                Reset
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <FileDropzone multiple={false} onFilesSelected={handleFileSelected} />

          {isLoadingColumns && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Reading file columns...
            </div>
          )}

          {columns.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
              <div className="space-y-2">
                <Label>Roll Number Column</Label>
                <Select value={selectedColumn} onValueChange={setSelectedColumn}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select column" />
                  </SelectTrigger>
                  <SelectContent>
                    {columns.map(col => (
                      <SelectItem key={col} value={col}>{col}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-3">
                <p className="text-xs text-sky-600 dark:text-sky-400">
                  <strong>Tip:</strong> Select the column containing roll numbers/student IDs. Other columns will be treated as class dates where "P" or "Present" indicates attendance.
                </p>
              </div>
            </motion.div>
          )}

          <div className="space-y-2">
            <Label htmlFor="rollNumber">Student Roll Number</Label>
            <Input
              id="rollNumber"
              value={rollNumber}
              onChange={(e) => setRollNumber(e.target.value)}
              placeholder="Enter roll number..."
              className="h-9"
              onKeyDown={(e) => {
                if (e.key === "Enter" && file && selectedColumn && rollNumber) {
                  handleCheck()
                }
              }}
            />
          </div>

          {isProcessing && (
            <div className="space-y-2">
              <Progress value={progress} className="h-2" />
              <p className="text-xs text-muted-foreground text-center">Checking attendance...</p>
            </div>
          )}

          <Button onClick={handleCheck} disabled={isProcessing || !file || !selectedColumn || !rollNumber} className="w-full">
            {isProcessing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Checking...
              </>
            ) : (
              <>
                <UserCheck className="mr-2 h-4 w-4" />
                Check Attendance
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <AnimatePresence>
        {report && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            <Card className={`border-sky-500/20 bg-gradient-to-br ${statusBg} to-transparent`}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-sky-500" />
                    <CardTitle className="text-base">Attendance Report</CardTitle>
                  </div>
                  <Button variant="outline" size="sm" onClick={handleExportPDF} className="h-7">
                    <FileDown className="h-3.5 w-3.5 mr-1" />
                    Export PDF
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between rounded-lg bg-background/50 p-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Roll Number</p>
                    <p className="text-lg font-semibold">{report.rollNumber}</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-4xl font-bold ${statusColor}`}>{report.attendancePercentage}%</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {percentage >= 75 ? "Good Standing" : percentage >= 50 ? "Needs Improvement" : "Critical"}
                    </p>
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="rounded-lg bg-background p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <UserCheck className="h-3 w-3 text-muted-foreground" />
                      <p className="text-xs text-muted-foreground">Total Classes</p>
                    </div>
                    <p className="text-xl font-semibold">{report.totalClasses}</p>
                  </div>
                  <div className="rounded-lg bg-background p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <TrendingUp className="h-3 w-3 text-emerald-500" />
                      <p className="text-xs text-muted-foreground">Present</p>
                    </div>
                    <p className="text-xl font-semibold text-emerald-500">{report.presentCount}</p>
                  </div>
                  <div className="rounded-lg bg-background p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <TrendingDown className="h-3 w-3 text-rose-500" />
                      <p className="text-xs text-muted-foreground">Absent</p>
                    </div>
                    <p className="text-xl font-semibold text-rose-500">{report.absentCount}</p>
                  </div>
                </div>

                {/* Progress bar showing attendance */}
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Attendance Rate</span>
                    <span className="font-medium">{report.attendancePercentage}%</span>
                  </div>
                  <div className="h-3 w-full rounded-full bg-muted overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${percentage}%` }}
                      transition={{ duration: 1, ease: "easeOut" }}
                      className={`h-full rounded-full ${
                        percentage >= 75 ? "bg-emerald-500" : percentage >= 50 ? "bg-amber-500" : "bg-rose-500"
                      }`}
                    />
                  </div>
                </div>

                {report.details && report.details.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Detailed Breakdown</Label>
                    <div className="max-h-48 overflow-auto rounded-lg border border-border/50 bg-muted/30 p-2">
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
                        {report.details.map((d, i) => {
                          const isPresent = d.status.toLowerCase() === "present" || d.status.toLowerCase() === "p"
                          return (
                            <div key={i} className="flex items-center justify-between gap-1 rounded bg-background/50 px-2 py-1 text-xs">
                              <span className="text-muted-foreground truncate" title={d.class}>{d.class}</span>
                              {isPresent ? (
                                <Badge variant="secondary" className="text-[9px] h-4 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                                  P
                                </Badge>
                              ) : (
                                <Badge variant="secondary" className="text-[9px] h-4 bg-rose-500/10 text-rose-600 dark:text-rose-400">
                                  A
                                </Badge>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
