"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { Textarea } from "@/components/ui/input"
import { Select as SelectRadix, SelectItem } from "@/components/ui/select"
import { fetchModels, fetchAccounts, createTask, createSession, allocSkill } from "@/lib/api"
import type { Model, AccountSummary, AllocSkillItem } from "@/types"
import { Loader2 } from "lucide-react"
import { toast } from "@/components/ui/toast"
import { TAG_CATEGORIES, buildPrompt } from "@/lib/tags"
import type { TagItem, TagCategoryKey } from "@/lib/tags"
import { cn } from "@/lib/utils"
import { buildTaskDetailHref } from "@/lib/task-navigation"

type SelectedTags = Record<TagCategoryKey, TagItem[]>
function getEmptySelection(): SelectedTags { return { main: [], theme: [], role: [], plot: [] } }

const PLATFORM_OPTS = [
  { value: "fanqie",  label: "番茄小说", bg: "bg-red-50",  text: "text-red-500",  char: "番" },
  { value: "zhulang", label: "逐浪网",   bg: "bg-blue-50", text: "text-blue-500", char: "逐" },
]

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || ""
function coverUrl(path: string): string {
  return `${API_BASE}${path}`
}

function FieldHeader({ label, required, hint }: { label: string; required?: boolean; hint?: string }) {
  return (
    <div className="flex items-center mb-3 gap-2">
      <label className="text-sm font-medium text-slate-700">
        {label} {required && <span className="text-orange-500">*</span>}
      </label>
      {hint && <span className="text-xs text-slate-400">· {hint}</span>}
    </div>
  )
}

function parseCategoryTags(category: string): string[] {
  return category
    .split(/[/／|]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 封面固定高度，避免 3:4 通栏把卡片拉得过高、行间参差不齐 */
const SKILL_COVER_H = "h-[200px]"
const SKILL_CARD_GRID =
  "grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5"

function SkillCoverImage({ src, alt }: { src: string; alt: string }) {
  const imgRef = useRef<HTMLImageElement>(null)
  const [phase, setPhase] = useState<"loading" | "loaded" | "error">("loading")

  useEffect(() => {
    setPhase("loading")
    const img = imgRef.current
    if (img?.complete && img.naturalWidth > 0) {
      setPhase("loaded")
    }
  }, [src])

  return (
    <>
      <div
        className={cn(
          "absolute inset-0 bg-slate-200 transition-opacity duration-500 ease-out",
          phase === "loaded" ? "opacity-0 pointer-events-none" : "opacity-100",
        )}
        aria-hidden
      >
        <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-slate-100 via-slate-200/90 to-slate-100" />
      </div>
      {phase !== "error" && (
        <img
          key={src}
          ref={imgRef}
          src={src}
          alt={alt}
          decoding="async"
          className={cn(
            "absolute inset-0 h-full w-full object-cover object-center transition-opacity duration-500 ease-out",
            phase === "loaded" ? "opacity-100" : "opacity-0",
          )}
          onLoad={() => setPhase("loaded")}
          onError={() => setPhase("error")}
        />
      )}
    </>
  )
}

function SkillCardSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white animate-pulse">
      <div className={cn(SKILL_COVER_H, "w-full shrink-0 bg-slate-200")} />
      <div className="space-y-2 p-3">
        <div className="h-9 bg-slate-200 rounded w-[90%]" />
        <div className="h-5 w-24 bg-slate-100 rounded" />
        <div className="h-8 space-y-1">
          <div className="h-3 bg-slate-100 rounded w-full" />
          <div className="h-3 bg-slate-100 rounded w-[85%]" />
        </div>
      </div>
    </div>
  )
}

