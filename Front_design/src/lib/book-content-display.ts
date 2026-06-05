/** 正文开头的「# 第N章」行 */
const CHAPTER_HEADING_LINE_RE = /^#\s*第\s*[\d一二三四五六七八九十百千零两]+章\s*$/u

/** 行内章节标题：「**第15章 归于大海**」「第15章 归于大海」（无 #） */
const INLINE_CHAPTER_TITLE_LINE_RE =
  /^\*{0,2}\s*第\s*[\d一二三四五六七八九十百千零两]+章\s+(.+?)\s*\*{0,2}\s*$/u

/** 正文开头的任意「# 标题」行（捕获标题文本） */
const TITLE_HEADING_LINE_RE = /^#\s+(.+?)\s*$/u

function extractTitleFromInlineChapterLine(line: string): string | null {
  const trimmed = line.trim()
  const m = trimmed.match(INLINE_CHAPTER_TITLE_LINE_RE)
  return m?.[1]?.trim() || null
}

function isInlineChapterTitleLine(line: string): boolean {
  return INLINE_CHAPTER_TITLE_LINE_RE.test(line.trim())
}

/** Markdown 分隔线（--- / *** / ___），渲染后会变成横线 */
const MARKDOWN_RULE_LINE_RE = /^(\*{3,}|-{3,}|_{3,})\s*$/u

/** 单独占一行的破折号（AI 偶发输出） */
const LONE_DASH_LINE_RE = /^[—\-–―﹣－]+\s*$/u

/** ## 一、## （一）、## 第一节 等节标题，非正文 */
const SECTION_DIVIDER_HEADING_RE =
  /^#{2,3}\s*(?:[第]?\s*[一二三四五六七八九十百千零两\d]+[、.．]?\s*|[（(]\s*[一二三四五六七八九十百千零两\d]+\s*[)）]\s*)$/u

