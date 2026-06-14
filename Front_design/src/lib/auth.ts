"use client"

const JWT_KEY = "bff_jwt_token"
const USER_KEY = "bff_user"
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || ""

export interface AuthUser {
  uid: string
  username: string
  role: "admin" | "user"
  token: string
  phone?: string
}

let memoryUser: AuthUser | null = null
let sessionVerified = false
let meInflight: Promise<AuthUser | null> | null = null

type AuthProfile = Pick<AuthUser, "uid" | "username" | "role" | "phone">

export function setAuthUser(user: AuthUser) {
  memoryUser = user
  sessionVerified = true
  try {
    localStorage.setItem(JWT_KEY, user.token)
    localStorage.setItem(USER_KEY, JSON.stringify({
      uid: user.uid,
      username: user.username,
      role: user.role,
      ...(user.phone ? { phone: user.phone } : {}),
    }))
  } catch { /* ignore */ }
}

export function getAuthUser(): AuthUser | null {
  if (memoryUser) return memoryUser
  try {
    const token = localStorage.getItem(JWT_KEY)
    const userStr = localStorage.getItem(USER_KEY)
    if (token && userStr) {
      const user = JSON.parse(userStr) as Omit<AuthUser, "token">
      memoryUser = { ...user, token }
      return memoryUser
    }
  } catch { /* ignore */ }
  return null
}

export function getToken(): string | null {
  if (memoryUser) return memoryUser.token
  try {
    const stored = localStorage.getItem(JWT_KEY)
    if (stored) return stored
  } catch { /* ignore */ }
  return null
}

export function isAuthenticated(): boolean {
  return getToken() !== null
}

export function isAdmin(): boolean {
  return getAuthUser()?.role === "admin"
}

export function clearAuth() {
  memoryUser = null
  sessionVerified = false
  meInflight = null
  try {
    localStorage.removeItem(JWT_KEY)
    localStorage.removeItem(USER_KEY)
  } catch { /* ignore */ }
}

function profileFromMemory(): AuthProfile | null {
  const current = getAuthUser()
  if (!current) return null
  return {
    uid: current.uid,
    username: current.username,
    role: current.role,
    phone: current.phone,
  }
}

async function requestAuthMe(): Promise<AuthUser | null> {
  const token = getToken()
  if (!token) return null
  try {
    const resp = await fetch(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!resp.ok) {
      clearAuth()
      return null
    }
    const data = await resp.json()
    const profile = data.data || data
    if (!profile?.uid) {
      clearAuth()
      return null
    }

    const current = getAuthUser()
    const nextUser: AuthUser = {
      uid: profile.uid,
      username: profile.username,
      role: profile.role,
      token,
      phone: profile.phone ? String(profile.phone) : undefined,
    }
    if (current) {
      setAuthUser({ ...current, ...nextUser, token: current.token })
    } else {
      setAuthUser(nextUser)
    }
    return getAuthUser()
  } catch {
    clearAuth()
    return null
  }
}

export async function login(account: string, password: string): Promise<AuthUser> {
  const normalized = /^\d[\d\s-]*$/.test(account.trim())
    ? account.replace(/\D/g, "")
    : account.trim()
  const resp = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: normalized, password }),
  })
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}))
    throw new Error(body.message || body.errorMessage || "登录失败")
  }
  const data = await resp.json()
  const user: AuthUser = {
    uid: data.uid,
    username: data.username,
    role: data.role,
    token: data.token,
    ...(data.phone ? { phone: String(data.phone) } : {}),
  }
  setAuthUser(user)
  return user
}

export function logout() {
  clearAuth()
  if (typeof window !== "undefined") {
    window.location.href = "/login"
  }
}

/** 校验会话；同一会话内多次调用共享结果，不会重复请求 /api/auth/me */
export async function verifySession(): Promise<boolean> {
  const user = await fetchCurrentUser()
  return user !== null
}

export async function fetchCurrentUser(): Promise<AuthProfile | null> {
  if (sessionVerified) {
    return profileFromMemory()
  }
  if (meInflight) {
    const user = await meInflight
    return user ? profileFromMemory() : null
  }

  meInflight = requestAuthMe().finally(() => {
    meInflight = null
  })
  const user = await meInflight
  return user ? profileFromMemory() : null
}

export function userRoleLabel(role: "admin" | "user") {
  return role === "admin" ? "管理员" : "用户"
}

export function userSubline(user: Pick<AuthUser, "phone" | "role">) {
  return user.phone || userRoleLabel(user.role)
}
