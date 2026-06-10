"use client"

import { useEffect, useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/toast"
import { Input, Label } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { fetchUsers, createUser, updateUser, deleteUser, fetchAutoPublishQueue, setAutoPublishMaxSlots } from "@/lib/api"
import { getAuthUser, setAuthUser } from "@/lib/auth"
import type { AdminUserInfo } from "@/types"
import { formatRelativeTime, formatDate } from "@/lib/utils"
import { Loader2, AlertCircle, Eye, EyeOff, Minus, Plus, Settings2, UserPlus, UserCog, User, Shield, Phone, KeyRound } from "lucide-react"
import { cn } from "@/lib/utils"
import { sanitizeUsernameInput, validateUsername, USERNAME_HINT, USERNAME_MAX_LEN } from "@/lib/username"

function formatLastLogin(v?: string) {
  if (!v) return null
  return <span title={formatDate(v)}>{formatRelativeTime(v)}</span>
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUserInfo[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [page, setPageState] = useState(1)

  const setPage = (p: number) => {
    setPageState(p)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }
  const pageSize = 20
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const [showCreate, setShowCreate] = useState(false)
  const [showEdit, setShowEdit] = useState<AdminUserInfo | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AdminUserInfo | null>(null)
  const currentUser = getAuthUser()

  const [maxSlots, setMaxSlots] = useState(2)
  const [maxSlotsInput, setMaxSlotsInput] = useState("2")
  const [runningCount, setRunningCount] = useState(0)
  const [slotsLoading, setSlotsLoading] = useState(true)
  const [slotsSaving, setSlotsSaving] = useState(false)

  const loadSlots = useCallback(async () => {
    setSlotsLoading(true)
    try {
      const data = await fetchAutoPublishQueue()
      setMaxSlots(data.max_slots)
      setMaxSlotsInput(String(data.max_slots))
      setRunningCount(data.running_count)
    } catch {
      setMaxSlots(2)
      setMaxSlotsInput("2")
      setRunningCount(0)
    } finally {
      setSlotsLoading(false)
    }
  }, [])

  const handleSaveSlots = async () => {
    const parsed = Number.parseInt(maxSlotsInput, 10)
    if (!Number.isFinite(parsed) || parsed < 1) {
      toast.error("最大并发数至少为 1")
      return
    }
    setSlotsSaving(true)
    try {
      const data = await setAutoPublishMaxSlots(parsed)
      setMaxSlots(data.max_slots)
      setMaxSlotsInput(String(data.max_slots))
      setRunningCount(data.current_running)
      toast.success("并发设置已保存")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败")
    } finally {
      setSlotsSaving(false)
    }
  }

  const adjustSlots = (delta: number) => {
    const next = Math.max(1, (Number.parseInt(maxSlotsInput, 10) || maxSlots) + delta)
    setMaxSlotsInput(String(next))
  }

  const loadUsers = useCallback(async (targetPage = page) => {
    setLoading(true)
    setLoadFailed(false)
    try {
      const result = await fetchUsers(targetPage, pageSize)
      setUsers(result.users)
      setTotal(result.total)
    } catch (err) {
      setLoadFailed(true)
      toast.error(err instanceof Error ? err.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }, [page, pageSize])

  useEffect(() => { loadUsers(page) }, [page, loadUsers])
  useEffect(() => { loadSlots() }, [loadSlots])

  const getInitials = (name: string) => name.slice(0, 2).toUpperCase()

  return (
    <div className="max-w-7xl mx-auto px-6 pt-6">

      {/* 页头 */}
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">用户权限管理</h1>
          <p className="text-slate-500 mt-1">管理系统内的操作员账号及系统角色分配</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 shadow-sm transition-colors"
        >
          + 邀请新用户
        </button>
      </div>

      {/* 内测 · 自动发布并发 */}
      <div className="mb-8 rounded-2xl border border-violet-100 bg-gradient-to-br from-violet-50/80 to-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Settings2 size={16} className="text-violet-600 shrink-0" />
              <h2 className="text-sm font-semibold text-slate-900">自动发布并发</h2>
              <span className="px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-violet-700 bg-violet-100 rounded">
                内测
              </span>
            </div>
            <p className="text-xs text-slate-500">
              控制同时运行的自动发布任务数量（全局）。当前占用{" "}
              {slotsLoading ? "—" : `${runningCount} / ${maxSlots}`} 槽位
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-slate-500 mr-1">最大并发</span>
            <button
              type="button"
              onClick={() => adjustSlots(-1)}
              disabled={slotsLoading || slotsSaving}
              className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors"
              aria-label="减少并发数"
            >
              <Minus size={14} />
            </button>
            <Input
              value={maxSlotsInput}
              onChange={(e) => setMaxSlotsInput(e.target.value.replace(/\D/g, ""))}
              disabled={slotsLoading || slotsSaving}
              className="w-14 h-8 text-center text-sm px-1"
              inputMode="numeric"
              aria-label="最大并发数"
            />
            <button
              type="button"
              onClick={() => adjustSlots(1)}
              disabled={slotsLoading || slotsSaving}
              className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors"
              aria-label="增加并发数"
            >
              <Plus size={14} />
            </button>
            <button
              type="button"
              onClick={handleSaveSlots}
              disabled={slotsLoading || slotsSaving}
              className="ml-2 px-4 py-2 h-8 inline-flex items-center justify-center bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors min-w-[72px]"
            >
              <span className="inline-grid place-items-center">
                <span className={cn("col-start-1 row-start-1", slotsSaving && "invisible")}>保存设置</span>
                <span className={cn("col-start-1 row-start-1 inline-flex items-center justify-center", !slotsSaving && "invisible")}>
                  <Loader2 size={14} className="animate-spin" />
                </span>
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* 内容区 */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
        </div>
      ) : loadFailed ? (
        <div className="flex flex-col items-center justify-center py-24">
          <AlertCircle className="w-12 h-12 mb-4 text-slate-300" />
          <p className="text-sm text-slate-500 mb-3">用户列表加载失败</p>
          <Button variant="ghost" size="sm" onClick={() => loadUsers(page)}>重试</Button>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <table className="w-full text-left text-sm table-fixed">
            <colgroup>
              <col className="w-[22%]" />
              <col className="w-[10%]" />
              <col className="w-[18%]" />
              <col className="w-[18%]" />
              <col className="w-[12%]" />
              <col className="w-[20%]" />
            </colgroup>
            <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-6 py-4 font-medium">用户档案</th>
                <th className="px-6 py-4 font-medium">系统角色</th>
                <th className="px-6 py-4 font-medium text-center">绑定账号</th>
                <th className="px-6 py-4 font-medium text-center">任务数</th>
                <th className="px-6 py-4 font-medium">最后登录</th>
                <th className="px-6 py-4 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {users.map((u) => {
                const isSelf = u.uid === currentUser?.uid
                const isAdminRole = u.role === "admin"
                return (
                  <tr key={u.uid} className="hover:bg-slate-50 transition-colors">

                    {/* 用户档案 */}
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                          isSelf || isAdminRole
                            ? "bg-gradient-to-tr from-orange-400 to-red-500 text-white"
                            : "bg-slate-200 text-slate-600"
                        }`}>
                          {getInitials(u.username)}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900 line-clamp-2 break-all leading-snug">
                            {u.username}
                            {isSelf && <span className="text-slate-400 font-normal ml-1">（您）</span>}
                          </p>
                          {u.phone && (
                            <p className="text-xs text-slate-500 mt-0.5">{u.phone}</p>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* 系统角色 */}
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 text-xs font-medium rounded border ${
                        isAdminRole
                          ? "text-purple-700 bg-purple-50 border-purple-100"
                          : "text-slate-600 bg-slate-100 border-slate-200"
                      }`}>
                        {isAdminRole ? "管理员" : "用户"}
                      </span>
                    </td>

                    {/* 绑定账号 */}
                    <td className="px-6 py-4 text-center">{u.accountCount}</td>

                    {/* 任务数 */}
                    <td className="px-6 py-4 text-center">{u.taskCount}</td>

                    {/* 最后登录 */}
                    <td className="px-6 py-4 text-slate-500">{formatLastLogin(u.lastLoginAt)}</td>

                    {/* 操作 */}
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-4">
                        <button
                          onClick={() => setShowEdit(u)}
                          className="text-orange-600 hover:text-orange-700 font-medium transition-colors"
                        >
                          编辑
                        </button>
                        {isSelf ? (
                          <span
                            className="text-slate-300 font-medium cursor-not-allowed"
                            title="不能删除当前登录账号"
                          >
                            删除
                          </span>
                        ) : (
                          <button
                            onClick={() => setDeleteTarget(u)}
                            title="删除用户"
                            className="text-red-500 hover:text-red-700 font-medium transition-colors"
                          >
                            删除
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 分页 */}
      {total > pageSize && (
        <div className="flex items-center justify-between mt-6 text-sm text-slate-500">
          <span>共 {total} 位用户</span>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              className="px-3 py-1.5 border border-slate-200 bg-white text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              上一页
            </button>
            <span className="px-2 text-slate-400">{page} / {totalPages}</span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
              className="px-3 py-1.5 border border-slate-200 bg-white text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              下一页
            </button>
          </div>
        </div>
      )}

      {/* 弹窗 */}
      {showCreate && (
        <CreateUserModal
          open
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false)
            setPage(1)
            loadUsers(1)
            toast.success("用户创建成功")
          }}
        />
      )}
      {showEdit && (
        <EditUserModal
          key={showEdit.uid}
          user={showEdit}
          open={!!showEdit}
          onClose={() => setShowEdit(null)}
          onUpdated={() => {
            setShowEdit(null)
            loadUsers(page)
            toast.success("用户信息已更新")
          }}
        />
      )}
      <DeleteConfirmModal
        user={deleteTarget}
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={() => {
          setDeleteTarget(null)
          const newPage = users.length === 1 && page > 1 ? page - 1 : page
          if (newPage !== page) setPage(newPage)
          else loadUsers(page)
          toast.success("用户已删除")
        }}
      />
    </div>
  )
}

/* ── 用户弹窗共享 UI ── */

const USER_MODAL_INPUT_CLASS =
  "h-10 bg-white border-slate-200/90 shadow-sm placeholder:text-slate-400 focus-visible:border-orange-400 focus-visible:ring-orange-500/20"

function UserModalShell({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[440px] gap-0 overflow-hidden rounded-2xl border-slate-200/80 p-0 shadow-[0_24px_48px_-12px_rgba(15,23,42,0.18)]">
        {children}
      </DialogContent>
    </Dialog>
  )
}

function UserModalHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType
  title: string
  description?: string
}) {
  return (
    <DialogHeader className="space-y-0 px-6 pt-6 pb-4 text-left">
      <div className="flex items-start gap-3.5 pr-8">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-orange-50 to-orange-100/80 ring-1 ring-orange-200/60">
          <Icon className="h-5 w-5 text-orange-600" strokeWidth={2} />
        </div>
        <div className="min-w-0 pt-0.5">
          <DialogTitle className="text-left text-lg font-semibold tracking-tight text-slate-900">{title}</DialogTitle>
          {description && (
            <DialogDescription className="mt-1 text-left text-[13px] leading-relaxed text-slate-500">
              {description}
            </DialogDescription>
          )}
        </div>
      </div>
    </DialogHeader>
  )
}

