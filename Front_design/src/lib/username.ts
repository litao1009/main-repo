/** 与 A1 ValidateUsername 保持一致：3–32 位，字母/数字开头，仅含字母、数字、._- */
export const USERNAME_MIN_LEN = 3
export const USERNAME_MAX_LEN = 32
export const USERNAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,31}$/

export const USERNAME_HINT =
  "3–32 位，以字母或数字开头，仅可含字母、数字、._-"

/** 输入时过滤非法字符（含中文） */
export function sanitizeUsernameInput(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, USERNAME_MAX_LEN)
}

export function validateUsername(username: string): string | null {
  const trimmed = username.trim()
  if (!trimmed) return "请输入用户名"
  if (trimmed.length < USERNAME_MIN_LEN) return `用户名至少 ${USERNAME_MIN_LEN} 位`
  if (trimmed.length > USERNAME_MAX_LEN) return `用户名最多 ${USERNAME_MAX_LEN} 位`
  if (!/^[a-zA-Z0-9]/.test(trimmed)) return "用户名须以字母或数字开头"
  if (!USERNAME_PATTERN.test(trimmed)) {
    return "用户名仅可包含字母、数字、下划线、点、连字符"
  }
  return null
}
