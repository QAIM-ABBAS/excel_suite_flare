"use client"

import { useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Bell, CheckCheck, Trash2, Info, CheckCircle2, AlertTriangle, XCircle } from "lucide-react"
import { useAppStore } from "@/lib/store"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/lib/utils"

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const s = Math.floor(diff / 1000)
  if (s < 60) return "just now"
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

const typeMeta: Record<string, { icon: typeof Info; color: string }> = {
  info: { icon: Info, color: "text-sky-500" },
  success: { icon: CheckCircle2, color: "text-emerald-500" },
  warning: { icon: AlertTriangle, color: "text-amber-500" },
  error: { icon: XCircle, color: "text-rose-500" },
}

export function NotificationsPopover() {
  const [open, setOpen] = useState(false)
  const { notifications, markAllRead, clearNotifications } = useAppStore()
  const unread = notifications.filter((n) => !n.read).length

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-8 w-8 rounded-full">
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white"
            >
              {unread > 9 ? "9+" : unread}
            </motion.span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 && (
              <span className="rounded-full bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-medium text-rose-500">
                {unread} new
              </span>
            )}
          </div>
          {notifications.length > 0 && (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px]"
                onClick={markAllRead}
                disabled={unread === 0}
              >
                <CheckCheck className="h-3 w-3 mr-1" />
                Mark all read
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px] text-destructive hover:text-destructive"
                onClick={clearNotifications}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>

        <div className="max-h-80 overflow-y-auto scrollbar-thin">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <Bell className="h-8 w-8 text-muted-foreground/30 mb-2" />
              <p className="text-xs text-muted-foreground">No notifications yet</p>
              <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                Tool events will appear here
              </p>
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {notifications.map((n) => {
                const meta = typeMeta[n.type] || typeMeta.info
                const Icon = meta.icon
                return (
                  <motion.div
                    key={n.id}
                    layout
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className={cn(
                      "flex items-start gap-2.5 border-b border-border/30 px-3 py-2.5 last:border-b-0",
                      !n.read && "bg-primary/5"
                    )}
                  >
                    <Icon className={cn("h-4 w-4 shrink-0 mt-0.5", meta.color)} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium leading-tight">{n.title}</p>
                      {n.description && (
                        <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                          {n.description}
                        </p>
                      )}
                      <p className="text-[10px] text-muted-foreground/70 mt-1">{timeAgo(n.timestamp)}</p>
                    </div>
                    {!n.read && <div className="h-1.5 w-1.5 rounded-full bg-sky-500 mt-1.5 shrink-0" />}
                  </motion.div>
                )
              })}
            </AnimatePresence>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
