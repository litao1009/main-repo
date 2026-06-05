/** 会话区展示用：去掉章节正文，仅保留过程/状态说明 */

import { formatChapterLabel, formatVolumeLabel } from "@/lib/utils"

const CHAPTER_WRITTEN_ACTION_SUFFIX = "请点击章节列表查看正文。"

const CHAPTER_HEADING_LINE =
  /^(?:#{1,3}\s*)?(?:\*\*)?(?:第[0-9一二三四五六七八九十百千]+章|\*\*第[0-9一二三四五六七八九十百千]+章)/m

const SECTION_HEADING_LINE = /^##\s+[一二三四五六七八九十百千\d]+(?:\s|$)/m

const VOLUME_SECTION_LINE = /^#{1,3}\s*第[0-9一二三四五六七八九十百千]+[节部分]/m

const PROCESS_HINT =
  /已完成|已写入|概要|本章|风格|对应|写入|current_draft|草稿|章节信息|标题|指纹|落盘/

const COMPLETION_TAIL =
  /(?:已完成|已写入)[\s\S]{0,800}?(?:current_draft\.md|current_draft|草稿)[。.!！`]?/i

const DRAFT_FILE_RE = /`?current_draft(?:\.md)?`?/gi

const CHAPTER_COMPLETION_HINT =
  /(?:已完成|已写入|已写好|写入|完成).*(?:章|草稿)|(?:章|草稿).*(?:已完成|已写入|已写好|写入)/i

const ENGLISH_CHAPTER_RE = /chapter\s*(\d+)\b/i

const ENGLISH_PROCESS_RE =
  /\b(let me|i'll|i will|craft it|needs to continue|panoramic|deepening)\b/i

/** 与后端 draftWrittenNotice 对齐的用户向提示 */
export function formatChapterWrittenNotice(
  chapterNumber: number,
  title?: string,
  volumeName?: string,
): string {
  const vol = volumeName ? formatVolumeLabel(volumeName) : ""
  const label = formatChapterLabel(chapterNumber)
  const name = title?.trim()
  const head = vol ? `${vol}${label}` : label
  const titlePart = name ? `《${name}》` : ""
  return `${head}${titlePart}已写好，${CHAPTER_WRITTEN_ACTION_SUFFIX}`
}

function findChapterBodyStart(text: string): number {
  const hits: number[] = []
  const patterns = [
    CHAPTER_HEADING_LINE,
    SECTION_HEADING_LINE,
    VOLUME_SECTION_LINE,
    /^#{1,2}\s+[^\n#]{2,40}$/m,
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (m?.index != null) hits.push(m.index)
  }
  if (hits.length === 0) return -1
  return Math.min(...hits)
}

function looksLikeChapterBody(text: string): boolean {
  const t = text.trim()
  if (t.length < 280) return false
  if (findChapterBodyStart(t) >= 0) return true
  if (PROCESS_HINT.test(t.slice(0, 200))) return false
  const cn = (t.match(/[\u4e00-\u9fff]/g) || []).length
  return cn / t.length > 0.35 && t.length > 500
}

function extractProcessSummary(text: string): string {
  const completion = text.match(COMPLETION_TAIL)
  if (completion?.index != null) {
    const end = completion.index + completion[0].length
    const head = text.slice(0, end).trim()
    const tail = text.slice(end).trim()
    if (tail.length > 80 && !PROCESS_HINT.test(tail.slice(0, 100))) {
      return head
    }
  }

  const blocks = text.split(/\n\n+/)
  if (blocks.length >= 2) {
    const first = blocks[0].trim()
    const rest = blocks.slice(1).join("\n\n").trim()
    if (
      rest.length > 350 &&
      first.length < 700 &&
      (PROCESS_HINT.test(first) || first.length < 400)
    ) {
      return first
    }
  }

  if (text.length > 1200) {
    const lines = text.split("\n")
    const kept = lines.filter(
      (line) =>
        PROCESS_HINT.test(line) ||
        /^[\s]*[-*•]\s/.test(line) ||
        (line.trim().length > 0 && line.trim().length < 100),
    )
    const joined = kept.join("\n").trim()
    if (joined.length > 0 && joined.length < text.length * 0.45) {
      return joined
    }
  }

  return text
}

function isChapterDraftCompletionMessage(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (DRAFT_FILE_RE.test(t)) return true
  if (
    /的内容已写入草稿|章节内容已写入草稿|请点击章节列表查看正文|请在章节列表中查看|请在左侧章节列表查看/.test(
      t,
    )
  ) {
    return true
  }
  return CHAPTER_COMPLETION_HINT.test(t)
}

function parseChapterNumberFromToken(token: string): number | null {
  const digits = token.replace(/\s+/g, "")
  if (/^\d+$/.test(digits)) {
    const n = Number.parseInt(digits, 10)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  const m = digits.match(/^第?([0-9一二三四五六七八九十百千零两]+)章?$/)
  if (!m) return null
  const raw = m[1]
  if (/^\d+$/.test(raw)) return Number.parseInt(raw, 10)
  const map: Record<string, number> = {
    零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 两: 2,
  }
  if (raw === "十") return 10
  if (raw.startsWith("十") && raw.length === 2 && map[raw[1]] != null) return 10 + map[raw[1]]
  if (raw.endsWith("十") && raw.length === 2 && map[raw[0]] != null) return map[raw[0]] * 10
  if (raw.length === 3 && map[raw[0]] != null && raw[1] === "十" && map[raw[2]] != null) {
    return map[raw[0]] * 10 + map[raw[2]]
  }
  if (map[raw] != null) return map[raw]
  return null
}

/** 将 AI/后端的「写入 current_draft」类提示统一为用户文案 */
export function normalizeChapterCompletionForDisplay(text: string): string {
  const raw = text.trim()
  if (!raw || !isChapterDraftCompletionMessage(raw)) return raw

  const volumeChapterTitleMatch = raw.match(
    /(第[0-9一二三四五六七八九十百千零两\d]+卷)\s*(第[0-9一二三四五六七八九十百千零两\d]+章)\s*[《「]([^》」]+)[》」]/,
  )
  if (volumeChapterTitleMatch) {
    const num = parseChapterNumberFromToken(volumeChapterTitleMatch[2])
    const title = volumeChapterTitleMatch[3]?.trim()
    if (num != null) {
      return formatChapterWrittenNotice(
        num,
        title,
        formatVolumeLabel(volumeChapterTitleMatch[1]),
      )
    }
  }

  const chapterTitleMatch =
    raw.match(/第\s*([0-9一二三四五六七八九十百千零两\d]+)\s*章\s*[《「]([^》」]+)[》」]/) ||
    raw.match(/(第[0-9一二三四五六七八九十百千零两\d]+章)\s*《([^》]+)》/)
  if (chapterTitleMatch) {
    const num = parseChapterNumberFromToken(chapterTitleMatch[1])
    const title = chapterTitleMatch[2]?.trim()
    if (num != null) return formatChapterWrittenNotice(num, title)
    const label = chapterTitleMatch[1].replace(/\s+/g, "")
    const normalizedLabel = label.startsWith("第") ? label : `第${label}章`
    const titlePart = title ? `《${title}》` : ""
    return `${normalizedLabel}${titlePart}已写好，${CHAPTER_WRITTEN_ACTION_SUFFIX}`
  }

  const volumeChapterOnly = raw.match(
    /(第[0-9一二三四五六七八九十百千零两\d]+卷)\s*(第[0-9一二三四五六七八九十百千零两\d]+章)/,
  )
  if (volumeChapterOnly) {
    const num = parseChapterNumberFromToken(volumeChapterOnly[2])
    if (num != null) {
      return formatChapterWrittenNotice(
        num,
        undefined,
        formatVolumeLabel(volumeChapterOnly[1]),
      )
    }
  }

  const chapterOnly = raw.match(/第\s*([0-9一二三四五六七八九十百千零两\d]+)\s*章/)
  if (chapterOnly) {
    const num = parseChapterNumberFromToken(chapterOnly[1])
    if (num != null) return formatChapterWrittenNotice(num)
  }

  if (/章节内容已写入|的内容已写入草稿/.test(raw)) {
    return `章节已写好，${CHAPTER_WRITTEN_ACTION_SUFFIX}`
  }

  const stripped = raw
    .replace(DRAFT_FILE_RE, "")
    .replace(/`+/g, "")
    .replace(/\s+/g, " ")
    .trim()
  if (/章/.test(stripped)) {
    const normalized = stripped
      .replace(/已写入|写入/g, "已写好")
      .replace(/已完成/g, "已写好")
      .replace(/完成[。.!！]?\s*/, "")
      .replace(/请在章节列表中查看[。.!！]?/g, "")
      .replace(/请在左侧章节列表查看[。.!！]?/g, "")
    return normalized.includes("点击查看") || normalized.includes(CHAPTER_WRITTEN_ACTION_SUFFIX)
      ? normalized.endsWith("。") ? normalized : `${normalized}。`
      : `${normalized}，${CHAPTER_WRITTEN_ACTION_SUFFIX}`
  }

  return `章节已写好，${CHAPTER_WRITTEN_ACTION_SUFFIX}`
}