function UserProfileStrip({ user }: { user: AdminUserInfo }) {
  const initials = user.username.slice(0, 2).toUpperCase()
  return (
    <div className="mx-6 mb-3 flex items-center gap-2.5 rounded-lg border border-orange-200/70 bg-orange-50 px-3 py-2">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-[11px] font-bold text-orange-600 shadow-sm ring-1 ring-orange-200/80">
        {initials}
      </div>
      <p className="min-w-0 text-sm leading-snug">
        <span className="text-slate-500">正在编辑</span>
        <span className="mx-1.5 font-normal text-orange-300">·</span>
        <span className="font-semibold text-slate-900">{user.username}</span>
      </p>
    </div>
  )
}

function FormField({
  label,
  optional,
  hint,
  icon: Icon,
  children,
}: {
  label: string
  optional?: boolean
  hint?: string
  icon?: React.ElementType
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="mb-0 flex items-center gap-1.5 text-[13px] font-medium text-slate-700">
          {Icon && <Icon className="h-3.5 w-3.5 text-slate-400" strokeWidth={2} />}
          {label}
          {optional && (
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-normal text-slate-400">选填</span>
          )}
        </Label>
        {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function PasswordField({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  const [showPwd, setShowPwd] = useState(false)
  return (
    <div className="relative">
      <Input
        type={showPwd ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(USER_MODAL_INPUT_CLASS, "pr-10")}
      />
      <button
        type="button"
        onClick={() => setShowPwd(!showPwd)}
        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        aria-label={showPwd ? "隐藏密码" : "显示密码"}
      >
        {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  )
}

function RolePicker({
  value,
  onChange,
  disabled,
}: {
  value: "user" | "admin"
  onChange: (v: "user" | "admin") => void
  disabled?: boolean
}) {
  const options: { value: "user" | "admin"; label: string; desc: string; icon: React.ElementType }[] = [
    { value: "user", label: "用户", desc: "日常操作权限", icon: User },
    { value: "admin", label: "管理员", desc: "完整管理权限", icon: Shield },
  ]
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {options.map((opt) => {
        const selected = value === opt.value
        const Icon = opt.icon
        return (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              "flex flex-col items-start gap-1 rounded-xl border px-3.5 py-3 text-left transition-all",
              "disabled:cursor-not-allowed disabled:opacity-50",
              selected
                ? "border-orange-300 bg-orange-50/80 shadow-sm ring-2 ring-orange-500/15"
                : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/80",
            )}
          >
            <div className="flex w-full items-center gap-2">
              <Icon className={cn("h-4 w-4", selected ? "text-orange-600" : "text-slate-400")} strokeWidth={2} />
              <span className={cn("text-sm font-medium", selected ? "text-orange-900" : "text-slate-700")}>
                {opt.label}
              </span>
            </div>
            <span className="text-[11px] leading-snug text-slate-400">{opt.desc}</span>
          </button>
        )
      })}
    </div>
  )
}

function UserModalFooter({
  onCancel,
  submitLabel,
  loadingLabel,
  loading,
}: {
  onCancel: () => void
  submitLabel: string
  loadingLabel: string
  loading: boolean
}) {
  return (
    <DialogFooter className="mt-0 flex-row gap-2.5 border-t border-slate-100 bg-slate-50/60 px-6 py-4 sm:justify-end">
      <Button type="button" variant="outline" size="md" onClick={onCancel} className="min-w-[88px] border-slate-200 bg-white">
        取消
      </Button>
      <Button type="submit" size="md" disabled={loading} className="shadow-sm">
        <span className="inline-grid place-items-center">
          <span className={cn("col-start-1 row-start-1", loading && "invisible")}>{submitLabel}</span>
          <span className={cn("col-start-1 row-start-1 inline-flex items-center gap-2", !loading && "invisible")}>
            <Loader2 size={14} className="animate-spin" />
            {loadingLabel}
          </span>
        </span>
      </Button>
    </DialogFooter>
  )
}

/* ── 新建用户弹窗 ── */
function CreateUserModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [username, setUsername] = useState("")
  const [phone, setPhone] = useState("")
  const [password, setPassword] = useState("")
  const [role, setRole] = useState<"user" | "admin">("user")
  const [loading, setLoading] = useState(false)

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    const usernameError = validateUsername(username)
    if (usernameError) {
      toast.error(usernameError)
      return
    }
    if (password.length < 8) {
      toast.error("密码至少需要 8 位")
      return
    }
    setLoading(true)
    try {
      await createUser({
        username: username.trim(),
        password,
        role,
        ...(phone.trim() ? { phone: phone.trim() } : {}),
      })
      onCreated()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "创建失败")
    } finally {
      setLoading(false)
    }
  }

  return (
    <UserModalShell open={open} onClose={onClose}>
      <UserModalHeader
        icon={UserPlus}
        title="新增用户"
        description="创建系统操作员账号并分配角色权限"
      />
      <form onSubmit={handleCreate}>
        <div className="space-y-4 px-6 pb-5">
          <FormField label="用户名" icon={User} hint={USERNAME_HINT}>
            <Input
              value={username}
              onChange={(e) => setUsername(sanitizeUsernameInput(e.target.value))}
              placeholder="请输入用户名"
              maxLength={USERNAME_MAX_LEN}
              autoComplete="off"
              spellCheck={false}
              className={USER_MODAL_INPUT_CLASS}
              autoFocus
            />
          </FormField>
          <FormField label="手机号" optional icon={Phone}>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
              placeholder="11 位手机号码"
              inputMode="numeric"
              maxLength={11}
              className={USER_MODAL_INPUT_CLASS}
            />
          </FormField>
          <FormField label="登录密码" icon={KeyRound}>
            <PasswordField value={password} onChange={setPassword} placeholder="至少 8 位字符" />
          </FormField>
          <FormField label="系统角色">
            <RolePicker value={role} onChange={setRole} />
          </FormField>
        </div>
        <UserModalFooter onCancel={onClose} submitLabel="确认创建" loadingLabel="创建中..." loading={loading} />
      </form>
    </UserModalShell>
  )
}

