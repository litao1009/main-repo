import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { BookChapterPhase } from "@/types"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function formatNumber(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

export function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen) + "..." : text
}

const CN_DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"] as const

/** 阿拉伯数字转中文数字（用于「第一章」等展示，支持 0–9999） */
export function toChineseNumber(n: number): string {
  if (!Number.isInteger(n) || n < 0) return String(n)
  if (n === 0) return "零"
  if (n < 10) return CN_DIGITS[n]
  if (n < 20) return n === 10 ? "十" : `十${CN_DIGITS[n % 10]}`
  if (n < 100) {
    const tens = Math.floor(n / 10)
    const ones = n % 10
    return `${CN_DIGITS[tens]}十${ones === 0 ? "" : CN_DIGITS[ones]}`
  }
  if (n < 1000) {
    const hundreds = Math.floor(n / 100)
    const rest = n % 100
    const restStr = rest === 0 ? "" : rest < 10 ? `零${toChineseNumber(rest)}` : toChineseNumber(rest)
    return `${CN_DIGITS[hundreds]}百${restStr}`
  }
  if (n < 10000) {
    const thousands = Math.floor(n / 1000)
    const rest = n % 1000
    const restStr = rest === 0 ? "" : rest < 100 ? `零${toChineseNumber(rest)}` : toChineseNumber(rest)
    return `${CN_DIGITS[thousands]}千${restStr}`
  }
  return String(n)
}

/** 章节展示：第一章、第二章… */
export function formatChapterLabel(chapterNumber: number): string {
  return `第${toChineseNumber(chapterNumber)}章`
}

/** 卷名展示：第一卷；兼容「一卷」等缺少「第」的写法 */
export function formatVolumeLabel(volumeName: string): string {
  const v = volumeName.trim()
  if (!v) return ""
  if (/^第.+卷$/.test(v)) return v
  const m = v.match(/^([0-9一二三四五六七八九十百千零两\d]+)卷$/)
  if (m) return `第${m[1]}卷`
  return v
}

/** 解析 book/info 返回的章节 phase（兼容仅含 published 布尔字段的旧响应） */
export function resolveBookChapterPhase(ch: {
  phase?: string
  published?: boolean
}): BookChapterPhase | null {
  if (ch.phase === "published" || ch.phase === "draft") return ch.phase
  if (ch.published === true) return "published"
  if (ch.published === false) return "draft"
  return null
}

export function isBookChapterPublished(ch: {
  phase?: string
  published?: boolean
}): boolean {
  return resolveBookChapterPhase(ch) === "published"
}

/**
 * 将 ISO 时间字符串转为人性化相对描述：
 *   刚刚 / x分钟前 / 今天 HH:mm / 昨天 HH:mm / M月D日 HH:mm / YYYY年M月D日
 */
export function formatRelativeTime(dateStr: string): string {
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr

  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  const diffHour = Math.floor(diffMs / 3_600_000)

  if (diffMin < 1) return "刚刚"
  if (diffMin < 60) return `${diffMin}分钟前`

  const pad = (n: number) => String(n).padStart(2, "0")
  const hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}`

  // 判断是否同一天
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterdayStart = new Date(todayStart.getTime() - 86_400_000)
  const dStart = new Date(d.getFullYear(), d.getMonth(), d.getDate())

  if (dStart.getTime() === todayStart.getTime()) return `今天 ${hhmm}`
  if (dStart.getTime() === yesterdayStart.getTime()) return `昨天 ${hhmm}`

  // 同年只显示 M月D日
  if (d.getFullYear() === now.getFullYear()) {
    return `${d.getMonth() + 1}月${d.getDate()}日 ${hhmm}`
  }

  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}