function SkillSelectCard({
  skill,
  selected,
  onToggle,
}: {
  skill: AllocSkillItem
  selected: boolean
  onToggle: () => void
}) {
  const tags = parseCategoryTags(skill.category)
  const visibleTags = tags.slice(0, 2)
  const extraTagCount = tags.length - visibleTags.length

  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "group flex flex-col overflow-hidden rounded-lg border-2 bg-white text-left transition-all",
        selected
          ? "border-orange-500 shadow-sm"
          : "border-slate-200 hover:border-slate-300 hover:shadow-sm",
      )}
    >
      <div className={cn("relative w-full shrink-0 overflow-hidden bg-slate-100", SKILL_COVER_H)}>
        <SkillCoverImage src={coverUrl(skill.cover_image)} alt={skill.name} />
        {selected && (
          <span className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-orange-500 shadow ring-2 ring-white">
            <svg className="h-3 w-3" fill="none" stroke="white" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </span>
        )}
      </div>

      <div className="p-3">
        <h3
          className="h-9 text-sm font-semibold leading-[18px] text-slate-900 line-clamp-2"
          title={skill.name}
        >
          {skill.name}
        </h3>

        <div className="mt-1.5 flex h-5 items-center gap-1 overflow-hidden">
          {visibleTags.length > 0 ? (
            visibleTags.map((tag) => (
              <span
                key={tag}
                className="shrink-0 max-w-[46%] truncate rounded px-1.5 py-0.5 text-[10px] text-slate-600 bg-slate-100"
                title={tag}
              >
                {tag}
              </span>
            ))
          ) : (
            <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-slate-400 bg-slate-100">
              未分类
            </span>
          )}
          {extraTagCount > 0 && (
            <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-slate-400 bg-slate-50">
              +{extraTagCount}
            </span>
          )}
        </div>

        <p
          className="mt-2 h-8 text-[11px] leading-4 text-slate-500 line-clamp-2"
          title={skill.description}
        >
          {skill.description || "暂无简介"}
        </p>
      </div>
    </button>
  )
}