/* ── 编辑用户弹窗 ── */
function EditUserModal({ user, open, onClose, onUpdated }: { user: AdminUserInfo; open: boolean; onClose: () => void; onUpdated: () => void }) {
  const [phone, setPhone] = useState(user.phone ?? "")
  const [password, setPassword] = useState("")
  const [role, setRole] = useState<"user" | "admin">(user.role)
  const [loading, setLoading] = useState(false)
  const currentUser = getAuthUser()
  const isSelf = user.uid === currentUser?.uid

  useEffect(() => {
    setPhone(user.phone ?? "")
    setRole(user.role)
    setPassword("")
  }, [user.uid, user.phone, user.role])

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password && password.length < 8) {
      toast.error("密码至少需要 8 位")
      return
    }
    setLoading(true)
    try {
      const body: { password?: string; role?: "user" | "admin"; phone?: string } = {}
      if (password) body.password = password
      if (!isSelf && role !== user.role) body.role = role
      const trimmedPhone = phone.trim()
      if (trimmedPhone !== (user.phone ?? "")) body.phone = trimmedPhone
      if (Object.keys(body).length === 0) {
        toast.error("没有需要保存的修改")
        setLoading(false)
        return
      }
      await updateUser(user.uid, body)
      if (isSelf) {
        const current = getAuthUser()
        if (current) {
          setAuthUser({
            ...current,
            phone: trimmedPhone || undefined,
          })
        }
      }
      onUpdated()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "修改失败")
    } finally {
      setLoading(false)
    }
  }

  return (
    <UserModalShell open={open} onClose={onClose}>
      <UserModalHeader
        icon={UserCog}
        title="编辑用户"
        description={isSelf ? "修改您的手机号或登录密码" : "修改联系方式、密码或角色权限"}
      />
      <UserProfileStrip user={user} />
      <form onSubmit={handleUpdate}>
        <div className="space-y-4 px-6 pb-5 pt-2">
          <FormField label="手机号" optional icon={Phone}>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
              placeholder="11 位手机号码"
              inputMode="numeric"
              maxLength={11}
              className={USER_MODAL_INPUT_CLASS}
            />
          </FormField>
          <FormField label="重置密码" hint="留空则不修改" icon={KeyRound}>
            <PasswordField value={password} onChange={setPassword} placeholder="至少 8 位，留空则不修改" />
          </FormField>
          {!isSelf && (
            <FormField label="系统角色">
              <RolePicker value={role} onChange={setRole} />
            </FormField>
          )}
        </div>
        <UserModalFooter onCancel={onClose} submitLabel="保存修改" loadingLabel="保存中..." loading={loading} />
      </form>
    </UserModalShell>
  )
}

