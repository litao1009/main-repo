import type { DriveStep } from "driver.js"
import type { TourId } from "../storage"

export interface TourDefinition {
  id: TourId
  steps: DriveStep[]
}

function el(selector: string): Element | null {
  if (typeof document === "undefined") return null
  return document.querySelector(selector)
}

export function buildAdminUsersTour(): TourDefinition {
  const steps: DriveStep[] = [
    {
      element: '[data-tour="admin-invite"]',
      popover: {
        title: "邀请新用户",
        description: "点击此处创建操作员账号，分配用户名与初始密码，新用户即可登录使用。",
        side: "bottom",
        align: "end",
      },
    },
  ]

  if (el('[data-tour="admin-edit"]')) {
    steps.push({
      element: '[data-tour="admin-edit"]',
      popover: {
        title: "编辑用户",
        description: "可修改用户信息、重置密码、调整系统角色。",
        side: "left",
        align: "center",
      },
    })
  } else if (el('[data-tour="admin-actions-header"]')) {
    steps.push({
      element: '[data-tour="admin-actions-header"]',
      popover: {
        title: "编辑用户",
        description: "列表「操作」列中，「编辑」可修改其他用户的信息、密码与角色。",
        side: "bottom",
        align: "end",
      },
    })
  }

  if (el('[data-tour="admin-delete"]')) {
    steps.push({
      element: '[data-tour="admin-delete"]',
      popover: {
        title: "删除用户",
        description: "将永久移除该用户及其账号绑定，不可恢复。不能删除当前登录账号。",
        side: "left",
        align: "center",
      },
    })
  } else if (el('[data-tour="admin-actions-header"]') && !el('[data-tour="admin-edit"]')) {
    steps.push({
      element: '[data-tour="admin-actions-header"]',
      popover: {
        title: "删除用户",
        description: "「删除」将永久移除用户及其绑定账号。当前登录账号不可删除。",
        side: "bottom",
        align: "end",
      },
    })
  }

  return { id: "adminUsers", steps }
}

export function buildAccountsTour(): TourDefinition {
  const steps: DriveStep[] = [
    {
      element: '[data-tour="accounts-bind"]',
      popover: {
        title: "绑定新账号",
        description: "选择平台后在新窗口完成登录，绑定成功后可在创建任务时选用该账号分发内容。",
        side: "bottom",
        align: "end",
      },
    },
  ]

  if (el('[data-tour="accounts-verify"]')) {
    steps.push({
      element: '[data-tour="accounts-verify"]',
      popover: {
        title: "去实名",
        description: "部分平台发布前需完成实名认证。点击后将在弹出窗口打开平台实名页。",
        side: "bottom",
        align: "start",
      },
    })
  }

  if (el('[data-tour="accounts-open-platform"]')) {
    steps.push({
      element: '[data-tour="accounts-open-platform"]',
      popover: {
        title: "打开平台后台",
        description: "圆形按钮可注入 Cookie 后快捷打开对应平台作家中心，便于管理作品与查看数据。",
        side: "left",
        align: "center",
      },
    })
  }

  return { id: "accounts", steps }
}

export function buildNewTaskTour(): TourDefinition {
  return {
    id: "newTask",
    steps: [
      {
        element: '[data-tour="new-task-platform"]',
        popover: {
          title: "发布平台",
          description: "先选择目标平台（番茄/七猫/逐浪），决定后续可用账号与创作方案。",
          side: "bottom",
          align: "start",
        },
      },
      {
        element: '[data-tour="new-task-account"]',
        popover: {
          title: "发布账号",
          description: "选择已绑定且 Cookie 有效的账号。若无可用账号，请先到「账号配置」绑定。",
          side: "bottom",
          align: "start",
        },
      },
      {
        element: '[data-tour="new-task-model"]',
        popover: {
          title: "AI 模型",
          description: "选择本次创作使用的 AI 模型。",
          side: "bottom",
          align: "start",
        },
      },
      {
        element: '[data-tour="new-task-skill"]',
        popover: {
          title: "创作小说",
          description: "选择创作方案（小说类型），决定 AI 写作风格与封面。",
          side: "top",
          align: "start",
        },
      },
      {
        element: '[data-tour="new-task-submit"]',
        popover: {
          title: "创建任务",
          description: "确认配置后点击创建，系统将自动创建任务并加入发布队列，随后进入任务详情页。",
          side: "top",
          align: "end",
        },
      },
    ],
  }
}

