import { getToken } from "./auth"
import type { WSEvent } from "@/types"

const WS_BASE = process.env.NEXT_PUBLIC_WS_BASE || ""

/** 任务详情页聊天 WebSocket（含自动重连）。false 时页面不连接，改由 HTTP 轮询拉回复 */
export const TASK_DETAIL_CHAT_WS_ENABLED = false

const MAX_RECONNECT_ATTEMPTS = 5
const BASE_DELAY_MS = 1000

export interface WSController {
  close(): void
}

const activeUrls = new Map<string, WSController>()

function createReconnectingWS(
  url: string,
  onEvent: (event: WSEvent) => void,
  onError?: (err: Event) => void,
  onClose?: () => void,
  onReconnecting?: (attempt: number) => void,
  onConnected?: () => void,
): WSController {
  let ws: WebSocket | null = null
  let intentionallyClosed = false
  let attempt = 0
  let connectTimer: ReturnType<typeof setTimeout> | null = null

  const controller: WSController = {
    close() {
      intentionallyClosed = true
      if (connectTimer) {
        clearTimeout(connectTimer)
        connectTimer = null
      }
      if (activeUrls.get(url) === controller) activeUrls.delete(url)
      ws?.close()
    },
  }

  function connect() {
    if (intentionallyClosed) return

    console.info("[task-ws] connecting", url)
    ws = new WebSocket(url)

    ws.onopen = () => {
      console.info("[task-ws] open", url)
      attempt = 0
      onConnected?.()
    }

    ws.onmessage = (msg) => {
      console.debug("[task-ws] raw message", msg.data)
      try {
        const event: WSEvent = JSON.parse(msg.data)
        console.debug("[task-ws] event", event)
        onEvent(event)
      } catch (err) {
        console.warn("[task-ws] failed to parse message", err, msg.data)
      }
    }

    ws.onerror = () => {
      // 主动 close / 页面切换 / StrictMode 重挂载时浏览器常会触发空 Event，并非真实故障
      if (intentionallyClosed) return
      const state = ws?.readyState
      if (state === WebSocket.CLOSING || state === WebSocket.CLOSED) return
      console.warn("[task-ws] connection error", { url, readyState: state })
      onError?.(new Event("error"))
    }

    ws.onclose = (event) => {
      if (!intentionallyClosed) {
        console.info("[task-ws] close", {
          url,
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
        })
      }
      if (intentionallyClosed) {
        onClose?.()
        return
      }
      attempt++
      if (attempt > MAX_RECONNECT_ATTEMPTS) {
        onClose?.()
        return
      }
      // 指数退避：1s / 2s / 4s / 8s / 16s
      const delay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt - 1), 16000)
      onReconnecting?.(attempt)
      setTimeout(connect, delay)
    }
  }

  // React dev StrictMode mounts and immediately unmounts effects once.
  // Deferring avoids creating a browser WS that is closed before open.
  connectTimer = setTimeout(() => {
    connectTimer = null
    connect()
  }, 100)
  return controller
}

export function connectSessionWS(
  sessionId: string,
  onEvent: (event: WSEvent) => void,
  onError?: (err: Event) => void,
  onClose?: () => void,
  onReconnecting?: (attempt: number) => void,
  onConnected?: () => void,
): WSController {
  const token = getToken()
  const url = `${WS_BASE}/ws/session/${sessionId}?token=${token || ""}`
  return createReconnectingWS(url, onEvent, onError, onClose, onReconnecting, onConnected)
}

export function connectChatTaskWS(
  taskId: string,
  onEvent: (event: WSEvent) => void,
  onError?: (err: Event) => void,
  onClose?: () => void,
  onReconnecting?: (attempt: number) => void,
  onConnected?: () => void,
): WSController {
  const token = getToken()
  const url = `${WS_BASE}/ws/chat/${taskId}?token=${token || ""}`
  activeUrls.get(url)?.close()
  const controller = createReconnectingWS(url, onEvent, onError, onClose, onReconnecting, onConnected)
  activeUrls.set(url, controller)
  return controller
}

export function connectTaskWS(
  taskId: string,
  onEvent: (event: WSEvent) => void,
  onError?: (err: Event) => void,
  onClose?: () => void,
): WebSocket {
  const token = getToken()
  const url = `${WS_BASE}/ws/task/${taskId}?token=${token || ""}`
  const ws = new WebSocket(url)

  ws.onmessage = (msg) => {
    try {
      const event: WSEvent = JSON.parse(msg.data)
      onEvent(event)
    } catch {
      // ignore
    }
  }

  ws.onerror = (err) => { onError?.(err) }
  ws.onclose = () => { onClose?.() }

  return ws
}
