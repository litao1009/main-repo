// ===== 账号 (A1 Account Vault) =====
export interface AccountSummary {
  account_id: string
  uid: string
  platform: string
  masked_display: string
  bound_at: string
  updated_at: string
}

/** Cookie 健康检测结果，对应 GET /api/account/health/:account_id */
export interface CookieHealthResponse {
  account_id: string
  /** true = cookie 仍有效；false = 已过期或失效 */
  valid: boolean
  checked_at: string
}

/** 用户自取凭证结果，对应 GET /api/account/credential/:account_id */
export interface AccountCredentialResponse {
  account_id: string
  uid: string
  platform: string
  credentials: string
  masked_display: string
  security_warning: string
}

export interface AccountListResponse {
  accounts: AccountSummary[]
  total: number
}

export interface BindRequest {
  uid?: string
  platform: string
  credentials_plaintext: string
  masked_display?: string
  account_id?: string
  caller: string
}

export interface BindResponse {
  account_id: string
  uid: string
  platform: string
  masked_display: string
  is_new_binding: boolean
  bound_at: string
}

export interface UnbindRequest {
  account_id: string
  uid?: string
  caller: string
}

export interface UnbindResponse {
  account_id: string
  unbound_at: string
}

// ===== 任务 (Session Manager via BFF) =====
export interface TaskCreateInput {
  platform: string
  account_ids: string[]
  skill_id: string
  model: string
  is_auto_publish: boolean
  name?: string
  description?: string
  category?: string
  cover_image?: string
}

export interface TaskCreateResponse {
  code: number
  message?: string
  data?: {
    task_id: string
    trace_id: string
  }
  trace_id?: string
}

export interface TaskSummary {
  task_id: string
  topic: string
  novel_name?: string
  account_id?: string
  published_chapter_count?: number
  volume_name?: string
  chapter_number?: number
  title?: string
  platform: string
  skill_id: string
  model: string
  uid?: string
  created_at: string
  last_active_at?: string
  status: string
  draft_version: number
  active_session_id?: string
}

export interface TaskListResponse {
  tasks: TaskSummary[]
  total?: number
}

// ===== 模型 & Skill =====
export interface Model {
  id: string
  name: string
  provider: string
  context_limit: number
  recommended_for: string
  tags: string[]
}

export interface Skill {
  skill_id: string
  version: string
  name: string
  description: string
  category: string
  status: string
}

// ===== Skill 分配 =====

export interface AllocSkillInput {
  platform: string
  theme?: string
}

export interface AllocSkillItem {
  skill_id: string
  version: string
  name: string
  description: string
  category: string
  cover_image: string
}

export interface AllocSkillListResponse {
  skills: AllocSkillItem[]
  total: number
}

export interface AllocSkillData {
  skill_id: string
  name: string
  description: string
  cover_url?: string
}

export interface AllocSkillResponse {
  code: number
  data: AllocSkillData
}

// ===== 会话 (Session Manager) =====
export interface SessionCreateInput {
  task_id: string
  skillId?: string
  model?: string
  topic?: string
  platform?: string
  accountId?: string
  novel_name?: string
  chapter_number?: number
}

export interface SessionCreateResponse {
  session_id: string
  task_id: string
  status: string
  cwd_path: string
  draft_version: number
}

export interface Session {
  session_id: string
  task_id: string
  status: "CREATED" | "RUNNING" | "WARM" | "ARCHIVED"
  draft_version: number
  message_count: number
  total_tokens: number
}

export interface Draft {
  draft: string
  draft_version: number
  chapter_title?: string
  cwd_path: string
}

export interface SendMessageResponse {
  accepted: boolean
}

export interface TaskMessageInput {
  text: string
  target_session_id?: string
  draft_version?: number
  mode?: "chat" | "edit"
}

export interface TaskMessagesResponse {
  messages: SessionMessage[]
  count: number
}

// ===== 发布 (Workflow Engine) =====
export interface PublishInput {
  draft_version: number
  sessionId: string
  platform: string
  accounts: string[]
  skillId: string
  topic?: string
  novelName?: string
  title?: string
  volumeName?: string
  chapterNumber?: number
}

// ===== 看板 (Dashboard C2) =====
export interface DashboardQueryRequest {
  accountIds?: string[]
  platforms?: string[]
  skillIds?: string[]
  sessionIds?: string[]
  startTime?: string
  endTime?: string
  page?: number
  size?: number
}

export interface DashboardItem {
  postId: string
  accountId: string
  loginName: string
  novelName: string
  platform: string
  skillId?: string
  sessionId?: string
  views: number
  likes: number
  comments: number
  shares: number
  publishedAt: string
}

export interface DashboardSummary {
  totalPosts: number
  totalViews: number
  totalLikes: number
  totalComments: number
  totalShares: number
}

export interface DashboardQueryResponse {
  items: DashboardItem[]
  summary: DashboardSummary
  total: number
}

// ===== WebSocket 事件 =====
export type WSEventType =
  | "token"
  | "tool_call"
  | "step_finish"
  | "draft_updated"
  | "novel_name"
  | "episode_created"
  | "session_interrupted"
  | "done"
  | "error"
  | "heartbeat"

export interface WSEvent {
  type: WSEventType
  session_id?: string
  task_id?: string
  text?: string
  tool?: string
  args?: Record<string, unknown>
  draft_path?: string
  draft_version?: number
  novel_name?: string
  episode_id?: string
  next_session_id?: string
  reason?: string
  message?: string
  error?: string
}

// ===== 消息 =====
export interface SessionMessage {
  id: string
  role: "user" | "assistant" | "system"
  text: string
  timestamp: string
  draft_version?: number
}

// ===== 用户管理（管理员） =====
export interface AdminUserInfo {
  uid: string
  username: string
  role: "admin" | "user"
  accountCount: number
  taskCount: number
  createdAt: string
  lastLoginAt?: string
}

export interface AdminUserListResponse {
  users: AdminUserInfo[]
  total: number
}

export interface CreateUserRequest {
  username: string
  password: string
  role: "admin" | "user"
}

export interface CreateUserResponse {
  uid: string
  username: string
  role: string
  createdAt: string
}

export interface UpdateUserRequest {
  password?: string
  role?: "admin" | "user"
}

export interface UpdateUserResponse {
  uid: string
  username: string
  role: string
  updatedAt: string
}

// ===== 书卷章 API =====

export interface BookChapter {
  chapter_number: number
  session_id: string
  title: string
  status: string
  draft_version: number
  created_at: string
  archived_at: string
}

export interface BookVolume {
  volume_name: string
  chapter_count: number
  chapters: BookChapter[]
}

export interface BookInfoResponse {
  task_id: string
  novel_name: string
  total_volumes: number
  total_chapters: number
  volumes: BookVolume[]
}

// ===== 任务发布记录 =====

export interface PublishRecord {
  postId: string
  accountId: string
  platform: string
  skillId: string
  sessionId: string
  novelName: string
  loginName?: string
  publishedAt: string
  views: number
  likes: number
  comments: number
  shares: number
}

export interface TaskPublishListSummary {
  totalPosts: number
  totalViews: number
  totalLikes: number
  totalComments: number
  totalShares: number
}

export interface TaskPublishListResponse {
  items: PublishRecord[]
  summary: TaskPublishListSummary
  total: number
}

export interface BookContentResponse {
  task_id: string
  volume_name: string
  chapter_number: number
  session_id: string
  chapter_title: string
  content: string
  draft_version: number
  created_at: string
}