export function buildTaskListTour(): TourDefinition {
  const steps: DriveStep[] = [
    {
      element: '[data-tour="task-list-search"]',
      popover: {
        title: "搜索任务",
        description: "按小说名搜索历史创作任务，快速定位作品。",
        side: "bottom",
        align: "start",
      },
    },
    {
      element: '[data-tour="task-list-create"]',
      popover: {
        title: "新建创作",
        description: "点击此处进入新建任务页，开始新的 AI 创作。",
        side: "bottom",
        align: "end",
      },
    },
  ]

  if (el('[data-tour="task-list-card"]')) {
    steps.push({
      element: '[data-tour="task-list-card"]',
      popover: {
        title: "任务卡片",
        description: "卡片展示平台、自动发布状态与章节进度。点击进入详情继续跟进创作与发布。",
        side: "top",
        align: "start",
      },
    })
  } else {
    steps.push({
      element: '[data-tour="task-list-header"]',
      popover: {
        title: "任务列表",
        description: "创建第一个任务后，会在这里以卡片形式展示。点击卡片可进入详情页。",
        side: "bottom",
        align: "start",
      },
    })
  }

  return { id: "taskList", steps }
}

export function buildTaskDetailTour(): TourDefinition {
  const steps: DriveStep[] = []

  if (el('[data-tour="task-detail-publish-toggle"]')) {
    steps.push({
      element: '[data-tour="task-detail-publish-toggle"]',
      popover: {
        title: "自动发布开关",
        description: "「运行中」时系统会自动生成并发布章节；「已暂停」后不会继续生成新章节。",
        side: "bottom",
        align: "end",
      },
    })
  }

  if (el('[data-tour="task-detail-publish-status"]')) {
    steps.push({
      element: '[data-tour="task-detail-publish-status"]',
      popover: {
        title: "发布状态",
        description: "查看当前排队位置、运行状态或错误信息，便于了解自动发布进度。",
        side: "bottom",
        align: "start",
      },
    })
  }

  steps.push(
    {
      element: '[data-tour="task-detail-chapters"]',
      popover: {
        title: "卷章目录",
        description: "按卷浏览章节列表，徽标区分已发布与草稿状态。点击章节可查看正文。",
        side: "right",
        align: "start",
      },
    },
    {
      element: '[data-tour="task-detail-content"]',
      popover: {
        title: "章节正文",
        description: "选中章节后，在此区域查看 AI 生成的正文内容。",
        side: "left",
        align: "start",
      },
    },
  )

  return { id: "taskDetail", steps }
}

export function resolveTourId(pathname: string): TourId | null {
  if (pathname === "/admin/users") return "adminUsers"
  if (pathname === "/accounts") return "accounts"
  if (pathname === "/tasks/new") return "newTask"
  if (pathname === "/tasks") return "taskList"
  if (/^\/tasks\/[^/]+$/.test(pathname)) return "taskDetail"
  return null
}

export function buildTour(tourId: TourId): TourDefinition | null {
  switch (tourId) {
    case "adminUsers": return buildAdminUsersTour()
    case "accounts": return buildAccountsTour()
    case "newTask": return buildNewTaskTour()
    case "taskList": return buildTaskListTour()
    case "taskDetail": return buildTaskDetailTour()
    default: return null
  }
}

export function filterReadySteps(steps: DriveStep[]): DriveStep[] {
  return steps.filter((step) => {
    if (!step.element || typeof step.element !== "string") return false
    return !!document.querySelector(step.element)
  })
}
