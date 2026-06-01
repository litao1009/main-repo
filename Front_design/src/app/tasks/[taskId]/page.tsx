"use client"

import { useEffect, useState, useRef, useCallback, useMemo } from "react"
import { useParams, useSearchParams, useRouter } from "next/navigation"
import { AnimatePresence, motion } from "framer-motion"
import { toast } from "sonner"
import {
  sendTaskMessage, publishTask, fetchTask,
  stopTask, fetchTaskMessages, clearTaskMessages,
  getBookInfo, getBookContent, fetchTaskPublishList,
} from "@/lib/api"
import {
  connectChatTaskWS,
  connectTaskWS,
  TASK_DETAIL_CHAT_WS_ENABLED,
  type WSController,
} from "@/lib/ws"
import type { SessionMessage, WSEvent, BookInfoResponse, PublishRecord } from "@/types"
import { Send, Loader2, CheckCircle, AlertCircle, ArrowLeft, Trash2, Plus, ChevronRight, ChevronDown } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Select as SelectRadix, SelectItem } from "@/components/ui/select"
import { cn, formatChapterLabel, shouldRefreshBookInfoAfterAiReply } from "@/lib/utils"
import { chatDisplayText } from "@/lib/chat-display"
import { resolveTaskListReturnUrl } from "@/lib/task-navigation"
import { getAuthUser } from "@/lib/auth"

function parseMessageTime(timestamp?: string): Date | null {
  if (!timestamp) return null
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? null : date
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}

function formatChatTime(timestamp?: string): string {
  const date = parseMessageTime(timestamp)
  if (!date) return ""

  const now = new Date()
  const time = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })
  if (isSameDay(date, now)) return time

  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (isSameDay(date, yesterday)) return `昨天 ${time}`

  const dateText = date.toLocaleDateString("zh-CN", {
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
    month: "2-digit",
    day: "2-digit",
  })
  return `${dateText} ${time}`
}

function ChapterStatusBadge({
  published,
  draftVersion,
}: {
  published: boolean
  draftVersion: number
}) {
  if (published) {
    return (
      <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-emerald-50 text-emerald-600">
        已发布
      </span>
    )
  }
  if (draftVersion > 0) {
    return (
      <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-orange-50 text-orange-600">
        有草稿
      </span>
    )
  }
  return (
    <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-slate-100 text-slate-500">
      无草稿
    </span>
  )
}

function shouldShowMessageTime(messages: SessionMessage[], index: number) {
  const current = parseMessageTime(messages[index]?.timestamp)
  if (!current) return false
  if (index === 0) return true

  const previous = parseMessageTime(messages[index - 1]?.timestamp)
  if (!previous) return true

  const fiveMinutes = 5 * 60 * 1000
  return !isSameDay(current, previous) || current.getTime() - previous.getTime() >= fiveMinutes
}

const chatMessageFade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  transition: { duration: 0.22, ease: [0.4, 0, 0.2, 1] as const },
}

const aiBubbleFade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.24, ease: [0.4, 0, 0.2, 1] as const },
}

type AiPendingPhase = "thinking" | "processing" | "streaming" | "reply" | "error"

type ComposerMode = "chat" | "edit"

interface AiPendingBubble {
  id: string
  phase: AiPendingPhase
  text: string
}

function isOptimisticMessageId(id: string) {
  return id.includes(":")
}

/** 合并服务端消息，尽量保留已有 React key，避免整表替换闪烁 */
function mergeServerMessages(prev: SessionMessage[], server: SessionMessage[]): SessionMessage[] {
  const serverMsgs = dedupeSystemMessages(server)
  if (serverMsgs.length === 0) return prev
  if (prev.length === 0) return serverMsgs

  const usedPrevIds = new Set<string>()
  const result: SessionMessage[] = []

  for (const sm of serverMsgs) {
    const byId = prev.find((p) => p.id === sm.id && !usedPrevIds.has(p.id))
    if (byId) {
      usedPrevIds.add(byId.id)
      result.push({ ...sm, id: byId.id })
      continue
    }

    if (sm.role === "user") {
      const optimistic = prev.find(
        (p) => !usedPrevIds.has(p.id) && p.role === "user" && p.text === sm.text && isOptimisticMessageId(p.id),
      )
      if (optimistic) {
        usedPrevIds.add(optimistic.id)
        result.push({ ...sm, id: optimistic.id })
        continue
      }
    }

    if (sm.role === "assistant" || sm.role === "system") {
      const streamPlaceholder = prev.find(
        (p) => !usedPrevIds.has(p.id) && p.id.includes(":stream-") && p.role === "assistant",
      )
      if (streamPlaceholder && sm.role === "assistant") {
        usedPrevIds.add(streamPlaceholder.id)
        result.push({ ...sm, id: streamPlaceholder.id })
        continue
      }

      const byText = prev.find(
        (p) => !usedPrevIds.has(p.id) && p.role === sm.role && p.text === sm.text,
      )
      if (byText) {
        usedPrevIds.add(byText.id)
        result.push({ ...sm, id: byText.id })
        continue
      }
    }

    const idx = result.length
    if (idx < prev.length) {
      const atIndex = prev[idx]
      if (!usedPrevIds.has(atIndex.id) && atIndex.role === sm.role && atIndex.text === sm.text) {
        usedPrevIds.add(atIndex.id)
        result.push({ ...sm, id: atIndex.id })
        continue
      }
    }

    result.push(sm)
  }

  return result
}

