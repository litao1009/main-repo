"use client"

import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { AutoPublishTaskStatus } from "@/types"

export type AutoPublishStatusLike = {
  auto_publish_status?: string
  auto_publish_queue_position?: number
  auto_publish_next_update_at?: string | null
  chapter_number?: number
  running?: boolean
  recoverable_at?: string
  auto_publish_error_message?: string | null
}

function normalizeStatus(status?: string): AutoPublishTaskStatus | undefined {
  if (status === "queued" || status === "running" || status === "stopped" || status === "deleted") {
    return status
  }
  return undefined
}

function isRecoverablePending(recoverableAt?: string): boolean {
  if (!recoverableAt) return false
  const t = new Date(recoverableAt).getTime()
  return !Number.isNaN(t) && t > Date.now()
}

function formatFutureWait(recoverableAt: string): string {
  const diffMs = new Date(recoverableAt).getTime() - Date.now()
  if (diffMs <= 0) return "即将继续"
  const diffMin = Math.ceil(diffMs / 60_000)
  if (diffMin < 60) return `约 ${diffMin} 分钟后继续`
  const diffHour = Math.ceil(diffMs / 3_600_000)
  if (diffHour < 48) return `约 ${diffHour} 小时后继续`
  const diffDay = Math.ceil(diffMs / 86_400_000)
  return `约 ${diffDay} 天后继续`
}

function formatFutureExecute(nextUpdateAt: string): string {
  const target = new Date(nextUpdateAt)
  const targetMs = target.getTime()
  if (Number.isNaN(targetMs)) return nextUpdateAt

  const diffMs = targetMs - Date.now()
  if (diffMs <= 60_000) return "即将执行"

  const diffMin = Math.ceil(diffMs / 60_000)
  if (diffMin < 60) return `约 ${diffMin} 分钟后执行`

  const diffHour = Math.ceil(diffMs / 3_600_000)
  if (diffHour < 48) return `约 ${diffHour} 小时后执行`

  const pad = (n: number) => String(n).padStart(2, "0")
  const hhmm = `${pad(target.getHours())}:${pad(target.getMinutes())}`
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const tomorrowStart = new Date(todayStart.getTime() + 86_400_000)
  const targetStart = new Date(target.getFullYear(), target.getMonth(), target.getDate())

  if (targetStart.getTime() === todayStart.getTime()) return `下次执行 今天 ${hhmm}`
  if (targetStart.getTime() === tomorrowStart.getTime()) return `下次执行 明天 ${hhmm}`
  if (target.getFullYear() === now.getFullYear()) {
    return `下次执行 ${target.getMonth() + 1}月${target.getDate()}日 ${hhmm}`
  }
  return `下次执行 ${target.getFullYear()}年${target.getMonth() + 1}月${target.getDate()}日 ${hhmm}`
}

/** 任务列表卡片：queued 时在状态徽标下展示下次执行时间 */
export function getAutoPublishListNextUpdateLabel(
  status?: string,
  nextUpdateAt?: string | null,
): string | null {
  if (normalizeStatus(status) !== "queued") return null
  if (!nextUpdateAt?.trim()) return null
  return formatFutureExecute(nextUpdateAt)
}

export function getAutoPublishListLabel(status?: string, queuePosition?: number): string {
  const s = normalizeStatus(status)
  if (s === "deleted") return "已移除"
  if (s === "stopped") return "已暂停"
  if (s === "running") return "执行中"
  if (s === "queued") {
    if (queuePosition != null && queuePosition >= 1) return `排队中 · 第 ${queuePosition} 位`
    return "排队中"
  }
  return "排队中"
}

export function getAutoPublishDetailPrimary(data: AutoPublishStatusLike): string {
  const s = normalizeStatus(data.auto_publish_status)
  if (s === "deleted") return "已移除"
  if (s === "stopped") return "已暂停"
  if (s === "running") return "执行中"
  if (s === "queued") {
    if (data.auto_publish_queue_position != null && data.auto_publish_queue_position >= 1) {
      return `排队中 · 第 ${data.auto_publish_queue_position} 位`
    }
    return "排队中"
  }
  return "排队中"
}

export function getAutoPublishDetailSecondary(data: AutoPublishStatusLike): string | null {
  const s = normalizeStatus(data.auto_publish_status)
  if (s === "deleted") return "该任务已从发布队列移除"
  if (s === "running" && data.chapter_number != null && data.chapter_number > 0) {
    return `当前第 ${data.chapter_number} 章`
  }
  if (s === "queued" && isRecoverablePending(data.recoverable_at ?? data.auto_publish_next_update_at ?? undefined)) {
    const at = data.recoverable_at ?? data.auto_publish_next_update_at!
    return formatFutureWait(at)
  }
  return null
}

export function getAutoPublishErrorMessage(data: AutoPublishStatusLike): string | null {
  const msg = data.auto_publish_error_message?.trim()
  return msg || null
}

export function isAutoPublishRunningMode(autoPublishStatus?: string): boolean {
  const s = normalizeStatus(autoPublishStatus)
  return s === "running" || s === "queued"
}

function statusBadgeClass(status?: string): string {
  const s = normalizeStatus(status)
  switch (s) {
    case "running":
      return "text-orange-700 bg-orange-50 border-orange-100"
    case "queued":
      return "text-amber-700 bg-amber-50 border-amber-100"
    case "stopped":
      return "text-slate-600 bg-slate-100 border-slate-200"
    case "deleted":
      return "text-slate-400 bg-slate-50 border-slate-200"
    default:
      return "text-amber-700 bg-amber-50 border-amber-100"
  }
}