export default function NewTaskPage() {
  const router = useRouter()
  const [models, setModels] = useState<Model[]>([])
  const [accounts, setAccounts] = useState<AccountSummary[]>([])
  const [skills, setSkills] = useState<AllocSkillItem[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const creatingLock = useRef(false)

  const [topic, setTopic] = useState("")
  const [platform, setPlatform] = useState("fanqie")
  const [modelId, setModelId] = useState("")
  const [selectedAccountId, setSelectedAccountId] = useState("")
  const [selectedSkillId, setSelectedSkillId] = useState("")
  const [accountLoading, setAccountLoading] = useState(false)
  const [skillsLoading, setSkillsLoading] = useState(false)
  const [isAuto, setIsAuto] = useState(true)
  const [selectedTags, setSelectedTags] = useState<SelectedTags>(getEmptySelection())
  const [collapsedCats, setCollapsedCats] = useState<Record<string, boolean>>({ main: true, theme: true, role: true, plot: true })

  useEffect(() => {
    setLoading(true)
    fetchModels()
      .then(m => {
        setModels(m)
        if (m.length > 0) {
          const flashModel = m.find(model => model.id === "deepseek/deepseek-v4-flash")
          setModelId(flashModel ? flashModel.id : m[0].id)
        }
      })
      .catch(() => toast.error("加载资源失败，请确认后端服务已启动"))
      .finally(() => setLoading(false))
  }, [])

  const lastFetchedPlatform = useRef("")

  /** 切换平台时同步清空，避免 useEffect 前一帧仍显示旧账号与选中边框 */
  const resetPlatformDependentState = useCallback(() => {
    setSelectedAccountId("")
    setSelectedSkillId("")
    setAccounts([])
    setSkills([])
    setAccountLoading(true)
    setSkillsLoading(true)
  }, [])

  useEffect(() => {
    if (lastFetchedPlatform.current === platform) return
    lastFetchedPlatform.current = platform
    resetPlatformDependentState()
    fetchAccounts(platform)
      .then(accs => setAccounts(Array.isArray(accs) ? accs : []))
      .catch(() => setAccounts([]))
      .finally(() => setAccountLoading(false))
    allocSkill({ platform })
      .then(s => setSkills(s))
      .catch(() => toast.error("加载创作方案失败"))
      .finally(() => setSkillsLoading(false))
  }, [platform, resetPlatformDependentState])

  const handleToggleTag = useCallback((catKey: TagCategoryKey, tag: TagItem) => {
    setSelectedTags(prev => {
      const cat = TAG_CATEGORIES.find(c => c.key === catKey)!
      const current = prev[catKey]
      const isSelected = current.some(t => t.id === tag.id)
      if (isSelected) return { ...prev, [catKey]: current.filter(t => t.id !== tag.id) }
      if (current.length >= cat.maxSelect) {
        if (cat.maxSelect === 1) return { ...prev, [catKey]: [tag] }
        return prev
      }
      return { ...prev, [catKey]: [...current, tag] }
    })
  }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    if (!selectedAccountId) { toast.error("请选择发布账号"); return }
    if (!selectedSkillId) { toast.error("请选择创作方案"); return }
    setConfirmOpen(true)
  }

  const renderTagGrid = (catKey: TagCategoryKey) => {
    const cat = TAG_CATEGORIES.find(c => c.key === catKey)!
    const COLS = 6
    const SHOW = COLS * 2
    const collapsed = collapsedCats[catKey]
    const visibleItems = collapsed ? cat.items.slice(0, SHOW) : cat.items
    const canExpand = cat.items.length > SHOW

    return (
      <>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
          {visibleItems.map(tag => {
            const sel = selectedTags[catKey].some(t => t.id === tag.id)
            const maxed = !sel && selectedTags[catKey].length >= cat.maxSelect
            return (
              <button
                key={tag.id} type="button"
                disabled={maxed}
                onClick={() => handleToggleTag(catKey, tag)}
                className={cn(
                  "px-3 py-2.5 rounded-xl border text-sm text-center transition-all",
                  sel && "border-orange-400 bg-orange-50 text-orange-700 font-medium",
                  !sel && !maxed && "border-slate-200 bg-white text-slate-600 hover:border-orange-300",
                  maxed && "border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed"
                )}
              >
                {tag.name}
              </button>
            )
          })}
        </div>
        {canExpand && (
          <button
            type="button"
            onClick={() => setCollapsedCats(prev => ({ ...prev, [catKey]: !prev[catKey] }))}
            className="mt-2.5 text-xs text-slate-400 hover:text-orange-500 flex items-center gap-1 transition-colors ml-auto"
          >
            {collapsed ? (
              <>展开全部 {cat.items.length} 项
                <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2}><path d="M2 4l4 4 4-4"/></svg>
              </>
            ) : (
              <>收起
                <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2}><path d="M2 8l4-4 4 4"/></svg>
              </>
            )}
          </button>
        )}
      </>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
      </div>
    )
  }

  return (
    <>
    <div className="mx-auto max-w-5xl pb-24">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">新建创作任务</h1>
        <p className="text-slate-500 mt-2 text-sm">选择平台、账号和创作方案，AI 将为你量身定制创作内容。</p>
      </header>

      <form id="new-task-form" onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 space-y-7">

        {/* 发布平台 */}
        <div>
          <FieldHeader label="发布平台" required hint="单选" />
          <div className="grid grid-cols-5 gap-3">
            {PLATFORM_OPTS.map(opt => {
              const sel = platform === opt.value
              return (
                <button
                  key={opt.value} type="button"
                  onClick={() => {
                    if (opt.value === platform) return
                    resetPlatformDependentState()
                    setPlatform(opt.value)
                  }}
                  className={cn(
                    "relative flex flex-col items-center justify-center gap-2 py-5 rounded-xl border-2 transition-all",
                    sel ? "border-orange-400 bg-orange-50" : "border-slate-200 bg-white hover:border-orange-300"
                  )}
                >
                  {sel && (
                    <span className="absolute -top-2 -right-2 w-5 h-5 bg-orange-500 rounded-full flex items-center justify-center shadow-sm">
                      <svg className="w-3 h-3" fill="none" stroke="white" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/>
                      </svg>
                    </span>
                  )}
                  <div className={cn("w-10 h-10 rounded-full flex items-center justify-center font-bold text-base", opt.bg, opt.text)}>
                    {opt.char}
                  </div>
                  <span className={cn("text-sm font-medium", sel ? "text-orange-700" : "text-slate-700")}>
                    {opt.label}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* 发布账号 */}
        <div>
          <FieldHeader label="发布账号" required hint="单选" />
          <div className="min-h-9">
            {accountLoading ? (
              <div className="flex h-9 items-center gap-2 text-sm text-slate-400">
                <Loader2 size={14} className="animate-spin shrink-0 text-orange-500" />
                <span>加载中...</span>
              </div>
            ) : accounts.length === 0 ? (
              <p className="flex h-9 items-center text-sm text-slate-400">
                该平台暂无绑定账号，请先到
                <a href="/accounts" className="text-orange-500 underline mx-1">账号配置</a>
                绑定
              </p>
            ) : (
              <div className="flex flex-wrap gap-2.5">
                {accounts.map(acc => {
                  const sel = selectedAccountId === acc.account_id
                  return (
                    <button
                      key={acc.account_id} type="button"
                      onClick={() => setSelectedAccountId(acc.account_id)}
                      className={cn(
                        "inline-flex h-9 items-center gap-2 px-4 rounded-lg border text-sm transition-all",
                        sel
                          ? "border-orange-400 bg-orange-50 text-orange-700 font-medium"
                          : "border-slate-200 bg-white text-slate-600 hover:border-orange-300"
                      )}
                    >
                      {sel && (
                        <span className="w-3.5 h-3.5 rounded-full bg-orange-500 flex items-center justify-center flex-shrink-0">
                          <svg className="w-2" fill="none" stroke="white" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/>
                          </svg>
                        </span>
                      )}
                      {acc.masked_display}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* AI 模型 + 全自动创作 */}
        <div className="flex items-start gap-6">
          <div className="flex-1 max-w-xs">
            <label className="block text-sm font-medium text-slate-700 mb-2">
                   AI 模型 <span className="text-orange-500">*</span>
            </label>
            <SelectRadix value={modelId} onValueChange={setModelId} className="h-12 px-4 text-sm">
              {models.map(m => (
                <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
              ))}
            </SelectRadix>
          </div>
          <div className="flex items-center justify-between h-12 px-4 rounded-xl bg-slate-50 border border-slate-200 w-64 mt-[28px]">
            <div className="text-sm font-medium text-slate-700">全自动创作</div>
            <button
              type="button"
              role="switch"
              aria-checked={isAuto}
              onClick={() => { if (!isAuto) { setIsAuto(true) } else { toast.error("手动模式开发中") } }}
              className={cn(
                "relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors",
                isAuto ? "bg-orange-500" : "bg-slate-300"
              )}
            >
              <span className={cn(
                "inline-block h-4 w-4 rounded-full bg-white transition-transform shadow-sm",
                isAuto ? "translate-x-6" : "translate-x-1"
              )} />
            </button>
          </div>
        </div>

        {/* 创作方案 */}
        <div>
          <FieldHeader label="创作小说" required hint="单选" />
          {skillsLoading ? (
            <div className={SKILL_CARD_GRID}>
              <SkillCardSkeleton />
              <SkillCardSkeleton />
              <SkillCardSkeleton />
              <SkillCardSkeleton />
              <SkillCardSkeleton />
            </div>
          ) : skills.length === 0 ? (
            <p className="flex h-9 items-center text-sm text-slate-400">该平台暂无可用创作方案</p>
          ) : (
            <div className={SKILL_CARD_GRID}>
              {skills.map((skill) => (
                <SkillSelectCard
                  key={skill.skill_id}
                  skill={skill}
                  selected={selectedSkillId === skill.skill_id}
                  onToggle={() => setSelectedSkillId(
                    selectedSkillId === skill.skill_id ? "" : skill.skill_id,
                  )}
                />
              ))}
            </div>
          )}
        </div>

        {/* 分类标签 / 作品描述 */}
        {!isAuto && (
          <div className="space-y-6 p-5 rounded-xl bg-slate-50/60 border border-slate-100">
            <div>
              <FieldHeader label="主分类" hint="单选" />
              {renderTagGrid("main")}
            </div>
            <div>
              <FieldHeader label="主题风格" hint="最多选 2 项" />
              {renderTagGrid("theme")}
            </div>
            <div>
              <FieldHeader label="角色设定" hint="最多选 2 项" />
              {renderTagGrid("role")}
            </div>
            <div>
              <FieldHeader label="情节走向" hint="最多选 2 项" />
              {renderTagGrid("plot")}
            </div>
            <div>
              <FieldHeader label="作品描述" hint="选填" />
              <Textarea
                value={topic}
                onChange={e => setTopic(e.target.value)}
                placeholder="可输入补充描述，帮助 AI 更精准地创作..."
                rows={3}
                maxLength={500}
                className="bg-white"
              />
              <p className="text-xs text-slate-400 mt-1.5 text-right">{topic.length}/500</p>
            </div>
          </div>
        )}

      </form>
    </div>

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setConfirmOpen(false)}>
          <div className="bg-white rounded-xl p-6 max-w-sm mx-4 shadow-xl w-full" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-900 text-center mb-2">确认创建任务</h3>
            <p className="text-sm text-slate-600 text-center mb-5">确认后将根据所选方案和配置开始创作，是否继续？</p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700 transition-colors"
              >
                取消
              </button>
              <button
                type="button"
                onClick={async (e) => {
                  if (creatingLock.current) return
                  creatingLock.current = true
                  ;(e.currentTarget as HTMLButtonElement).disabled = true
                  const skill = skills.find(s => s.skill_id === selectedSkillId)
                  if (!skill) { toast.error("请选择创作方案"); creatingLock.current = false; return }
                  setConfirmOpen(false)
                  setSubmitting(true)
                  try {
                    const prompt = isAuto ? (topic.trim() || "全自动创作") : buildPrompt(selectedTags, topic)
                    const taskResp = await createTask({
                      platform,
                      account_ids: [selectedAccountId],
                      skill_id: selectedSkillId,
                      model: modelId,
                      is_auto_publish: isAuto,
                      name: skill.name,
                      description: skill.description,
                      category: skill.category,
                      cover_image: skill.cover_image,
                    })
                    const taskId = taskResp.data?.task_id
                    if (!taskId) throw new Error("创建任务失败：未返回 task_id")

                    if (isAuto) {
                      router.replace(buildTaskDetailHref(taskId, { platform, from: "new" }))
                      return
                    }

                    let session
                    try {
                      session = await createSession({
                        task_id: taskId,
                        skillId: selectedSkillId,
                        model: modelId,
                        topic: prompt,
                        platform,
                        accountId: selectedAccountId,
                        novel_name: skill.name,
                      })
                    } catch (err: unknown) {
                      if (err instanceof Error && err.message) {
                        const match = err.message.match(/existing_session_id[": ]+([a-z0-9]+)/)
                        if (match?.[1]) {
                          router.replace(buildTaskDetailHref(taskId, { sid: match[1], platform, from: "new" }))
                          return
                        }
                      }
                      throw err
                    }
                    router.replace(buildTaskDetailHref(taskId, { sid: session.session_id, platform, from: "new" }))
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "创建任务失败")
                  } finally {
                    setSubmitting(false)
                    creatingLock.current = false
                  }
                }}
                className="px-6 py-2 text-sm font-medium text-white bg-gradient-to-r from-orange-500 to-red-500 rounded-lg hover:opacity-90 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="fixed bottom-0 left-64 right-0 z-10 h-[4.5rem] border-t border-slate-200 bg-white">
        <div className="flex h-full items-center px-8">
          <div className="mx-auto flex w-full max-w-5xl justify-end">
            <button
              type="submit"
              form="new-task-form"
              disabled={submitting}
              className="px-7 py-2.5 text-sm font-medium text-white bg-gradient-to-r from-orange-500 to-red-500 rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm flex items-center gap-2 transition-opacity"
            >
              {submitting
                ? <><Loader2 size={14} className="animate-spin" />创建中...</>
                : "创建任务"
              }
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
