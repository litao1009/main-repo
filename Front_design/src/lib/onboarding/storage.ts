"use client"

export type TourId = "adminUsers" | "accounts" | "newTask" | "taskList" | "taskDetail"

const STORAGE_KEY = "bff_onboarding_v1"

interface OnboardingState {
  firstLoginRedirectDone?: true
  tours?: Partial<Record<TourId, true>>
}

function readState(): OnboardingState {
  if (typeof window === "undefined") return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as OnboardingState
  } catch {
    return {}
  }
}

function writeState(state: OnboardingState) {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch { /* ignore */ }
}

export function isFirstLoginRedirectDone(): boolean {
  return readState().firstLoginRedirectDone === true
}

export function markFirstLoginRedirectDone() {
  const state = readState()
  if (state.firstLoginRedirectDone) return
  writeState({ ...state, firstLoginRedirectDone: true })
}

export function isTourDone(tourId: TourId): boolean {
  return readState().tours?.[tourId] === true
}

export function markTourDone(tourId: TourId) {
  const state = readState()
  if (state.tours?.[tourId]) return
  writeState({
    ...state,
    tours: { ...state.tours, [tourId]: true },
  })
}

export function getFirstLoginPath(role: "admin" | "user"): string {
  return role === "admin" ? "/admin/users" : "/accounts"
}
