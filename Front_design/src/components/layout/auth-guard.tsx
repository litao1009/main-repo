"use client"

import { useEffect, useState, useRef } from "react"
import { usePathname, useRouter } from "next/navigation"
import { isAuthenticated, verifySession } from "@/lib/auth"

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const redirectingRef = useRef(false)
  const sessionCheckedRef = useRef(false)

  useEffect(() => {
    if (pathname === "/login") {
      sessionCheckedRef.current = false
      if (isAuthenticated()) {
        verifySession().then((valid) => {
          if (valid) {
            if (!redirectingRef.current) {
              redirectingRef.current = true
              router.replace("/tasks/new")
            }
          } else {
            setReady(true)
          }
        })
      } else {
        setReady(true)
      }
      return
    }

    if (!isAuthenticated()) {
      if (!redirectingRef.current) {
        redirectingRef.current = true
        router.replace("/login")
      }
      return
    }

    if (sessionCheckedRef.current) {
      setReady(true)
      return
    }

    verifySession().then((valid) => {
      if (valid) {
        sessionCheckedRef.current = true
        setReady(true)
      } else if (!redirectingRef.current) {
        redirectingRef.current = true
        router.replace("/login")
      }
    })
  }, [pathname, router])

  if (pathname === "/login") {
    return ready ? <>{children}</> : null
  }

  if (!ready) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-muted-foreground text-sm">加载中...</div>
      </div>
    )
  }

  return <>{children}</>
}
