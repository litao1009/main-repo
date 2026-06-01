/** 会话区展示用：去掉章节正文，仅保留过程/状态说明 */

const CHAPTER_HEADING_LINE =
  /^(?:#{1,3}\s*)?(?:\*\*)?(?:第[0-9一二三四五六七八九十百千]+章|\*\*第[0-9一二三四五六七八九十百千]+章)/m

const SECTION_HEADING_LINE = /^##\s+[一二三四五六七八九十百千\d]+(?:\s|$)/m

const VOLUME_SECTION_LINE = /^#{1,3}\s*第[0-9一二三四五六七八九十百千]+[节部分]/m

const PROCESS_HINT =
  /已完成|已写入|概要|本章|风格|对应|写入|current_draft|草稿|章节信息|标题|指纹|落盘/

const COMPLETION_TAIL =
  /(?:已完成|已写入)[\s\S]{0,800}?(?:current_draft\.md|current_draft|草稿)[。.!！`]?/i

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

export function chatDisplayText(full: string): string {
  let text = full.trim()
  if (!text) return ""

  const idx = findChapterBodyStart(text)
  if (idx >= 0) {
    const summary = text.slice(0, idx).trim()
    return summary
  }

  text = extractProcessSummary(text)

  if (looksLikeChapterBody(text)) {
    return ""
  }

  return text.trim()
}
