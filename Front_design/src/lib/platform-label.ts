export type PlatformBadgeStyle = {
  label: string
  color: string
}

/** 任务列表等平台徽标文案与样式，key 为 platform 枚举值 */
export const PLATFORM_BADGE_STYLES: Record<string, PlatformBadgeStyle> = {
  fanqie: { label: "番茄小说", color: "text-red-600 bg-red-50 border-red-100" },
  qimao: { label: "七猫", color: "text-amber-600 bg-amber-50 border-amber-100" },
  zhulang: { label: "逐浪网", color: "text-blue-600 bg-blue-50 border-blue-100" },
  xhs: { label: "小红书", color: "text-rose-600 bg-rose-50 border-rose-100" },
  wechat: { label: "公众号", color: "text-green-600 bg-green-50 border-green-100" },
  yuewen: { label: "阅文", color: "text-purple-600 bg-purple-50 border-purple-100" },
}

const FALLBACK_BADGE_COLOR = "text-slate-600 bg-slate-100 border-slate-200"

export function getPlatformBadgeStyle(platform: string): PlatformBadgeStyle {
  const style = PLATFORM_BADGE_STYLES[platform]
  if (style) return style
  return { label: platform, color: FALLBACK_BADGE_COLOR }
}

export function getPlatformLabel(platform: string): string {
  return getPlatformBadgeStyle(platform).label
}
