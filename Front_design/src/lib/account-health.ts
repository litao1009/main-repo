import { checkCookieHealth } from "@/lib/api"
import type { AccountSummary } from "@/types"
import {
  getCachedEntry,
  setCachedEntry,
  shouldUseHealthCache,
  cacheCredentialUpdatedAt,
  type CookieHealthStatus,
} from "@/lib/cookie-health-cache"

async function resolveAccountHealth(acc: AccountSummary): Promise<CookieHealthStatus> {
  const cached = getCachedEntry(acc.account_id)
  if (shouldUseHealthCache(cached, acc.updated_at)) {
    return cached!.status
  }

  try {
    const res = await checkCookieHealth(acc.account_id)
    const status: CookieHealthStatus = res.valid ? "valid" : "expired"
    setCachedEntry(acc.account_id, {
      status,
      checkedAt: Date.now(),
      source: "backend",
      credentialUpdatedAt: cacheCredentialUpdatedAt(acc.updated_at, res.profile?.synced_at),
    })
    return status
  } catch {
    return "unknown"
  }
}

/** 发布场景：仅保留 Cookie 有效的账号 */
export async function filterPublishableAccounts(
  accounts: AccountSummary[],
): Promise<AccountSummary[]> {
  if (accounts.length === 0) return []

  const statuses = await Promise.all(accounts.map(resolveAccountHealth))
  return accounts.filter((_, i) => statuses[i] === "valid")
}
