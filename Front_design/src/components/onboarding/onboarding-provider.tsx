"use client"

import { useEffect, useRef } from "react"
import { usePathname } from "next/navigation"
import { driver, type Driver, type DriveStep } from "driver.js"
import "driver.js/dist/driver.css"
import "./tour-styles.css"
import { isTourDone, markTourDone, type TourId } from "@/lib/onboarding/storage"
import { buildTour, filterReadySteps, resolveTourId } from "@/lib/onboarding/tours"

const START_DELAY_MS = 600
const MAX_RETRIES = 8
const RETRY_INTERVAL_MS = 400

function waitForAnchors(steps: DriveStep[]): Promise<boolean> {
  return new Promise((resolve) => {
    let attempts = 0
    const check = () => {
      const ready = filterReadySteps(steps)
      if (ready.length > 0 || attempts >= MAX_RETRIES) {
        resolve(ready.length > 0)
        return
      }
      attempts += 1
      setTimeout(check, RETRY_INTERVAL_MS)
    }
    check()
  })
}

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const driverRef = useRef<Driver | null>(null)
  const activeTourRef = useRef<TourId | null>(null)

  useEffect(() => {
    if (pathname === "/login") return

    const tourId = resolveTourId(pathname)
    if (!tourId || isTourDone(tourId)) return

    let cancelled = false
    const timer = window.setTimeout(async () => {
      if (cancelled || isTourDone(tourId)) return

      const definition = buildTour(tourId)
      if (!definition) return

      const hasAnchors = await waitForAnchors(definition.steps)
      if (cancelled || !hasAnchors || isTourDone(tourId)) return

      const steps = filterReadySteps(definition.steps)
      if (steps.length === 0) return

      driverRef.current?.destroy()
      activeTourRef.current = tourId

      const instance = driver({
        showProgress: true,
        progressText: "{{current}} / {{total}}",
        nextBtnText: "下一步",
        prevBtnText: "上一步",
        doneBtnText: "完成",
        allowClose: true,
        overlayOpacity: 0.5,
        stagePadding: 8,
        stageRadius: 12,
        popoverClass: "bff-tour-popover",
        steps,
        onDestroyStarted: () => {
          if (activeTourRef.current) {
            markTourDone(activeTourRef.current)
            activeTourRef.current = null
          }
          instance.destroy()
        },
      })

      driverRef.current = instance
      instance.drive()
    }, START_DELAY_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      if (activeTourRef.current) {
        driverRef.current?.destroy()
        driverRef.current = null
        activeTourRef.current = null
      }
    }
  }, [pathname])

  return <>{children}</>
}