/** AI 用英文写的落盘/构思旁白，不应原样展示 */
function isEnglishProcessNarration(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  const han = (t.match(/[\u4e00-\u9fff]/g) || []).length
  if (han >= 4) return false
  if (ENGLISH_CHAPTER_RE.test(t)) return true
  return ENGLISH_PROCESS_RE.test(t)
}

function normalizeEnglishProcessNarration(text: string): string {
  const m = text.match(ENGLISH_CHAPTER_RE)
  if (m) {
    const n = Number.parseInt(m[1], 10)
    if (Number.isFinite(n) && n > 0) {
      return formatChapterWrittenNotice(n)
    }
  }
  return `正在撰写章节，完成后${CHAPTER_WRITTEN_ACTION_SUFFIX}`
}

/** 会话区 system 角色：后台错误转中文提示 */
export function formatChatSystemMessage(text: string): string {
  const t = text.trim()
  if (!t) return t
  const lower = t.toLowerCase()

  if (
    lower.includes("opencode exited") ||
    lower.includes("exit status") ||
    lower.includes("failed to start opencode") ||
    lower.includes("start failed")
  ) {
    return "AI 创作进程异常退出，请稍后重试。"
  }
  if (lower.includes("process timeout") || lower.includes("timeout or cancelled")) {
    return "AI 处理超时，请稍后重试。"
  }
  if (lower.includes("server busy")) {
    return "服务繁忙，请稍后再试。"
  }
  if (lower.includes("stdout pipe") || lower.includes("stderr pipe")) {
    return "AI 服务连接异常，请稍后重试。"
  }

  const han = (t.match(/[\u4e00-\u9fff]/g) || []).length
  if (
    han < 2 &&
    /\b(error|failed|exit|timeout|opencode)\b/i.test(t)
  ) {
    return "AI 服务异常，请稍后重试。若反复出现请联系管理员。"
  }

  return t
}

