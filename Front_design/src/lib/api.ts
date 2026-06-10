import { getToken } from "./auth"
import type {
  Model,
  Skill,
  AccountSummary,
  AccountListResponse,
  BindRequest,
  BindResponse,
  UnbindRequest,
  UnbindResponse,
  CookieHealthResponse,
  SyncProfileResponse,
  AccountCredentialResponse,
  TaskCreateInput,
  TaskCreateResponse,
  TaskSummary,
  TaskListResponse,
  SessionCreateInput,
  SessionCreateResponse,
  Session,
  Draft,
  TaskMessagesResponse,
  TaskMessageInput,
  SendMessageResponse,
  PublishInput,
  DashboardQueryRequest,
  DashboardQueryResponse,
  AdminUserInfo,
  AdminUserListResponse,
  CreateUserRequest,
  CreateUserResponse,
  UpdateUserRequest,
  UpdateUserResponse,
  AllocSkillInput,
  AllocSkillResponse,
  AllocSkillData,
  AllocSkillItem,
  AllocSkillListResponse,
  BookInfoResponse,
  BookContentResponse,
  TaskPublishListResponse,
  PublishRecord,
  AutoPublishTaskStatusData,
  AutoPublishQueueResponse,
} from "@/types"

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || ""

function authHeaders(): Record<string, string> {
  const token = getToken()
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (token) headers["Authorization"] = `Bearer ${token}`
  return headers
}

const inflightGetRequests = new Map<string, Promise<unknown>>()

function dedupeInflight<T>(key: string, request: () => Promise<T>): Promise<T> {
  const existing = inflightGetRequests.get(key)
  if (existing) return existing as Promise<T>

  const promise = request().finally(() => {
    inflightGetRequests.delete(key)
  })
  inflightGetRequests.set(key, promise)
  return promise
}

async function get<T>(path: string): Promise<T> {
  return dedupeInflight(`GET ${path}`, async () => {
    const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders() })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.message || body.errorMessage || `HTTP ${res.status}`)
    }
    return res.json() as Promise<T>
  })
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}))
    const detail = errBody.detail ? ` ${errBody.detail}` : ""
    throw new Error((errBody.message || errBody.errorMessage || `HTTP ${res.status}`) + detail)
  }
  return res.json()
}

// ===== 资源 =====

export async function fetchModels(): Promise<Model[]> {
  const data = await get<{ count: number; models: Model[] }>("/api/models")
  return data.models || []
}

export async function fetchSkills(): Promise<Skill[]> {
  const data = await get<{ skills: Skill[]; total: number }>("/api/skill/list")
  return data.skills || []
}

export async function allocSkill(input: AllocSkillInput): Promise<AllocSkillItem[]> {
  const resp = await post<AllocSkillListResponse | { skills: AllocSkillItem[]; total: number }>("/api/task/alloc_skill", input)
  const raw = resp as unknown as Record<string, unknown>
  const data = raw.data as Record<string, unknown> | undefined
  if (data && Array.isArray(data.skills)) return data.skills as AllocSkillItem[]
  if (raw.skills && Array.isArray(raw.skills)) return raw.skills as AllocSkillItem[]
  throw new Error("获取创作方案失败：未返回有效数据")
}

// ===== 账号 =====

export async function fetchAccounts(platform = ""): Promise<AccountSummary[]> {
  const params = new URLSearchParams()
  if (platform) params.set("platform", platform)
  const qs = params.toString()
  const resp = await get<AccountListResponse>(`/api/account/list${qs ? "?" + qs : ""}`)
  return resp.accounts || []
}

export async function bindAccount(
  platform: string,
  credentialsPlaintext: string,
  maskedDisplay?: string,
  accountId?: string,
  profile?: { phone_number?: string; avatar_url?: string; is_auth?: boolean; identity_code_mask?: string; identity_name_mask?: string }
): Promise<BindResponse> {
  return post<BindResponse>("/api/account/bind", {
    platform,
    credentials_plaintext: credentialsPlaintext,
    masked_display: maskedDisplay || undefined,
    account_id: accountId || undefined,
    caller: "bff",
    phone_number: profile?.phone_number || undefined,
    avatar_url: profile?.avatar_url || undefined,
    is_auth: profile?.is_auth,
    identity_code_mask: profile?.identity_code_mask || undefined,
    identity_name_mask: profile?.identity_name_mask || undefined,
  })
}