function statusDotClass(status?: string): string {
  const s = normalizeStatus(status)
  switch (s) {
    case "running":
      return "bg-orange-500"
    case "queued":
      return "bg-amber-500"
    case "stopped":
      return "bg-slate-400"
    case "deleted":
      return "bg-slate-300"
    default:
      return "bg-amber-500"
  }
}

export function AutoPublishStatusBadge({
  status,
  queuePosition,
  hint,
  className,
}: {
  status?: string
  queuePosition?: number
  hint?: string | null
  className?: string
}) {
  const label = getAutoPublishListLabel(status, queuePosition)
  const pulse = normalizeStatus(status) === "running"

  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium flex-shrink-0",
        statusBadgeClass(status),
        className,
      )}
      title={hint ? `${label} · ${hint}` : undefined}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          statusDotClass(status),
          pulse && "motion-safe:animate-pulse",
        )}
      />
      <span className="min-w-0 truncate">
        {hint ? `${label} · ${hint}` : label}
      </span>
    </span>
  )
}

export function AutoPublishHeaderStatus({
  data,
  loading,
  compact,
  className,
}: {
  data: AutoPublishStatusLike | null
  loading?: boolean
  compact?: boolean
  className?: string
}) {
  if (loading && !data) {
    return (
      <span className={cn("inline-flex h-6 items-center gap-1.5 text-xs leading-none text-slate-400 shrink-0", className)}>
        <Loader2 size={12} className="animate-spin" />
        加载发布状态…
      </span>
    )
  }

  const hint = data ? getAutoPublishDetailSecondary(data) : null

  return (
    <span className={cn("inline-flex h-6 max-w-full items-center shrink-0", className)}>
      <AutoPublishStatusBadge
        status={data?.auto_publish_status}
        queuePosition={data?.auto_publish_queue_position}
        hint={hint}
        className={
          compact
            ? "h-5 max-w-[min(52vw,20rem)] gap-1 border px-1.5 py-0 text-[11px] leading-none sm:max-w-md"
            : undefined
        }
      />
    </span>
  )
}

export function AutoPublishDetailStatus({
  data,
  loading,
  className,
}: {
  data: AutoPublishStatusLike | null
  loading?: boolean
  className?: string
}) {
  if (loading && !data) {
    return (
      <div className={cn("flex items-center gap-2 text-xs text-slate-400", className)}>
        <Loader2 size={12} className="animate-spin" />
        加载发布状态…
      </div>
    )
  }

  const primary = getAutoPublishDetailPrimary(data ?? {})
  const errorMessage = data ? getAutoPublishErrorMessage(data) : null
  const hint = data ? getAutoPublishDetailSecondary(data) : null
  const pulse = normalizeStatus(data?.auto_publish_status) === "running"

  return (
    <div
      className={cn(
        "inline-flex flex-col gap-0.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 min-w-0 max-w-full",
        className,
      )}
    >
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 min-w-0 flex-wrap">
        <span
          className={cn(
            "w-1.5 h-1.5 rounded-full shrink-0",
            statusDotClass(data?.auto_publish_status),
            pulse && "motion-safe:animate-pulse",
          )}
        />
        <span className="truncate shrink-0">{primary}</span>
        {errorMessage ? (
          <span className="text-red-600 font-normal truncate min-w-0" title={errorMessage}>
            {errorMessage}
          </span>
        ) : null}
      </span>
      {hint ? (
        <span className="text-[11px] text-slate-500 truncate pl-3" title={hint}>
          {hint}
        </span>
      ) : null}
    </div>
  )
}

export function AutoPublishRunToggle({
  autoPublishStatus,
  loading,
  disabled,
  onToggle,
  className,
}: {
  autoPublishStatus?: string
  loading?: boolean
  disabled?: boolean
  onToggle: (nextRunning: boolean) => void
  className?: string
}) {
  const runningMode = isAutoPublishRunningMode(autoPublishStatus)
  const isDeleted = normalizeStatus(autoPublishStatus) === "deleted"

  if (isDeleted) return null

  return (
    <div
      className={cn(
        "relative inline-flex p-0.5 rounded-lg border border-slate-200 bg-slate-100",
        disabled && "opacity-60 pointer-events-none",
        className,
      )}
      role="group"
      aria-label="自动发布运行开关"
    >
      <button
        type="button"
        disabled={loading || disabled}
        onClick={() => {
          if (runningMode) onToggle(false)
        }}
        className={cn(
          "relative px-3 py-1.5 text-xs font-medium rounded-md transition-colors min-w-[4.5rem]",
          !runningMode
            ? "bg-white text-slate-800 shadow-sm"
            : "text-slate-500 hover:text-slate-700",
        )}
      >
        暂停
      </button>
      <button
        type="button"
        disabled={loading || disabled}
        onClick={() => {
          if (!runningMode) onToggle(true)
        }}
        className={cn(
          "relative px-3 py-1.5 text-xs font-medium rounded-md transition-colors min-w-[4.5rem]",
          runningMode
            ? "bg-white text-orange-600 shadow-sm"
            : "text-slate-500 hover:text-slate-700",
        )}
      >
        运行
      </button>
      {loading ? (
        <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-white/60">
          <Loader2 size={14} className="animate-spin text-slate-500" />
        </span>
      ) : null}
    </div>
  )
}
