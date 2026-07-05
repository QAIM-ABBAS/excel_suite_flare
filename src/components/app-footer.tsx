"use client"

import { useAppStore } from "@/lib/store"
import { Heart, Github, Keyboard, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTheme } from "next-themes"
import { useSyncExternalStore } from "react"

const emptySubscribe = () => () => {}
function useMounted() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false)
}

interface AppFooterProps {
  onOpenShortcuts?: () => void
}

export function AppFooter({ onOpenShortcuts }: AppFooterProps) {
  const { setCurrentView } = useAppStore()
  const { theme } = useTheme()
  const mounted = useMounted()
  const isDark = mounted ? theme === "dark" : true

  const year = new Date().getFullYear()

  return (
    <footer className="mt-auto border-t border-border/50 bg-background/60 backdrop-blur-sm">
      <div className="mx-auto max-w-7xl px-4 lg:px-6 py-3">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-muted-foreground">
          {/* Left: brand + copyright */}
          <div className="flex items-center gap-2 flex-wrap justify-center sm:justify-start">
            <span className="inline-flex items-center gap-1 font-medium">
              <Sparkles className="h-3 w-3 text-primary" />
              Excel Automation Suite
            </span>
            <span className="opacity-50">·</span>
            <span>v2.3.1</span>
            <span className="opacity-50">·</span>
            <span>© {year}</span>
          </div>

          {/* Center: nav links */}
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2.5 text-[11px]"
              onClick={() => setCurrentView("dashboard")}
            >
              Dashboard
            </Button>
            <span className="opacity-30">·</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2.5 text-[11px]"
              onClick={() => setCurrentView("settings")}
            >
              Settings
            </Button>
            <span className="opacity-30">·</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2.5 text-[11px]"
              onClick={() => setCurrentView("about")}
            >
              About
            </Button>
          </div>

          {/* Right: shortcuts + theme + made-with */}
          <div className="flex items-center gap-3">
            {onOpenShortcuts && (
              <button
                onClick={onOpenShortcuts}
                className="inline-flex items-center gap-1 rounded-md hover:bg-muted/60 px-2 py-1 transition-colors"
                title="Keyboard shortcuts (?)"
              >
                <Keyboard className="h-3 w-3" />
                <span className="hidden sm:inline">Shortcuts</span>
                <kbd className="hidden sm:inline-flex h-4 select-none items-center rounded border bg-muted px-1 font-mono text-[9px]">?</kbd>
              </button>
            )}
            <span className="hidden md:inline opacity-30">·</span>
            <span className="inline-flex items-center gap-1">
              <Github className="h-3 w-3" />
              <span className="hidden sm:inline">Open Source</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="hidden sm:inline">Made with</span>
              <Heart className="h-3 w-3 text-rose-500 fill-rose-500" />
              <span className="hidden sm:inline">{isDark ? "in dark mode" : "in light mode"}</span>
            </span>
          </div>
        </div>
      </div>
    </footer>
  )
}