export async function unbindAccount(accountId: string): Promise<UnbindResponse> {
  return post<UnbindResponse>("/api/account/unbind", {
    account_id: accountId,
    caller: "bff",
  })
}

/**
 * 检测账号 Cookie 是否仍有效，并在有效时同步平台资料（一次平台请求）。
 * 后端路由：GET /api/account/health/:account_id
 */
export async function checkCookieHealth(accountId: string): Promise<CookieHealthResponse> {
  return get<CookieHealthResponse>(`/api/account/health/${accountId}`)
}

/** @deprecated 资料同步已合并进 checkCookieHealth，保留仅供兼容旧调用 */
export async function syncAccountProfile(accountId: string): Promise<SyncProfileResponse> {
  return post<SyncProfileResponse>(`/api/account/sync-profile/${accountId}`, {})
}

/** 用户自取账号凭证明文（仅用于 Cookie 注入回浏览器），凭证不应落 localStorage */
export async function fetchAccountCredential(accountId: string): Promise<AccountCredentialResponse> {
  return get<AccountCredentialResponse>(`/api/account/credential/${accountId}`)
}

// ===== 任务 =====

export async function createTask(input: TaskCreateInput): Promise<TaskCreateResponse> {
  return post<TaskCreateResponse>("/api/task/create", input)
}

export async function fetchTasks(page = 1, size = 12, q = ""): Promise<{ tasks: TaskSummary[]; total: number }> {
  const params = new URLSearchParams({ page: String(page), size: String(size) })
  if (q) params.set("q", q)
  const resp = await get<TaskListResponse>(`/api/task/list?${params.toString()}`)
  return { tasks: resp.tasks || [], total: resp.total ?? 0 }
}

export async function fetchTask(taskId: string): Promise<TaskSummary> {
  return get<TaskSummary>(`/api/task/${taskId}`)
}

// ===== 会话 =====

export async function createSession(input: SessionCreateInput): Promise<SessionCreateResponse> {
  return post<SessionCreateResponse>("/api/session/create", input)
}

export async function getSession(sessionId: string): Promise<Session> {
  return get<Session>(`/api/session/${sessionId}/status`)
}

export async function getDraft(sessionId: string): Promise<Draft> {
  return get<Draft>(`/api/session/${sessionId}/draft`)
}

export async function fetchTaskMessages(taskId: string): Promise<TaskMessagesResponse> {
  return get<TaskMessagesResponse>(`/api/task/${taskId}/messages`)
}

export async function clearTaskMessages(taskId: string): Promise<{ cleared: boolean }> {
  return del<{ cleared: boolean }>(`/api/task/${taskId}/messages`)
}

export async function sendTaskMessage(
  taskId: string,
  input: TaskMessageInput
): Promise<SendMessageResponse> {
  return post<SendMessageResponse>(`/api/task/${taskId}/message`, input)
}

export async function sendMessage(
  sessionId: string,
  text: string,
  draftVersion?: number
): Promise<SendMessageResponse> {
  return post<SendMessageResponse>(`/api/session/${sessionId}/message`, {
    text,
    draft_version: draftVersion,
  })
}

export async function closeSession(sessionId: string): Promise<{ episode_id: string }> {
  return post<{ episode_id: string }>(`/api/session/${sessionId}/close`, {})
}

// ===== 发布 =====

export async function publishTask(taskId: string, body: PublishInput): Promise<{ status: string; taskId: string; results?: Array<{ status: string; platform: string; accountId: string; postId?: string; errorCode?: string }> }> {
  return post<any>(`/api/task/${taskId}/publish`, body)
}

