"use client"

import {
  sanitizeBookBodyForDisplay,
  splitBookBodyParagraphs,
} from "@/lib/book-content-display"
import { cn } from "@/lib/utils"

type BookChapterContentProps = {
  content: string
  className?: string
}

/** 章节正文：纯文本分段展示（不解析 Markdown，避免样式错乱） */
export function BookChapterContent({ content, className }: BookChapterContentProps) {
  const sanitized = sanitizeBookBodyForDisplay(content)
  const paragraphs = splitBookBodyParagraphs(sanitized)

  if (paragraphs.length === 0) {
    return <p className="text-[15px] text-slate-400">暂无内容</p>
  }

  return (
    <article
      className={cn(
        "book-chapter-content text-[15px] text-slate-700 leading-[1.85]",
        className,
      )}
    >
      {paragraphs.map((paragraph, index) => (
        <p
          key={index}
          className="mb-4 text-justify indent-[2em] text-slate-700 last:mb-0"
        >
          {paragraph}
        </p>
      ))}
    </article>
  )
}