function isSectionDividerHeading(line: string): boolean {
  const trimmed = line.trim()
  if (!/^#{2,3}\s+/.test(trimmed)) return false
  if (SECTION_DIVIDER_HEADING_RE.test(trimmed)) return true
  const inner = trimmed.replace(/^#{2,3}\s+/, "").trim()
  if (inner.length === 0 || inner.length > 20) return false
  if (/[。！？；，、]/.test(inner)) return false
  return true
}

/** 单独成行的「二」「三」「四」或「二、」（无 ## 的节次标记） */
function isPlainStandaloneSectionMarker(line: string): boolean {
  const t = line.trim()
  if (!t || /^#{1,6}\s/.test(t)) return false
  if (/[。！？；，]/.test(t)) return false
  if (
    /^(?:第\s*)?[一二三四五六七八九十百千零两\d]{1,4}[、.．]?\s*$/.test(t) ||
    /^[（(]\s*[一二三四五六七八九十百千零两\d]{1,4}\s*[)）][、.．]?\s*$/.test(t)
  ) {
    return true
  }
  return false
}

/** 非叙事正文：分隔线、节次标记、重复标题等 */
function isNonNarrativeMarkerLine(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return false
  if (MARKDOWN_RULE_LINE_RE.test(trimmed) || LONE_DASH_LINE_RE.test(trimmed)) return true
  if (isSectionDividerHeading(trimmed) || isDuplicateChapterTitleHeading(trimmed)) return true
  if (isPlainStandaloneSectionMarker(trimmed)) return true
  return false
}

function collapseExtraBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trim()
}

/** 正文开头重复的 # 章节名（非「第N章」行） */
function isDuplicateChapterTitleHeading(line: string): boolean {
  const trimmed = line.trim()
  if (isInlineChapterTitleLine(trimmed)) return true
  if (!/^#\s+/.test(trimmed) || CHAPTER_HEADING_LINE_RE.test(trimmed)) return false
  return TITLE_HEADING_LINE_RE.test(trimmed)
}

function skipLeadingNonNarrativeLines(lines: string[], start: number): number {
  let i = start
  while (i < lines.length) {
    const trimmed = lines[i].trim()
    if (trimmed === "") {
      i++
      continue
    }
    if (isNonNarrativeMarkerLine(trimmed)) {
      i++
      continue
    }
    break
  }
  return i
}

export type BookContentLeadingParts = {
  chapterLine: string | null
  titleLine: string | null
  /** 从「# 章节名」行解析出的标题（不含 #） */
  extractedTitle: string | null
  body: string
}

/**
 * 拆分正文开头的 Markdown 章节号行 / 章节标题行与正文。
 */
export function splitBookContentLeading(content: string): BookContentLeadingParts {
  const lines = content.split("\n")
  let i = 0

  while (i < lines.length && lines[i].trim() === "") i++

  let chapterLine: string | null = null
  if (i < lines.length && CHAPTER_HEADING_LINE_RE.test(lines[i].trim())) {
    chapterLine = lines[i]
    i++
    while (i < lines.length && lines[i].trim() === "") i++
  }

  let titleLine: string | null = null
  let extractedTitle: string | null = null
  if (i < lines.length) {
    const trimmed = lines[i].trim()
    const inlineTitle = extractTitleFromInlineChapterLine(trimmed)
    if (inlineTitle) {
      titleLine = lines[i]
      extractedTitle = inlineTitle
      i++
    } else {
      const match = trimmed.match(TITLE_HEADING_LINE_RE)
      if (match && !CHAPTER_HEADING_LINE_RE.test(trimmed)) {
        titleLine = lines[i]
        extractedTitle = match[1].trim()
        i++
      }
    }
  }

  i = skipLeadingNonNarrativeLines(lines, i)

  return {
    chapterLine,
    titleLine,
    extractedTitle,
    body: lines.slice(i).join("\n"),
  }
}

export type BuildDisplayBookContentOptions = {
  /** 顶栏已展示卷章时，去掉正文开头的「# 第N章」 */
  stripChapterLine: boolean
  /** 顶栏已展示章节名时，去掉正文开头的「# 章节名」 */
  stripTitleLine: boolean
}

/** 根据顶栏状态决定正文展示用 Markdown（去掉与顶栏重复的开头标题行） */
export function buildDisplayBookContent(
  content: string,
  opts: BuildDisplayBookContentOptions,
): string {
  const parts = splitBookContentLeading(content)
  const blocks: string[] = []

  if (!opts.stripChapterLine && parts.chapterLine) {
    blocks.push(parts.chapterLine)
  }
  if (!opts.stripTitleLine && parts.titleLine) {
    blocks.push(parts.titleLine)
  }

  const merged = blocks.length === 0 ? parts.body : `${blocks.join("\n")}\n\n${parts.body}`
  return sanitizeBookBodyForDisplay(merged)
}

/** 全文去掉节次标记行（二/三/四、## 一、--- 等），仅保留叙事段落 */
export function sanitizeBookBodyForDisplay(content: string): string {
  const filtered = content
    .split("\n")
    .filter((line) => !isNonNarrativeMarkerLine(line))
    .join("\n")
  return collapseExtraBlankLines(filtered)
}

/** @deprecated 使用 sanitizeBookBodyForDisplay */
export function stripLeadingDecorativeMarkdown(content: string): string {
  return sanitizeBookBodyForDisplay(content)
}

/**
 * 按空行分段；段内单换行合并为连续正文（网文常见「一句一行」）。
 */
export function splitBookBodyParagraphs(content: string): string[] {
  if (!content.trim()) return []
  return content
    .split(/\n\s*\n/)
    .map((block) => block.replace(/\s*\n\s*/g, "").trim())
    .filter((block) => block.length > 0)
}

/** 顶栏章节名：元数据优先，否则取正文首个「# 标题」 */
export function resolveHeaderChapterTitle(
  metaTitle: string | undefined,
  content: string,
): string {
  const fromMeta = metaTitle?.trim() ?? ""
  if (fromMeta) return fromMeta
  if (!content.trim()) return ""
  return splitBookContentLeading(content).extractedTitle ?? ""
}