/** 去掉连续重复的 system 提示（后端偶发双写时的兜底） */
function dedupeSystemMessages(messages: SessionMessage[]) {
  return messages.filter((msg, index) => {
    if (msg.role !== "system") return true
    const prev = messages[index - 1]
    return !(prev?.role === "system" && prev.text === msg.text)
  })
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function turnHasReply(messages: SessionMessage[], baselineCount: number) {
  if (messages.length < baselineCount + 2) return false
  return messages.slice(baselineCount).some((m) => m.role === "assistant" || m.role === "system")
}

async function fetchTaskMessagesWithRetry(
  taskId: string,
  baselineCount: number,
  attempts = 5,
  intervalMs = 300,
) {
  let last: SessionMessage[] = []
  for (let i = 0; i < attempts; i++) {
    const resp = await fetchTaskMessages(taskId)
    last = resp.messages || []
    if (turnHasReply(last, baselineCount) || i === attempts - 1) {
      return { messages: last, hasReply: turnHasReply(last, baselineCount) }
    }
    await sleep(intervalMs)
  }
  return { messages: last, hasReply: turnHasReply(last, baselineCount) }
}

export default function SessionPage() {
  const { taskId } = useParams<{ taskId: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()
  const sessionIdFromQuery = searchParams.get("sid") || ""

  const [sessionId, setSessionId] = useState(sessionIdFromQuery)
  const [taskMessages, setTaskMessages] = useState<SessionMessage[]>([])
  const [draftVersion, setDraftVersion] = useState(0)
  const [input, setInput] = useState("")
  const [composerMode, setComposerMode] = useState<ComposerMode>("chat")
  const [streaming, setStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState("")
  const [publishState, setPublishState] = useState("")
  const [topic, setTopic] = useState("")
  const [platform, setPlatform] = useState("")
  const [novelName, setNovelName] = useState("")
  const [novelNameLocked, setNovelNameLocked] = useState(false)
  const [chapterTitle, setChapterTitle] = useState("")
  const [volumeName, setVolumeName] = useState("第一卷")
  const [chapterNumber, setChapterNumber] = useState(1)
  const [lockedAccountId, setLockedAccountId] = useState("")

  const [activeChapter, setActiveChapter] = useState<string>("")
  const [chapterDraft, setChapterDraft] = useState("")
  const [chapterDraftLoading, setChapterDraftLoading] = useState(false)
  const lastFetchedMsgTaskId = useRef("")

  const [bookInfo, setBookInfo] = useState<BookInfoResponse | null>(null)
  const [taskSkillId, setTaskSkillId] = useState("")
  const [taskModel, setTaskModel] = useState("")
  const [bookContent, setBookContent] = useState("")
  const [bookContentLoading, setBookContentLoading] = useState(false)
  const [bookContentError, setBookContentError] = useState<string | null>(null)
  const bookContentRequestRef = useRef(0)
  const [expandedVolumes, setExpandedVolumes] = useState<Set<string>>(new Set())
  const [selectedChapter, setSelectedChapter] = useState<{ volumeName: string; chapterNumber: number; sessionId: string; chapterTitle: string; status: string } | null>(null)
  const [publishedSessionIds, setPublishedSessionIds] = useState<Set<string>>(() => new Set())

  const syncPublishState = useCallback((items: PublishRecord[], info: BookInfoResponse | null) => {
    const ids = new Set(items.map((i) => i.sessionId).filter(Boolean))
    setPublishedSessionIds(ids)
    let maxPublishedChapter = 0
    if (info?.volumes) {
      for (const vol of info.volumes) {
        for (const ch of vol.chapters) {
          if (ids.has(ch.session_id)) {
            maxPublishedChapter = Math.max(maxPublishedChapter, ch.chapter_number)
          }
        }
      }
    }
    setChapterNumber(maxPublishedChapter + 1)
  }, [])

  const chapters = useMemo(() => {
    if (!bookInfo) return []
    const result: Array<{ sessionId: string; label: string; index: number; hasContent: boolean; chapterTitle?: string; published?: boolean; skillId?: string; model?: string }> = []
    for (const vol of bookInfo.volumes) {
      for (const ch of vol.chapters) {
        result.push({
          sessionId: ch.session_id,
          label: formatChapterLabel(ch.chapter_number),
          index: ch.chapter_number,
          hasContent: ch.draft_version > 0,
          chapterTitle: ch.title || undefined,
          published: publishedSessionIds.has(ch.session_id),
          skillId: taskSkillId,
          model: taskModel,
        })
      }
    }
    result.sort((a, b) => a.index - b.index)
    return result
  }, [bookInfo, taskSkillId, taskModel, publishedSessionIds])

  /** 一键发布弹窗：最近已发布 / 下一章 / 待发布预览（最多 5 章） */
  const publishModalData = useMemo(() => {
    const withContent = chapters.filter((c) => c.hasContent)
    const published = withContent.filter((c) => c.published)
    const pending = withContent.filter((c) => !c.published)
    const lastPublished =
      published.length > 0
        ? published.reduce((best, cur) => (cur.index > best.index ? cur : best))
        : null
    const nextToPublish = pending[0] ?? null
    return {
      lastPublished,
      nextToPublish,
      pendingPreview: pending.slice(0, 5),
      hasPublished: published.length > 0,
    }
  }, [chapters])

  const [showPublishModal, setShowPublishModal] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [showClearChatModal, setShowClearChatModal] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [clearingChat, setClearingChat] = useState(false)
  const [publishChapterId, setPublishChapterId] = useState("")

  const [tabsOverflow, setTabsOverflow] = useState(false)
  const [toolCallActive, setToolCallActive] = useState(false)
  const [wsReconnecting, setWsReconnecting] = useState(false)
  const [wsReconnectAttempt, setWsReconnectAttempt] = useState(0)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const chatContainerRef = useRef<HTMLDivElement>(null)
  const lastMsgCountRef = useRef(0)
  const initialScrollPendingRef = useRef(true)
  const [entryAnimateIds, setEntryAnimateIds] = useState<ReadonlySet<string>>(() => new Set())
  const wsRef = useRef<WSController | null>(null)
  const publishWsRef = useRef<WebSocket | null>(null)
  const msgCounterRef = useRef(0)
  const publishStateRef = useRef("")
  const tabsRef = useRef<HTMLDivElement>(null)
  const animatedMessageIdsRef = useRef(new Set<string>())
  const skipHistoryAnimationRef = useRef(true)
  const streamingTextRef = useRef("")
  const streamingRef = useRef(false)
  const turnBaselineCountRef = useRef(0)
  const finalizeInFlightRef = useRef(false)
  const pendingServerMessagesRef = useRef<SessionMessage[] | null>(null)
  const pendingCommittingRef = useRef(false)
  const pendingCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [pendingAssistant, setPendingAssistant] = useState<AiPendingBubble | null>(null)
  // 用 ref 避免 WS 闭包中拿到过期值
  const activeChapterRef = useRef("")
  const sessionIdRef = useRef(sessionIdFromQuery)
  const selectedChapterRef = useRef(selectedChapter)
  const novelNameLockedRef = useRef(novelNameLocked)
  const lastSendComposerModeRef = useRef<ComposerMode>("chat")

  const editTargetSessionId = selectedChapter?.sessionId || sessionId || activeChapter
  const editTargetPublished = editTargetSessionId
    ? publishedSessionIds.has(editTargetSessionId)
    : false

  const chapterStats = useMemo(() => {
    if (!bookInfo?.volumes?.length) return { total: 0, published: 0 }
    let total = 0
    let published = 0
    for (const vol of bookInfo.volumes) {
      for (const ch of vol.chapters) {
        total += 1
        if (publishedSessionIds.has(ch.session_id)) published += 1
      }
    }
    return { total, published }
  }, [bookInfo, publishedSessionIds])

  const chatStatus = useMemo(() => {
    if (wsReconnecting) return { label: "重连中", active: true }
    if (streaming || pendingAssistant) {
      if (toolCallActive || pendingAssistant?.phase === "processing") return { label: "处理中", active: true }
      if (pendingAssistant?.phase === "thinking") return { label: "思考中", active: true }
      return { label: "生成中", active: true }
    }
    return { label: "空闲", active: false }
  }, [streaming, pendingAssistant, toolCallActive, wsReconnecting])

  useEffect(() => {
    setComposerMode("chat")
  }, [taskId])

  useEffect(() => { activeChapterRef.current = activeChapter }, [activeChapter])
  useEffect(() => { sessionIdRef.current = sessionId }, [sessionId])
  useEffect(() => { selectedChapterRef.current = selectedChapter }, [selectedChapter])
  useEffect(() => { streamingRef.current = streaming }, [streaming])

  const nextMsgId = useCallback(() => {
    msgCounterRef.current += 1
    return `${sessionId}:${msgCounterRef.current}`
  }, [sessionId])

  const scrollChatToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const container = chatContainerRef.current
    if (!container) return
    container.scrollTo({ top: container.scrollHeight, behavior })
  }, [])

  const markEntryAnimation = useCallback((ids: string[]) => {
    if (ids.length === 0) return
    setEntryAnimateIds((prev) => {
      const next = new Set(prev)
      let changed = false
      for (const id of ids) {
        if (!next.has(id)) {
          next.add(id)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [])

  const clearEntryAnimation = useCallback((id: string) => {
    setEntryAnimateIds((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  const commitPendingToList = useCallback(() => {
    if (pendingCommittingRef.current) return
    const serverMsgs = pendingServerMessagesRef.current
    if (!serverMsgs) return
    pendingCommittingRef.current = true
    setTaskMessages((prev) => mergeServerMessages(prev, serverMsgs))
    pendingServerMessagesRef.current = null
    setPendingAssistant(null)
    streamingTextRef.current = ""
    setStreamingText("")
    setToolCallActive(false)
    setStreaming(false)
    setWsReconnecting(false)
    pendingCommittingRef.current = false
    scrollChatToBottom("auto")
  }, [scrollChatToBottom])

  const showPendingReply = useCallback((
    serverMsgs: SessionMessage[],
    streamBuf: string,
  ) => {
    const deduped = dedupeSystemMessages(serverMsgs)
    pendingServerMessagesRef.current = deduped
    const lastAi = [...deduped].reverse().find((m) => m.role === "assistant" || m.role === "system")
    const serverText = lastAi?.text ? chatDisplayText(lastAi.text) : ""
    const text = serverText || chatDisplayText(streamBuf)
    if (!text) {
      commitPendingToList()
      return
    }
    const phase: AiPendingPhase = lastAi?.role === "system" ? "error" : "reply"
    setPendingAssistant((prev) => (
      prev
        ? { ...prev, phase, text }
        : { id: `${sessionIdRef.current}:pending-${Date.now()}`, phase, text }
    ))
    if (pendingCommitTimerRef.current) clearTimeout(pendingCommitTimerRef.current)
    pendingCommitTimerRef.current = setTimeout(() => {
      pendingCommitTimerRef.current = null
      commitPendingToList()
    }, 260)
  }, [commitPendingToList])

  useEffect(() => {
    initialScrollPendingRef.current = true
    lastMsgCountRef.current = 0
    return () => {
      if (pendingCommitTimerRef.current) clearTimeout(pendingCommitTimerRef.current)
    }
  }, [taskId])

  useEffect(() => {
    const container = chatContainerRef.current
    if (!container || taskMessages.length === 0) return

    if (initialScrollPendingRef.current) {
      initialScrollPendingRef.current = false
      lastMsgCountRef.current = taskMessages.length
      requestAnimationFrame(() => {
        scrollChatToBottom("auto")
        requestAnimationFrame(() => {
          scrollChatToBottom("auto")
          skipHistoryAnimationRef.current = false
        })
      })
      return
    }

    const countChanged = taskMessages.length !== lastMsgCountRef.current
    lastMsgCountRef.current = taskMessages.length

    requestAnimationFrame(() => {
      if (countChanged) {
        scrollChatToBottom("smooth")
      } else if (streaming) {
        container.scrollTop = container.scrollHeight
      }
    })
  }, [taskMessages.length, streaming, scrollChatToBottom])

  useEffect(() => {
    if (!pendingAssistant || !streaming) return
    const container = chatContainerRef.current
    if (!container) return
    container.scrollTop = container.scrollHeight
  }, [pendingAssistant, streaming])

  // 检测章节 tab 是否溢出，控制"新建章节"按钮位置
  useEffect(() => {
    const el = tabsRef.current
    if (!el) return
    const check = () => setTabsOverflow(el.scrollWidth > el.clientWidth + 1)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /** 刷新章节列表；不切换当前查看章节，不重新加载右侧正文 */
  const refreshBookInfo = useCallback(async (opts?: { syncSessionId?: string }) => {
    if (!taskId) return
    try {
      const info = await getBookInfo(taskId)
      setBookInfo(info)
      if (info.novel_name && !novelNameLocked) setNovelName(info.novel_name)

      const sel = selectedChapterRef.current
      if (sel) {
        for (const vol of Array.isArray(info.volumes) ? info.volumes : []) {
          if (vol.volume_name !== sel.volumeName) continue
          const ch = vol.chapters.find((c) => c.chapter_number === sel.chapterNumber)
          if (ch) {
            setSelectedChapter({
              volumeName: sel.volumeName,
              chapterNumber: sel.chapterNumber,
              sessionId: ch.session_id,
              chapterTitle: ch.title,
              status: ch.status,
            })
            break
          }
        }
      }

      if (opts?.syncSessionId) {
        for (const vol of Array.isArray(info.volumes) ? info.volumes : []) {
          const ch = vol.chapters.find((c) => c.session_id === opts.syncSessionId)
          if (ch) {
            setDraftVersion(ch.draft_version || 0)
            break
          }
        }
      }
    } catch {
      // 静默失败，避免打断聊天流
    }
  }, [taskId, novelNameLocked])

  const refreshBookInfoRef = useRef(refreshBookInfo)
  refreshBookInfoRef.current = refreshBookInfo

  const finalizeStreamingTurn = useCallback(async (eventSessionId: string, options?: { skipEmptyToast?: boolean }) => {
    if (finalizeInFlightRef.current) return
    finalizeInFlightRef.current = true

    const tid = taskId
    const baseline = turnBaselineCountRef.current
    const streamBuf = streamingTextRef.current.trim()

    try {
      if (tid) {
        try {
          const pollAttempts = TASK_DETAIL_CHAT_WS_ENABLED ? 5 : 90
          const pollInterval = TASK_DETAIL_CHAT_WS_ENABLED ? 300 : 1000
          const { messages, hasReply: found } = await fetchTaskMessagesWithRetry(
            tid,
            baseline,
            pollAttempts,
            pollInterval,
          )
          const lastAi = [...(messages || [])].reverse().find((m) => m.role === "assistant")
          if (lastAi && shouldRefreshBookInfoAfterAiReply(lastAi.text)) {
            void refreshBookInfoRef.current({ syncSessionId: sessionIdRef.current })
          } else if (lastSendComposerModeRef.current === "edit") {
            void refreshBookInfoRef.current({ syncSessionId: sessionIdRef.current })
          }
          if (found || streamBuf) {
            showPendingReply(messages, streamBuf)
          } else {
            pendingServerMessagesRef.current = dedupeSystemMessages(messages)
            commitPendingToList()
          }
        } catch {
          if (streamBuf) {
            showPendingReply([], streamBuf)
          } else if (!options?.skipEmptyToast) {
            toast.error("拉取 AI 回复失败，请重试")
            setPendingAssistant(null)
            setStreaming(false)
          }
        }
      }
    } finally {
      finalizeInFlightRef.current = false
    }
  }, [taskId, showPendingReply, commitPendingToList])

  const pollReplyWhileStreaming = useCallback(async () => {
    if (!taskId || !streamingRef.current) return
    try {
      const { messages, hasReply } = await fetchTaskMessagesWithRetry(taskId, turnBaselineCountRef.current, 3, 400)
      if (hasReply && streamingRef.current) {
        showPendingReply(messages, streamingTextRef.current.trim())
      }
    } catch {
      // 重连期间拉取失败时保持 streaming，等待 done/error 或下次重连
    }
  }, [taskId, showPendingReply])

  const finalizeStreamingTurnRef = useRef(finalizeStreamingTurn)
  const pollReplyWhileStreamingRef = useRef(pollReplyWhileStreaming)
  finalizeStreamingTurnRef.current = finalizeStreamingTurn
  pollReplyWhileStreamingRef.current = pollReplyWhileStreaming
  novelNameLockedRef.current = novelNameLocked

  const startWS = useCallback(async () => {
    if (!TASK_DETAIL_CHAT_WS_ENABLED || !taskId) return
    wsRef.current?.close()
    const ws = connectChatTaskWS(
      taskId,
      (event: WSEvent) => {
        const eventSessionId = event.session_id || sessionIdRef.current
        switch (event.type) {
          case "token": {
            const chunk = event.text || ""
            if (!chunk) break
            setStreamingText((prev) => {
              const next = chatDisplayText(prev + chunk)
              streamingTextRef.current = next
              setPendingAssistant((p) => (
                p ? { ...p, phase: next ? "streaming" : "processing", text: next } : p
              ))
              return next
            })
            break
          }
          case "draft_updated":
            if (event.draft_version) setDraftVersion(event.draft_version)
            void refreshBookInfoRef.current({ syncSessionId: eventSessionId })
            break
          case "novel_name":
            if (event.novel_name && !novelNameLockedRef.current) setNovelName(event.novel_name)
            break
          case "tool_call":
            setToolCallActive(true)
            setPendingAssistant((p) => (p ? { ...p, phase: "processing" } : p))
            break
          case "step_finish":
            setToolCallActive(false)
            setPendingAssistant((p) => {
              if (!p) return p
              return { ...p, phase: p.text.trim() ? "streaming" : "thinking" }
            })
            break
          case "done": {
            void finalizeStreamingTurnRef.current(eventSessionId)
            if (lastSendComposerModeRef.current === "edit") {
              void refreshBookInfoRef.current({
                syncSessionId: eventSessionId || sessionIdRef.current,
              })
            }
            break
          }
          case "error": {
            const errText = event.message || event.error || event.reason || "发生错误"
            if (errText !== "AI 未返回内容，请重试") {
              toast.error(errText)
            }
            void finalizeStreamingTurnRef.current(eventSessionId, { skipEmptyToast: true })
            break
          }
          case "episode_created":
            if (event.next_session_id) setSessionId(event.next_session_id)
            void refreshBookInfoRef.current({ syncSessionId: event.next_session_id })
            break
          case "session_interrupted":
            toast.error("服务暂时中断，请重试")
            setPendingAssistant(null)
            pendingServerMessagesRef.current = null
            setStreaming(false)
            setToolCallActive(false)
            break
          case "heartbeat":
            break
        }
      },
      undefined,
      undefined,
      (attempt) => {
        setWsReconnecting(true)
        setWsReconnectAttempt(attempt)
      },
      () => {
        setWsReconnecting(false)
        void pollReplyWhileStreamingRef.current()
      },
    )
    wsRef.current = ws
  }, [taskId])

  useEffect(() => {
    if (!taskId) return
    if (lastFetchedMsgTaskId.current === taskId) return
    lastFetchedMsgTaskId.current = taskId

    skipHistoryAnimationRef.current = true
    animatedMessageIdsRef.current.clear()
    setEntryAnimateIds(new Set())

    const loadPage = async () => {
      const [taskResult, msgsResult] = await Promise.allSettled([
        fetchTask(taskId),
        fetchTaskMessages(taskId),
      ])

      if (msgsResult.status === "fulfilled") {
        const raw = msgsResult.value as unknown as Record<string, unknown>
        const msgs = dedupeSystemMessages(Array.isArray(raw.messages) ? raw.messages as SessionMessage[] : [])
        msgs.forEach((m) => animatedMessageIdsRef.current.add(m.id))
        setTaskMessages(msgs)
      } else {
        skipHistoryAnimationRef.current = false
      }

      if (taskResult.status === "fulfilled") {
        const found = taskResult.value
        if (found.topic) setTopic(found.topic)
        if (found.platform) setPlatform(found.platform)
        if (found.account_id) {
          setLockedAccountId(found.account_id)
        }
        if (found.novel_name) {
          setNovelName(found.novel_name)
          setNovelNameLocked(true)
        }
        if (found.skill_id) setTaskSkillId(found.skill_id)
        if (found.model) setTaskModel(found.model)
      }
    }

    void loadPage()
  }, [taskId, sessionIdFromQuery])

  // 任务详情页 task 级 WebSocket（TASK_DETAIL_CHAT_WS_ENABLED 为 false 时不连接）
  useEffect(() => {
    if (!taskId || !TASK_DETAIL_CHAT_WS_ENABLED) return
    startWS()
    return () => {
      wsRef.current?.close()
    }
  }, [taskId, startWS])

  useEffect(() => {
    if (!taskId) return
    Promise.all([getBookInfo(taskId), fetchTaskPublishList(taskId)])
      .then(([info, pub]) => {
        setBookInfo(info)
        if (info.novel_name) setNovelName(info.novel_name)
        syncPublishState(pub.items, info)
        const vols = Array.isArray(info?.volumes) ? info.volumes : []
        if (vols.length > 0) {
          const firstCh = vols[0].chapters[0]
          setExpandedVolumes(new Set([vols[0].volume_name]))
          if (firstCh && !sessionIdFromQuery) {
            setActiveChapter(firstCh.session_id)
            setSessionId(firstCh.session_id)
          }
        }
      })
      .catch(() => {})
  }, [taskId, sessionIdFromQuery, syncPublishState])

  const loadSelectedChapter = async (volName: string, chapNum: number) => {
    if (!taskId) return
    const requestId = ++bookContentRequestRef.current
    setBookContent("")
    setBookContentError(null)
    setBookContentLoading(true)
    try {
      const data = await getBookContent(taskId, volName, chapNum)
      if (requestId !== bookContentRequestRef.current) return
      setBookContent(data.content)
      setChapterTitle(data.chapter_title)
      setBookContentError(null)
    } catch {
      if (requestId !== bookContentRequestRef.current) return
      setBookContent("")
      setBookContentError("加载章节内容失败，请稍后重试")
      toast.error("加载章节内容失败")
    } finally {
      if (requestId === bookContentRequestRef.current) {
        setBookContentLoading(false)
      }
    }
  }

  const handleSend = async () => {
    if (!input.trim() || !taskId) return
    const mode = composerMode
    lastSendComposerModeRef.current = mode
    if (mode === "edit") {
      if (!editTargetSessionId) {
        toast.error("请先在章节列表中选择要修改的章节")
        return
      }
      if (editTargetPublished) {
        toast.error("当前章节已发布，不能再通过 AI 修改内容")
        return
      }
    }
    const mid = nextMsgId()
    const text = input.trim()
    turnBaselineCountRef.current = taskMessages.length
    streamingTextRef.current = ""
    setStreamingText("")
    markEntryAnimation([mid])
    setTaskMessages((prev) => [...prev, { id: mid, role: "user", text, timestamp: new Date().toISOString() }])
    setInput("")
    setPendingAssistant({
      id: `${sessionIdRef.current}:pending-${Date.now()}`,
      phase: "thinking",
      text: "",
    })
    setStreaming(true)
    try {
      await sendTaskMessage(taskId, {
        text,
        target_session_id: mode === "edit" ? editTargetSessionId : undefined,
        draft_version: draftVersion,
        mode,
      })
      if (!TASK_DETAIL_CHAT_WS_ENABLED) {
        void finalizeStreamingTurnRef.current(sessionIdRef.current)
      }
    } catch (err) {
      setTaskMessages((prev) => prev.filter(msg => msg.id !== mid))
      setPendingAssistant(null)
      toast.error(err instanceof Error ? err.message : "发送失败")
      setStreaming(false)
    }
  }

  const handleClearChat = async () => {
    if (!taskId) return
    setClearingChat(true)
    try {
      await clearTaskMessages(taskId)
      animatedMessageIdsRef.current.clear()
      setTaskMessages([])
      setPendingAssistant(null)
      pendingServerMessagesRef.current = null
      setStreamingText("")
      setShowClearChatModal(false)
      toast.success("会话记录已清空")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "清空失败")
    } finally {
      setClearingChat(false)
    }
  }

  const handlePublish = async () => {
    if (!taskId || !sessionId) return
    setPublishState("publishing")
    publishStateRef.current = "publishing"
    publishWsRef.current?.close()
    const ws = connectTaskWS(taskId,
      (event: WSEvent) => {
        const stage = (event as any).stage || event.type
        const wsStatus = (event as any).status
        if (stage === "done") { setPublishState(wsStatus === "success" ? "done" : "error"); publishStateRef.current = wsStatus === "success" ? "done" : "error" }
        else if (stage === "done_partial") { setPublishState("partial"); publishStateRef.current = "partial" }
        else if (stage === "error" || wsStatus === "error") { setPublishState("error"); publishStateRef.current = "error" }
      },
      () => { setPublishState("error"); publishStateRef.current = "error" },
      () => { if (publishStateRef.current === "publishing") { setPublishState("done"); publishStateRef.current = "done" } }
    )
    publishWsRef.current = ws
    try {
      const accountsForPublish = lockedAccountId ? [lockedAccountId] : []
      const publishSid = publishChapterId || sessionId
      const publishChapter = chapters.find(c => c.sessionId === publishSid)
      const publishChNum = publishChapter ? publishChapter.index : chapterNumber
      const publishChTitle = publishChapter?.chapterTitle || chapterTitle
      const result = await publishTask(taskId, {
        draft_version: draftVersion, sessionId: publishSid, platform, accounts: accountsForPublish,
        skillId: "", topic, novelName, title: publishChTitle, volumeName, chapterNumber: publishChNum,
      })
      if (result.status === "done") {
        setPublishState("done"); publishStateRef.current = "done"
        if (novelName) setNovelNameLocked(true)
        try {
          const [info, pub] = await Promise.all([
            getBookInfo(taskId),
            fetchTaskPublishList(taskId),
          ])
          setBookInfo(info)
          syncPublishState(pub.items, info)
        } catch {
          // 发布已成功，刷新状态失败时下次进入页面会纠正
        }
      } else if (result.status === "done_partial") {
        setPublishState("partial"); publishStateRef.current = "partial"
        const failed = (result.results || []).filter((r: any) => r.status !== "ok")
        toast.error("部分账号发布失败: " + failed.map((r: any) => `${r.platform}:${r.errorCode || "unknown"}`).join(", "))
      } else {
        setPublishState("error"); publishStateRef.current = "error"
        toast.error("发布未完全成功")
      }
    } catch (err) {
      setPublishState("error"); publishStateRef.current = "error"
      toast.error(err instanceof Error ? err.message : "发布失败")
    }
    setShowPublishModal(false)
    setTimeout(() => { if (publishStateRef.current === "publishing") { setPublishState("done"); publishStateRef.current = "done" } }, 120000)
  }

  const handleDelete = async () => {
    if (!taskId) return
    const uid = getAuthUser()?.uid
    if (!uid) {
      toast.error("请先登录")
      return
    }
    setDeleting(true)
    try {
      await stopTask(taskId, uid)
      router.replace(resolveTaskListReturnUrl(searchParams))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败")
      setDeleting(false)
      setShowDeleteModal(false)
    }
  }

  const returnToTaskList = useCallback(() => {
    router.push(resolveTaskListReturnUrl(searchParams))
  }, [router, searchParams])

  const keyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-slate-50">

      {/* ── 顶部 Header ── */}
      <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-4 shrink-0 z-20 shadow-sm">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={returnToTaskList}
            className="p-2 text-slate-400 hover:text-slate-700 transition-colors rounded-lg hover:bg-slate-100 shrink-0"
            aria-label="返回任务列表"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex items-center gap-3 min-w-0 pl-0.5">
            <span className="hidden sm:block w-1 h-8 rounded-full bg-gradient-to-b from-orange-500 to-amber-400 shrink-0" aria-hidden />
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-slate-900 truncate leading-tight tracking-tight">
                {novelName || "未命名作品"}
              </h1>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowDeleteModal(true)}
            className="px-3 py-1.5 text-sm font-medium text-slate-500 bg-white border border-slate-200 rounded-md hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-colors flex items-center gap-1.5 shadow-sm"
          >
            <Trash2 size={14} />
            删除
          </button>
          <button
            type="button"
            hidden
            aria-hidden
            tabIndex={-1}
            onClick={() => {
              setPublishChapterId(publishModalData.nextToPublish?.sessionId || "")
              setShowPublishModal(true)
            }}
            disabled={!publishModalData.nextToPublish}
            className="hidden px-4 py-1.5 text-sm font-medium text-white bg-gradient-to-r from-orange-500 to-red-500 rounded-md hover:opacity-90 shadow-sm items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {publishState === "publishing"
              ? <><Loader2 size={14} className="animate-spin" />发布中...</>
              : publishState === "done"
                ? <><CheckCircle size={14} />已发布</>
                : publishState === "error"
                  ? <><AlertCircle size={14} />发布失败</>
                  : <><Send size={14} />一键发布</>}
          </button>
        </div>
      </header>

      {/* ── 主内容区 ── */}
      <main className="flex-1 flex overflow-hidden">

        {/* 左侧：对话区 */}
        <section className="w-[35%] min-w-[320px] max-w-[500px] border-r border-slate-200 bg-slate-100 flex flex-col">
          <div className="h-11 px-3 border-b border-slate-200 bg-slate-100 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={cn(
                  "w-1.5 h-1.5 rounded-full shrink-0",
                  chatStatus.active ? "bg-orange-500 animate-pulse" : "bg-slate-400",
                )}
                aria-hidden
              />
              <span className="text-xs text-slate-500">{chatStatus.label}</span>
            </div>
            <button
              type="button"
              onClick={() => setShowClearChatModal(true)}
              disabled={taskMessages.length === 0 || streaming}
              title="清空记录"
              aria-label="清空记录"
              className="p-1.5 rounded-md text-slate-400 hover:text-red-500 hover:bg-white/80 disabled:opacity-35 disabled:hover:text-slate-400 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
            >
              <Trash2 size={15} />
            </button>
          </div>
          <div
            ref={chatContainerRef}
            className="flex-1 overflow-y-auto overflow-anchor-auto scroll-stable p-4 space-y-5 scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-transparent"
          >
              {taskMessages.map((msg, index) => {
                const displayText = msg.role === "assistant" ? chatDisplayText(msg.text) : msg.text
                if (msg.role === "assistant" && !displayText.trim()) return null

                const shouldAnimate = msg.role === "user" && entryAnimateIds.has(msg.id)

                return (
                  <motion.div
                    key={msg.id}
                    className="space-y-2"
                    initial={shouldAnimate ? chatMessageFade.initial : false}
                    animate={chatMessageFade.animate}
                    transition={chatMessageFade.transition}
                    onAnimationComplete={() => {
                      if (!shouldAnimate) return
                      animatedMessageIdsRef.current.add(msg.id)
                      clearEntryAnimation(msg.id)
                    }}
                  >
                    {shouldShowMessageTime(taskMessages, index) && (
                      <div className="flex justify-center">
                        <span className="px-2.5 py-1 rounded-full bg-slate-200/70 text-[11px] text-slate-500">
                          {formatChatTime(msg.timestamp)}
                        </span>
                      </div>
                    )}
                    <div className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start items-start gap-3")}>
                      {msg.role === "assistant" && (
                        <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center shrink-0 text-xs font-bold text-orange-600">AI</div>
                      )}
                      {msg.role === "system" && (
                        <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0 text-xs font-bold text-amber-600">!</div>
                      )}
                      <div className={cn(
                        "max-w-[85%] px-4 py-3 text-sm shadow-sm leading-relaxed",
                        msg.role === "user"
                          ? "bg-slate-900 text-white rounded-[20px_20px_4px_20px]"
                          : msg.role === "system"
                            ? "bg-amber-50 border border-amber-200 text-amber-800 rounded-[20px_20px_20px_4px]"
                            : "bg-white border border-slate-200 text-slate-700 rounded-[20px_20px_20px_4px]"
                      )}>
                        <p className="whitespace-pre-wrap">{displayText}</p>
                      </div>
                    </div>
                  </motion.div>
                )
              })}
            {pendingAssistant && (
              <div className="flex justify-start items-start gap-3">
                {pendingAssistant.phase === "error" ? (
                  <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0 text-xs font-bold text-amber-600">!</div>
                ) : (
                  <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center shrink-0 text-xs font-bold text-orange-600">AI</div>
                )}
                <div className={cn(
                  "max-w-[85%] px-4 py-3 text-sm shadow-sm leading-relaxed min-h-[44px]",
                  pendingAssistant.phase === "error"
                    ? "bg-amber-50 border border-amber-200 text-amber-800 rounded-[20px_20px_20px_4px]"
                    : "bg-white border border-slate-200 text-slate-700 rounded-[20px_20px_20px_4px]",
                )}>
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={
                        pendingAssistant.phase === "reply" || pendingAssistant.phase === "error"
                          ? "final"
                          : pendingAssistant.phase
                      }
                      initial={aiBubbleFade.initial}
                      animate={aiBubbleFade.animate}
                      exit={aiBubbleFade.exit}
                      transition={aiBubbleFade.transition}
                    >
                      {pendingAssistant.phase === "thinking" && (
                        <span className="flex items-center gap-2 text-slate-400">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          AI 正在思考...
                        </span>
                      )}
                      {pendingAssistant.phase === "processing" && (
                        <span className="flex items-center gap-2 text-slate-400">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          AI 正在处理...
                        </span>
                      )}
                      {pendingAssistant.phase === "streaming" && (
                        <span className="whitespace-pre-wrap">
                          {pendingAssistant.text}
                          <span className="inline-block w-0.5 h-4 bg-orange-500 animate-pulse ml-0.5 align-middle" />
                        </span>
                      )}
                      {(pendingAssistant.phase === "reply" || pendingAssistant.phase === "error") && (
                        <p className="whitespace-pre-wrap">{pendingAssistant.text}</p>
                      )}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </div>
            )}
            {TASK_DETAIL_CHAT_WS_ENABLED && wsReconnecting && !streaming && (
              <div className="flex justify-center">
                <span className="text-xs text-orange-500 bg-orange-50 border border-orange-200 px-3 py-1 rounded-full flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  连接中断，正在重连（第 {wsReconnectAttempt} 次）...
                </span>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div className="px-3 py-2.5 bg-white border-t border-slate-200 shrink-0 space-y-2">
            <div className="flex items-center justify-between gap-2 px-0.5">
              <div
                className="inline-flex p-0.5 rounded-lg bg-slate-100 border border-slate-200/80"
                role="tablist"
                aria-label="会话模式"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={composerMode === "chat"}
                  onClick={() => setComposerMode("chat")}
                  className={cn(
                    "px-3 py-1 rounded-md text-xs font-medium transition-all",
                    composerMode === "chat"
                      ? "bg-white text-slate-800 shadow-sm"
                      : "text-slate-500 hover:text-slate-700",
                  )}
                >
                  对话
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={composerMode === "edit"}
                  onClick={() => setComposerMode("edit")}
                  className={cn(
                    "px-3 py-1 rounded-md text-xs font-medium transition-all",
                    composerMode === "edit"
                      ? "bg-white text-orange-700 shadow-sm ring-1 ring-orange-200/60"
                      : "text-slate-500 hover:text-slate-700",
                  )}
                >
                  改稿
                </button>
              </div>
              <p className="text-[10px] text-slate-400 text-right leading-snug min-w-0 flex-1 truncate">
                {composerMode === "chat"
                  ? "不修改章节正文"
                  : selectedChapter
                    ? editTargetPublished
                      ? "本章已发布，不可改稿"
                      : `改稿：${formatChapterLabel(selectedChapter.chapterNumber)}`
                    : "请先在右侧选择章节"}
              </p>
            </div>
            <div className="flex gap-2 items-center rounded-3xl border border-slate-200 bg-white pl-4 pr-1.5 py-1.5 shadow-sm focus-within:border-orange-300 focus-within:ring-2 focus-within:ring-orange-100/80 transition-all">
              <textarea
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={keyDown}
                placeholder={
                  composerMode === "chat"
                    ? "有什么想法，直接说…"
                    : editTargetPublished
                      ? "本章已发布，请切换到「对话」"
                      : selectedChapter
                        ? `描述如何修改${formatChapterLabel(selectedChapter.chapterNumber)}…`
                        : "请先在章节列表中选择要修改的章节"
                }
                className="flex-1 min-h-[34px] max-h-28 bg-transparent py-1.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none resize-none leading-normal"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || streaming}
                title={
                  composerMode === "chat"
                    ? "对话 (Enter)"
                    : editTargetPublished
                      ? "已发布章节不可改稿"
                      : "改稿模式 (Enter)"
                }
                className="h-9 w-9 shrink-0 rounded-full bg-gradient-to-br from-orange-500 to-orange-600 text-white hover:from-orange-600 hover:to-orange-700 disabled:opacity-35 disabled:cursor-not-allowed transition-all shadow-sm inline-flex items-center justify-center"
              >
                {streaming ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Send size={16} strokeWidth={2.25} className="-translate-x-[2px] translate-y-px" />
                )}
              </button>
            </div>
            <p className="mt-1.5 px-1 text-[10px] text-slate-400 text-center">
              Enter 发送 · Shift+Enter 换行
            </p>
          </div>
        </section>

        {/* 中：卷章树 */}
        <section className="w-[18%] min-w-[200px] max-w-[260px] border-r border-slate-200 bg-white flex flex-col shadow-[inset_4px_0_12px_-8px_rgba(15,23,42,0.06)]">
          <div className="h-11 px-3 border-b border-slate-200 flex items-center shrink-0 bg-white">
            <p className="text-xs text-slate-500 tabular-nums">
              {chapterStats.total > 0 ? (
                <>
                  共 {chapterStats.total} 章
                  <span className="text-slate-300 mx-1">·</span>
                  <span className="text-emerald-600">{chapterStats.published} 已发布</span>
                </>
              ) : (
                "暂无章节"
              )}
            </p>
          </div>
          <div className="flex-1 overflow-y-auto scroll-stable px-2 py-2 bg-slate-50/40">
            {bookInfo && Array.isArray(bookInfo.volumes) && bookInfo.volumes.length > 0 ? (
              bookInfo.volumes.map((vol) => {
                const isExpanded = expandedVolumes.has(vol.volume_name)
                return (
                  <div key={vol.volume_name} className="mb-2 last:mb-0">
                    <button
                      onClick={() => {
                        setExpandedVolumes(prev => {
                          const next = new Set(prev)
                          if (next.has(vol.volume_name)) next.delete(vol.volume_name)
                          else next.add(vol.volume_name)
                          return next
                        })
                      }}
                      className="w-full flex items-center gap-1.5 px-2.5 py-2 text-sm font-semibold text-slate-700 rounded-lg hover:bg-white/90 transition-colors"
                    >
                      {isExpanded ? <ChevronDown size={14} className="text-orange-500 shrink-0" /> : <ChevronRight size={14} className="text-slate-400 shrink-0" />}
                      <span className="truncate">{vol.volume_name || "未命名卷"}</span>
                      <span className="ml-auto shrink-0 rounded-md bg-slate-200/60 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 tabular-nums">
                        {vol.chapter_count}章
                      </span>
                    </button>
                    {isExpanded && (
                      <ul className="mt-1 mb-0.5 ml-3 space-y-0.5 border-l-2 border-slate-200/80 pl-2.5">
                        {vol.chapters.map((ch) => {
                          const sel = selectedChapter?.sessionId === ch.session_id
                          const published = publishedSessionIds.has(ch.session_id)
                          return (
                            <li key={ch.session_id}>
                              <button
                                onClick={() => {
                                  const info = { volumeName: vol.volume_name, chapterNumber: ch.chapter_number, sessionId: ch.session_id, chapterTitle: ch.title, status: ch.status }
                                  setSelectedChapter(info)
                                  setActiveChapter(ch.session_id)
                                  setSessionId(ch.session_id)
                                  loadSelectedChapter(vol.volume_name, ch.chapter_number)
                                }}
                                className={cn(
                                  "w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-all",
                                  sel
                                    ? "bg-white text-orange-700 font-medium shadow-sm ring-1 ring-orange-200/80"
                                    : "text-slate-600 hover:bg-white/80 hover:text-slate-800"
                                )}
                              >
                                <span
                                  className={cn(
                                    "shrink-0 w-0.5 self-stretch rounded-full min-h-[14px]",
                                    sel ? "bg-orange-500" : "bg-transparent"
                                  )}
                                  aria-hidden
                                />
                                <span className="min-w-0 flex-1 truncate leading-snug">
                                  {ch.title
                                    ? `${formatChapterLabel(ch.chapter_number)} ${ch.title}`
                                    : formatChapterLabel(ch.chapter_number)}
                                </span>
                                <ChapterStatusBadge
                                  published={published}
                                  draftVersion={ch.draft_version}
                                />
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                )
              })
            ) : (
              <p className="px-3 py-8 text-center text-sm text-slate-400">暂无章节</p>
            )}
          </div>
        </section>

        {/* 右：章节内容 */}
        <section className="flex-1 bg-white flex flex-col min-w-0">
          <div className="h-11 px-4 border-b border-slate-200 bg-white flex items-center justify-between gap-3 shrink-0 min-w-0">
            {selectedChapter ? (
              <>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">
                    {selectedChapter.volumeName} {formatChapterLabel(selectedChapter.chapterNumber)}
                  </p>
                  {selectedChapter.chapterTitle ? (
                    <p className="text-[11px] text-slate-400 truncate mt-0.5">{selectedChapter.chapterTitle}</p>
                  ) : null}
                </div>
                {bookContentLoading ? (
                  <span className="shrink-0 flex items-center gap-1 text-[10px] font-medium text-slate-400">
                    <Loader2 size={11} className="animate-spin" />
                    加载中
                  </span>
                ) : selectedChapter ? (
                  <ChapterStatusBadge
                    published={publishedSessionIds.has(selectedChapter.sessionId)}
                    draftVersion={
                      bookInfo?.volumes
                        ?.flatMap((v) => v.chapters)
                        .find((c) => c.session_id === selectedChapter.sessionId)?.draft_version ?? 0
                    }
                  />
                ) : null}
              </>
            ) : (
              <p className="text-xs text-slate-400">选择章节查看正文</p>
            )}
          </div>
          <div className="flex-1 overflow-y-auto px-12 py-10 scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-transparent">
            {bookContentLoading ? (
              <div className="max-w-2xl mx-auto text-center pt-24">
                <Loader2 className="w-6 h-6 text-slate-300 animate-spin mx-auto mb-3" />
                <p className="text-slate-400 text-sm">加载章节内容...</p>
              </div>
            ) : bookContentError ? (
              <div className="max-w-2xl mx-auto text-center pt-24 px-4">
                <AlertCircle className="w-8 h-8 text-amber-400 mx-auto mb-3" />
                <p className="text-slate-600 text-sm">{bookContentError}</p>
              </div>
            ) : bookContent ? (
              <div className="max-w-2xl mx-auto text-sm text-slate-700 leading-relaxed">
                <p className="whitespace-pre-wrap">{bookContent}</p>
              </div>
            ) : (
              <div className="max-w-2xl mx-auto text-center pt-24">
                <p className="text-slate-300 text-sm">暂无内容</p>
              </div>
            )}
          </div>
        </section>
      </main>

      {/* ── 删除任务确认 Modal ── */}
      <Dialog open={showDeleteModal} onOpenChange={setShowDeleteModal}>
        <DialogContent
          className="max-w-sm p-0 gap-0 overflow-hidden sm:max-w-sm"
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <DialogHeader className="text-left px-6 pt-5 pb-0 space-y-0">
            <DialogTitle className="text-base">删除任务</DialogTitle>
          </DialogHeader>
          <div className="px-6 py-4">
            {novelName ? (
              <p className="text-sm font-medium text-slate-800 mb-2">《{novelName}》</p>
            ) : null}
            <DialogDescription className="text-sm text-slate-500 leading-relaxed">
              将中止当前任务流程，已生成内容不会删除
            </DialogDescription>
          </div>
          <DialogFooter className="flex-row gap-3 border-t border-slate-100 bg-slate-50/80 px-6 py-4 sm:justify-stretch">
            <button
              type="button"
              onClick={() => setShowDeleteModal(false)}
              disabled={deleting}
              className="flex-1 h-10 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="flex-1 h-10 rounded-lg bg-red-500 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-1.5"
            >
              {deleting ? <><Loader2 size={14} className="animate-spin" />处理中...</> : "确认"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 清空会话确认 Modal ── */}
      <Dialog open={showClearChatModal} onOpenChange={setShowClearChatModal}>
        <DialogContent
          className="max-w-sm p-0 gap-0 overflow-hidden sm:max-w-sm"
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <DialogHeader className="text-left px-6 pt-5 pb-0 space-y-0">
            <DialogTitle className="text-base">清空会话记录</DialogTitle>
          </DialogHeader>
          <div className="px-6 py-4">
            <DialogDescription className="text-sm text-slate-500 leading-relaxed">
              确认清空当前任务的 AI 会话记录？只会删除左侧聊天记录，不会影响右侧章节草稿。
            </DialogDescription>
          </div>
          <DialogFooter className="flex-row gap-3 border-t border-slate-100 bg-slate-50/80 px-6 py-4 sm:justify-stretch">
            <button
              type="button"
              onClick={() => setShowClearChatModal(false)}
              disabled={clearingChat}
              className="flex-1 h-10 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleClearChat}
              disabled={clearingChat}
              className="flex-1 h-10 rounded-lg bg-orange-500 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-1.5"
            >
              {clearingChat ? <><Loader2 size={14} className="animate-spin" />清空中...</> : "确认清空"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 发布 Modal ── */}
      <Dialog open={showPublishModal} onOpenChange={setShowPublishModal}>
        <DialogContent className="max-w-xl p-0 gap-0 overflow-hidden rounded-2xl" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogTitle className="sr-only">确认发布内容</DialogTitle>
          {/* Header */}
          <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
            <h2 className="text-xl font-bold text-slate-900">确认发布内容</h2>
          </div>

          {/* Body */}
          <div className="p-6 space-y-5">
            {(() => {
              const refChapter = publishModalData.hasPublished
                ? publishModalData.lastPublished
                : publishModalData.nextToPublish
              const refTitle = publishModalData.hasPublished ? "最近已发布" : "接下来应发布"
              const renderChapterLine = (
                ch: (typeof chapters)[number],
                badge: { text: string; className: string },
              ) => (
                <div
                  key={ch.sessionId}
                  className="flex items-center px-4 py-3 bg-slate-50/80"
                >
                  <span className="text-sm flex-1 leading-snug text-slate-800">
                    <span className="font-normal mr-1">{volumeName}</span>
                    <span className="font-normal">{ch.label}</span>
                    {ch.chapterTitle ? (
                      <span className="font-normal ml-1">：{ch.chapterTitle}</span>
                    ) : null}
                  </span>
                  <span className={cn("text-xs font-medium px-2 py-0.5 rounded shrink-0", badge.className)}>
                    {badge.text}
                  </span>
                </div>
              )
              return (
                <>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-700 mb-3">{refTitle}</h3>
                    <div className="border border-slate-200 rounded-lg overflow-hidden">
                      {refChapter ? (
                        renderChapterLine(
                          refChapter,
                          publishModalData.hasPublished
                            ? { text: "已发布", className: "text-emerald-600 bg-emerald-50" }
                            : { text: "本次发布", className: "text-orange-600 bg-orange-50" },
                        )
                      ) : (
                        <div className="px-4 py-6 text-center text-sm text-slate-400">暂无章节</div>
                      )}
                    </div>
                  </div>

                  {publishModalData.pendingPreview.length > 0 ? (
                    <div>
                      <h3 className="text-sm font-semibold text-slate-700 mb-3">
                        待发布章节
                        <span className="ml-2 text-xs font-normal text-slate-400">
                          （最多展示 5 章，按顺序发布）
                        </span>
                      </h3>
                      <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                        {publishModalData.pendingPreview.map((ch) => {
                          const isNext = publishModalData.nextToPublish?.sessionId === ch.sessionId
                          return (
                            <div
                              key={ch.sessionId}
                              className={cn(
                                "flex items-center px-4 py-3 select-none",
                                isNext ? "bg-orange-50/60" : "bg-white",
                              )}
                            >
                              <span className="text-sm flex-1 leading-snug text-slate-800">
                                <span className="font-normal mr-1">{volumeName}</span>
                                <span className="font-normal">{ch.label}</span>
                                {ch.chapterTitle ? (
                                  <span className="font-normal ml-1">：{ch.chapterTitle}</span>
                                ) : null}
                              </span>
                              <span
                                className={cn(
                                  "text-xs font-medium px-2 py-0.5 rounded shrink-0",
                                  isNext
                                    ? "text-orange-600 bg-orange-50"
                                    : "text-slate-500 bg-slate-100",
                                )}
                              >
                                {isNext ? "本次发布" : "排队中"}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ) : null}
                </>
              )
            })()}
            <p className="text-xs text-slate-500 flex items-center gap-1">
              <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              每次仅发布下一章，顺序固定，不可选择其他章节。
            </p>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-3">
            <button
              onClick={() => setShowPublishModal(false)}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
            >
              取消
            </button>
            <button
              onClick={handlePublish}
              disabled={!publishChapterId || publishState === "publishing"}
              className="px-6 py-2 text-sm font-medium text-white bg-gradient-to-r from-orange-500 to-red-500 rounded-lg hover:opacity-90 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {publishState === "publishing"
                ? <span className="flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" />发布中...</span>
                : "立即发布"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