function normalizePublishRecord(raw: Record<string, unknown>): PublishRecord {
  return {
    postId: String(raw.postId ?? raw.post_id ?? ""),
    accountId: String(raw.accountId ?? raw.account_id ?? ""),
    platform: String(raw.platform ?? ""),
    skillId: String(raw.skillId ?? raw.skill_id ?? ""),
    sessionId: String(raw.sessionId ?? raw.session_id ?? ""),
    novelName: String(raw.novelName ?? raw.novel_name ?? ""),
    loginName: raw.loginName != null ? String(raw.loginName) : raw.login_name != null ? String(raw.login_name) : undefined,
    publishedAt: String(raw.publishedAt ?? raw.published_at ?? ""),
    views: Number(raw.views ?? 0),
    likes: Number(raw.likes ?? 0),
    comments: Number(raw.comments ?? 0),
    shares: Number(raw.shares ?? 0),
  }
}

/** 任务下已成功发布记录（权威数据源，按 sessionId 匹配章节） */
export async function fetchTaskPublishList(taskId: string): Promise<TaskPublishListResponse> {
  const resp = await get<unknown>(`/api/task/${taskId}/publish/list`)
  const raw = resp as Record<string, unknown>
  const payload = (raw.data ?? raw) as Record<string, unknown>
  const items = (Array.isArray(payload.items) ? payload.items : []).map((row) =>
    normalizePublishRecord(row as Record<string, unknown>),
  )
  const summaryRaw = payload.summary as Record<string, unknown> | undefined
  const summary = {
    totalPosts: Number(summaryRaw?.totalPosts ?? items.length),
    totalViews: Number(summaryRaw?.totalViews ?? 0),
    totalLikes: Number(summaryRaw?.totalLikes ?? 0),
    totalComments: Number(summaryRaw?.totalComments ?? 0),
    totalShares: Number(summaryRaw?.totalShares ?? 0),
  }
  const total = typeof payload.total === "number" ? payload.total : summary.totalPosts
  return { items, summary, total }
}

// ===== 看板 =====

function buildQuery(params: Record<string, unknown>): string {
  const parts = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue
    if (Array.isArray(value)) {
      for (const item of value) {
        parts.append(key, String(item))
      }
    } else {
      parts.append(key, String(value))
    }
  }
  const qs = parts.toString()
  return qs ? `?${qs}` : ""
}

export async function fetchDashboard(page = 1, size = 20, req: Omit<DashboardQueryRequest, "page" | "size"> = {}): Promise<DashboardQueryResponse> {
  return get<DashboardQueryResponse>(`/api/dashboard/query${buildQuery({ ...req, page, size } as unknown as Record<string, unknown>)}`)
}

// ===== 用户管理（管理员） =====

export async function fetchUsers(page = 1, size = 5): Promise<{ users: AdminUserInfo[]; total: number }> {
  const resp = await get<AdminUserListResponse>(`/api/admin/users?page=${page}&size=${size}`)
  return { users: resp.users || [], total: resp.total ?? 0 }
}

export async function createUser(req: CreateUserRequest): Promise<CreateUserResponse> {
  return post<CreateUserResponse>("/api/admin/users", req)
}

export async function updateUser(uid: string, req: UpdateUserRequest): Promise<UpdateUserResponse> {
  return put<UpdateUserResponse>(`/api/admin/users/${uid}`, req)
}

export async function deleteUser(uid: string): Promise<{ deleted: boolean }> {
  return del<{ deleted: boolean }>(`/api/admin/users/${uid}`)
}

export async function updateTask(taskId: string, body: { novel_name?: string }): Promise<void> {
  await post<unknown>(`/api/task/${taskId}/update`, body)
}

function unwrapBffData<T>(resp: unknown): T {
  const raw = resp as Record<string, unknown>
  if (typeof raw.code === "number" && raw.code !== 0) {
    throw new Error(String(raw.message || "请求失败"))
  }
  return (raw.data ?? raw) as T
}

// ===== 自动发布任务队列 =====

export async function fetchAutoPublishTaskStatus(taskId: string): Promise<AutoPublishTaskStatusData> {
  const resp = await get<unknown>(`/api/auto_publish_task/status?task_id=${encodeURIComponent(taskId)}`)
  const raw = unwrapBffData<Record<string, unknown>>(resp)
  const queuePos = raw.auto_publish_queue_position ?? raw.queue_position
  return {
    task_id: String(raw.task_id ?? taskId),
    auto_publish_status: (raw.auto_publish_status ?? raw.status) as AutoPublishTaskStatusData["auto_publish_status"],
    running: raw.running as boolean | undefined,
    chapter_number: raw.chapter_number as number | undefined,
    auto_publish_queue_position:
      typeof queuePos === "number" ? queuePos : queuePos != null ? Number(queuePos) : undefined,
    auto_publish_entry_time: (raw.auto_publish_entry_time ?? raw.entry_time) as string | undefined,
    last_executed_at: raw.last_executed_at as string | undefined,
    recoverable_at: raw.recoverable_at as string | undefined,
    auto_publish_error_message: (raw.auto_publish_error_message ?? raw.error_message) as string | null | undefined,
  }
}

