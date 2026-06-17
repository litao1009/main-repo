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

export function wsUrl(path: string): string {
  const base = getWsBase()
  if (base) return `${base}${path}`
  return path
}