/* ── 删除确认弹窗 ── */
function DeleteConfirmModal({ user, open, onClose, onDeleted }: { user: AdminUserInfo | null; open: boolean; onClose: () => void; onDeleted: () => void }) {
  const [loading, setLoading] = useState(false)

  const handleDelete = async () => {
    if (!user) return
    setLoading(true)
    try {
      await deleteUser(user.uid)
      onDeleted()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败")
    } finally {
      setLoading(false)
    }
  }

  const hasAccounts = (user?.accountCount ?? 0) > 0

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>确认删除</DialogTitle></DialogHeader>
        {hasAccounts ? (
          <div className="text-sm text-slate-500 space-y-2">
            <p>
              用户 <span className="text-slate-900 font-medium">{user?.username}</span> 仍绑定{" "}
              <span className="text-slate-900 font-medium">{user?.accountCount}</span> 个发布账号。
            </p>
            <p>确认删除后，这些账号绑定将一并解除，且无法恢复。是否继续？</p>
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            确定要删除用户 <span className="text-slate-900 font-medium">{user?.username}</span> 吗？此操作不可撤销。
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="destructive" onClick={handleDelete} disabled={loading} className="min-w-[96px]">
            <span className="inline-grid place-items-center">
              <span className={cn("col-start-1 row-start-1", loading && "invisible")}>确认删除</span>
              <span className={cn("col-start-1 row-start-1 inline-flex items-center gap-2", !loading && "invisible")}>
                <Loader2 size={14} className="animate-spin" />
                删除中...
              </span>
            </span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
