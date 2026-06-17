/** HTTP API 根路径：留空则走同源 /api（Next.js 反代到 BFF） */
export function getApiBase(): string {
  return process.env.NEXT_PUBLIC_API_BASE || ""
}

/** WebSocket 根路径：留空则走同源 /ws（Next.js 反代到 BFF） */
export function getWsBase(): string {
  return process.env.NEXT_PUBLIC_WS_BASE || ""
}

export function apiUrl(path: string): string {
  return `${getApiBase()}${path}`
}

/** 静态资源（如技能封面 /covers/...），与 apiUrl 相同规则，支持相对路径与绝对 URL */
export function assetUrl(path?: string | null): string {
  if (!path?.trim()) return ""
  const trimmed = path.trim()
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed
  const normalized = trimmed.startsWith("/") ? trimmed : `/${trimmed}`
  return `${getApiBase()}${normalized}`
}

export function wsUrl(path: string): string {
  const base = getWsBase()
  if (base) return `${base}${path}`
  return path
}
