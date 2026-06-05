import { toast } from "sonner"
import { CheckCircle2 } from "lucide-react"
import type { BookChapter, BookInfoResponse } from "@/types"
import { formatChapterLabel, formatVolumeLabel } from "@/lib/utils"

/** 收集当前 book/info 中所有章节的 session_id */
export function collectChapterSessionIds(info: BookInfoResponse | null): Set<string> {
  const ids = new Set<string>()
  if (!info?.volumes) return ids
  for (const vol of info.volumes) {
    for (const ch of vol.chapters) {
      if (ch.session_id) ids.add(ch.session_id)
    }
  }
  return ids
}

export type NewBookChapter = { chapter: BookChapter; volumeName: string }

/** 相对已知集合，返回本轮新出现的章节（按章号排序） */
export function findNewChapters(knownIds: Set<string>, info: BookInfoResponse): NewBookChapter[] {
  const added: NewBookChapter[] = []
  for (const vol of info.volumes ?? []) {
    const volumeName = vol.volume_name?.trim() ?? ""
    for (const ch of vol.chapters) {
      if (ch.session_id && !knownIds.has(ch.session_id)) {
        added.push({ chapter: ch, volumeName })
      }
    }
  }
  added.sort((a, b) => a.chapter.chapter_number - b.chapter.chapter_number)
  return added
}

function chapterReadyMessage(ch: BookChapter, volumeName?: string): string {
  const vol = volumeName ? formatVolumeLabel(volumeName) : ""
  const label = formatChapterLabel(ch.chapter_number)
  const head = vol ? `${vol}${label}` : label
  const title = ch.title?.trim()
  if (title) return `${head}《${title}》创作完成`
  return `${head}创作完成`
}

/** 章节就绪提示：白底细边框，与任务详情会话区风格一致 */
export function toastChapterReady(ch: BookChapter, volumeName?: string) {
  const message = chapterReadyMessage(ch, volumeName)
  toast.custom(
    () => (
      <div
        role="status"
        className="flex w-full max-w-sm items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" strokeWidth={2.25} />
        </div>
        <p className="min-w-0 flex-1 text-sm font-medium leading-snug text-slate-700">
          {message}
        </p>
      </div>
    ),
    {
      duration: 5500,
      unstyled: true,
    },
  )
}

/**
 * 对比并提示新章节。首次调用只建立基线，不弹 toast。
 * @returns 更新后的已知 session_id 集合
 */
export function notifyNewChaptersIfAny(
  knownIds: Set<string>,
  info: BookInfoResponse,
  seeded: boolean,
): { nextKnown: Set<string>; nextSeeded: boolean } {
  const current = collectChapterSessionIds(info)
  if (!seeded) {
    return { nextKnown: current, nextSeeded: true }
  }
  const added = findNewChapters(knownIds, info)
  for (const { chapter, volumeName } of added) {
    toastChapterReady(chapter, volumeName)
  }
  return { nextKnown: current, nextSeeded: true }
}
