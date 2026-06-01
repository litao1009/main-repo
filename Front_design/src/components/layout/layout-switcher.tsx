"use client"

import { usePathname } from "next/navigation"
import { Sidebar } from "./sidebar"

export function LayoutSwitcher({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  if (pathname === "/login") {
    return <>{children}</>
  }

  // 任务详情页全屏，不显示侧边栏
  const isWorkspace = /^\/tasks\/[^/]+$/.test(pathname) && pathname !== "/tasks/new"
  if (isWorkspace) {
    return <div className="min-h-screen bg-slate-50">{children}</div>
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <main className="ml-64 min-w-0 flex-1 overflow-x-hidden p-8">
        {children}
      </main>
    </div>
  )
}