export type ChapterNoticeContext = {
  volumeName?: string
  chapterTitle?: string
  chapterNumber?: number
}

/** 用 book/info 等元数据补全「已写好」提示中的卷名、书名 */
export function applyChapterNoticeContext(
  display: string,
  ctx?: ChapterNoticeContext,
): string {
  if (!ctx || !isChapterDraftCompletionMessage(display)) return display
  const vol = ctx.volumeName?.trim()
  const title = ctx.chapterTitle?.trim()
  const num = ctx.chapterNumber
  if (!vol && !title && (num == null || num <= 0)) return display
  if (/第.+卷/.test(display) && /《[^》]+》/.test(display)) return display
  let chapterNo = num
  if (chapterNo == null || chapterNo <= 0) {
    const m = display.match(/第[0-9一二三四五六七八九十百千零两\d]+章/)
    if (m) chapterNo = parseChapterNumberFromToken(m[0]) ?? undefined
  }
  if (chapterNo == null || chapterNo <= 0) return display
  return formatChapterWrittenNotice(chapterNo, title, vol)
}

export function chatDisplayText(full: string, noticeCtx?: ChapterNoticeContext): string {
  let text = full.trim()
  if (!text) return ""

  const finishNotice = (result: string) =>
    applyChapterNoticeContext(
      isEnglishProcessNarration(result) ? normalizeEnglishProcessNarration(result) : result,
      noticeCtx,
    )

  // 短提示（如「第一卷第八章《深部对话》已写好…」）含「第N章」字样，勿当作正文起始而截空
  if (isChapterDraftCompletionMessage(text)) {
    return finishNotice(normalizeChapterCompletionForDisplay(text))
  }

  const idx = findChapterBodyStart(text)
  if (idx >= 0) {
    let summary = normalizeChapterCompletionForDisplay(text.slice(0, idx).trim())
    if (looksLikeLeakedChapterExcerpt(summary)) {
      return finishNotice(`章节已写好，${CHAPTER_WRITTEN_ACTION_SUFFIX}`)
    }
    return finishNotice(summary)
  }

  text = extractProcessSummary(text)

  if (looksLikeChapterBody(text)) {
    return ""
  }

  let result = normalizeChapterCompletionForDisplay(text.trim())
  if (looksLikeLeakedChapterExcerpt(result)) {
    return finishNotice(`章节已写好，${CHAPTER_WRITTEN_ACTION_SUFFIX}`)
  }
  return finishNotice(result)
}

/** 历史消息：正文片段已落盘但未被后端转成「已写好」提示 */
function looksLikeLeakedChapterExcerpt(text: string): boolean {
  const t = text.trim()
  if (t.length < 120) return false
  if (/已写好|请点击章节列表查看正文|请在章节列表|已写入草稿|的内容已写入/.test(t)) return false
  if (isChapterDraftCompletionMessage(t)) return false
  if (isEnglishProcessNarration(t)) return false
  const han = (t.match(/[\u4e00-\u9fff]/g) || []).length
  if (han / t.length < 0.35) return false
  if (PROCESS_HINT.test(t.slice(0, 100))) return false
  return true
}