export async function fetchAutoPublishQueue(): Promise<AutoPublishQueueResponse> {
  const resp = await get<unknown>("/api/auto_publish_task/queue")
  return unwrapBffData<AutoPublishQueueResponse>(resp)
}

export async function stopAutoPublishTask(taskId: string): Promise<{ task_id: string; status: string }> {
  const resp = await post<unknown>("/api/auto_publish_task/stop", { task_id: taskId })
  return unwrapBffData(resp)
}

export async function restartAutoPublishTask(taskId: string): Promise<{ task_id: string; status: string }> {
  const resp = await post<unknown>("/api/auto_publish_task/restart", { task_id: taskId })
  return unwrapBffData(resp)
}

export async function deleteAutoPublishTask(taskId: string): Promise<{ task_id: string; status: string }> {
  const resp = await post<unknown>("/api/auto_publish_task/delete", { task_id: taskId })
  return unwrapBffData(resp)
}

export async function setAutoPublishMaxSlots(maxSlots: number): Promise<{ max_slots: number; current_running: number }> {
  const resp = await put<unknown>("/api/config/auto-publish-slots", { max_slots: maxSlots })
  return unwrapBffData(resp)
}

export interface TaskStopResult {
  task_id: string
  status: "stopping" | "stopped" | "completed" | string
}

/** 停止任务（中止自动发布流程，不删除已生成内容） */
export async function stopTask(taskId: string, userId: string): Promise<TaskStopResult> {
  const resp = await post<{
    code?: number
    message?: string
    detail?: string
    data?: TaskStopResult
  }>("/api/task/stop", { task_id: taskId, user_id: userId })
  const raw = resp as unknown as Record<string, unknown>
  if (typeof raw.code === "number" && raw.code !== 0) {
    const detail = typeof raw.detail === "string" ? ` ${raw.detail}` : ""
    throw new Error((raw.message as string) || "停止任务失败" + detail)
  }
  const data = (raw.data ?? raw) as TaskStopResult
  if (!data?.task_id) {
    throw new Error("停止任务失败：未返回有效数据")
  }
  return data
}

export async function fetchTaskSessions(taskId: string): Promise<{
  sessions: Array<{
    session_id: string
    created_at: string
    draft_version: number
    status: string
    skill_id?: string
    model?: string
    episodes?: Array<{ decisions?: string }>
  }>
}> {
  return get(`/api/task/${taskId}/sessions`)
}

export async function generateNovelTitle(topic: string): Promise<{ titles: string[]; content: string }> {
  const resp = await post<{ code: number; data: { titles: string[]; content: string } }>("/api/novel/title-suggest", { topic })
  return resp.data
}

export async function getBookInfo(taskId: string): Promise<BookInfoResponse> {
  const resp = await get<{ code: number; data: BookInfoResponse }>(`/api/task/${taskId}/book/info`)
  return (resp as unknown as Record<string, unknown>).data as BookInfoResponse
}

export async function getBookContent(
  taskId: string,
  volumeName: string,
  chapterNumber: number
): Promise<BookContentResponse> {
  const params = new URLSearchParams({
    volume_name: volumeName,
    chapter_number: chapterNumber.toString(),
  })
  const resp = await get<{ code: number; data: BookContentResponse }>(`/api/task/${taskId}/book/content?${params.toString()}`)
  return (resp as unknown as Record<string, unknown>).data as BookContentResponse
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}))
    throw new Error(errBody.message || errBody.errorMessage || `HTTP ${res.status}`)
  }
  return res.json()
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "DELETE",
    headers: authHeaders(),
  })
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}))
    throw new Error(errBody.message || errBody.errorMessage || `HTTP ${res.status}`)
  }
  return res.json()
}
