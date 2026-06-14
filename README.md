# Claw Studios — 全模块工程

本项目采用 Git Subtree 管理各个独立子模块，所有代码已直接包含在主仓库中，克隆即可使用。

## 快速开始

### 1. 环境要求

| 依赖 | 版本要求 | 说明 |
|------|---------|------|
| Go | 1.21+ | 编译 8 个 Go 后端服务（需手动安装） |
| Node.js + npm | 18+ | 编译 Next.js 前端（脚本会自动安装） |
| opencode CLI | 最新版 | AI 写作引擎（脚本会自动安装） |
| MySQL | 8.0+ | 数据库（脚本会自动安装并配置） |
| Python 3 | 3.6+ | 封面生成脚本（可选，脚本不自动安装） |
| pillow (PIL) | - | Python 图片处理库（可选）

**仅需手动安装 Go**，其余依赖均由脚本自动检测并安装。

### 2. 必须配置（缺一不可）

#### 2.1 DeepSeek API Key

```bash
export TEAM_DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxx
```

获取方式: 登录 [DeepSeek 开放平台](https://platform.deepseek.com)，在 API Keys 页面创建。

> 不设置此变量，AI 写稿功能将不可用。

#### 2.2 AI Provider API Key 配置文件

在 `L1_AI_Provider/config/` 目录下创建 `keys.json`：

```json
{
  "deepseek": ["sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"]
}
```

> 这是 AI Provider 的 API Key 钱包，支持多 key 轮转。不配置则无法调用 AI 模型。

#### 2.3 数据库

确保 MySQL 已启动，root 密码为 `claw123`（如需修改，见下方环境变量章节）。

启动脚本会自动创建数据库和表结构，无需手动建库。

#### 2.4 混元生图 Key（可选，影响封面生成）

如果你需要使用小说封面自动生成功能，在 `L1_novel_skill/` 目录下创建 `config.json`：

```json
{
  "tencent_secret_id": "AKIDxxxxxxxxxxxxxxxx",
  "tencent_secret_key": "xxxxxxxxxxxxxxxxxxxx"
}
```

获取方式:
1. 登录 [腾讯云控制台](https://console.cloud.tencent.com/cam/capi) 获取 SecretId / SecretKey
2. 前往 [https://buy.cloud.tencent.com/aiart](https://buy.cloud.tencent.com/aiart) 购买「腾讯混元生图极速版」
3. 在 [AI 绘画控制台](https://console.cloud.tencent.com/aiart) 确认已开通 **TextToImageLite** 服务

> 不配置不影响其他功能，仅封面生成不可用。

### 3. 启动所有服务

```bash
# 必须以 root 权限执行（脚本会自动提权）
sudo bash start_all.sh
# 或者直接用 root 用户执行
```

启动脚本会自动完成：
1. **自动提权到 root**（如果不是 root）
2. **自动安装 MySQL**（如果未安装）并启动服务
3. **自动配置 MySQL root 密码**（默认 `claw123`，可通过 `MYSQL_ROOT_PASSWORD` 覆盖）
4. **自动安装 opencode**（如果未安装，含 Node.js/npm 依赖）
5. 清理旧进程
6. 检查前置条件（TEAM_DEEPSEEK_API_KEY、keys.json、config.json 等）
7. 初始化数据库（自动建库建表，已存在则跳过）
8. 编译所有 Go 模块 + 前端
9. 按顺序启动 9 个服务并健康检查

### 4. 服务端口对照

| 端口 | 服务 | 说明 |
|------|------|------|
| 18080 | Session Manager | AI 会话生命周期管理 |
| 18090 | Skills Register | 写作风格/Skill 仓库管理 |
| 18180 | AI Provider | AI API Key 钱包与调用代理 |
| 8083 | Dashboard | 发布看板与数据查询 |
| 8084 | A1 Account Vault | 平台账号凭证加密存储 |
| 8088 | BFF Gateway | 前端统一 API 入口 |
| 9100 | Workflow Engine | 发布工作流引擎 |
| 9104 | Interval Scheduler | 定时调度器 |
| 3000 | Frontend | Next.js 前端UI |

前端入口: http://localhost:3000  
API 统一入口: http://localhost:8088

---

## 常见问题

### MySQL root 密码不是 claw123

设置环境变量后启动：
```bash
export MYSQL_ROOT_PASSWORD=你的密码
bash start_all.sh
```

如果 xlongxia 和 claw_studios 数据库的密码也不同，还需要设置：
```bash
export A1_DB_DSN="xlongxia:你的密码@tcp(127.0.0.1:3306)/xlongxia?parseTime=true"
export DB_DSN="root:你的密码@tcp(127.0.0.1:3306)/claw_studios?parseTime=true&charset=utf8mb4"
```

### opencode 未安装

```bash
npm install -g @anthropic/opencode
# 验证:
opencode --version
```

### Go 版本过低

需要 Go 1.21+。某些模块需要 1.24+。建议使用最新 Go：
```bash
# 通过 gvm 管理版本
bash < <(curl -s -S -L https://raw.githubusercontent.com/moovweb/gvm/master/binscripts/gvm-installer)
gvm install go1.24
gvm use go1.24
```

### 端口被占用

启动前脚本会自动 pkill 旧进程。如果仍被占用，手动清理：
```bash
lsof -i :8088 -i :8083 -i :8084 -i :9100 -i :9104 -i :18080 -i :18090 -i :18180 -i :3000
```

### `sudo: a password is required`

如果当前用户不在 sudoers 中，可以通过环境变量强制以当前用户运行：
```bash
export RUN_USER=$(whoami)
bash start_all.sh
```

### 远程访问前端

编辑 `Front_design/.env.local`，将 `localhost` 改为服务器 IP：
```
NEXT_PUBLIC_API_BASE=http://你的服务器IP:8088
NEXT_PUBLIC_WS_BASE=ws://你的服务器IP:8088
```

### pip install Pillow

```bash
pip3 install Pillow
```

## 目录结构与用途

| 目录 | 用途 | 备注 |
|------|------|------|
| `Front_design/` | Next.js 前端管理界面 | Web UI，任务管理、账号绑定等 |
| `L0_AI_Account_Secret_Vault/` | A1 账号凭证加密保险库 | 存储/加密平台账号 Cookie，提供凭证 API |
| `L1_AI_Dashboard/` | 发布看板后端 | 提供发布状态的 Dashboard 查询 |
| `L1_AI_Doc_Hub/` | 文档管理中心 | 文档/作品存储与索引 |
| `L1_AI_Provider/` | AI API Key 钱包 | 管理多 Key 轮转，对外提供统一 AI 调用接口 |
| `L1_AI_Releaser/` | 内容发布器 | 将小说内容发布到各平台（番茄/七猫等） |
| `L1_novel_skill/` | 小说灰度改写元技能 | AI Skill：将公版小说转化为可量产长篇新作的 Skill |
| `L1_novel_cover_png/` | 小说封面文字渲染器 | 纯 Go 实现，给封面图添加标题/作者文字 |
| `L1_opencode/` | OpenCode 配置与 Skill | OpenCode AI 编程助手的自定义 Skill |
| `L1_skills_register/` | Skill 注册中心 | 管理所有 Skill 的注册、查询、实例化 |
| `L2_AI_Interval/` | 定时调度器 | 根据 cron 表达式定时触发发布任务 |
| `L2_AI_Workflow_Engine/` | 发布工作流引擎 | 管理发布流水线：生成→转MD→发布 |
| `L2_conversion_manager/` | 会话管理器 | AI 写作会话生命周期管理 |
| `L3_AI_BFF/` | BFF 网关 | 前端统一 API 入口，聚合后端各服务 |
| `pkg/` | 共享库 | 统一日志、工具函数 |
| `migrations/` | 数据库迁移脚本 | 增量 DDL 变更（初次部署使用 schema_*.sql） |
| `fanqie-account-manager/` | 番茄账号管家 Chrome 扩展 | 浏览器扩展，半自动抓取番茄小说 Cookie 并填入管理平台 |
| `frontend/` | 前端元数据 | 前端配置与路由元信息 |

### fanqie-account-manager 说明

这是一个 **Chrome 浏览器扩展**，用于辅助用户登录番茄小说平台并自动抓取 Cookie。它不是服务端组件，无需 `start_all.sh` 启动。

安装方式：Chrome → `chrome://extensions/` → 开发者模式 → 加载已解压的扩展程序 → 选择 `fanqie-account-manager/extension/`

---

## 环境变量参考

启动脚本支持以下环境变量覆盖默认值：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `TEAM_DEEPSEEK_API_KEY` | (空) | DeepSeek API Key，**必须设置** |
| `RUN_USER` | (当前用户) | 运行服务的系统用户，默认自动检测 |
| `A1_DB_DSN` | `xlongxia:Xlongxia_123@tcp(127.0.0.1:3306)/xlongxia?parseTime=true` | xlongxia 数据库连接串 |
| `A1_ENCRYPTION_KEY` | (内置) | 凭证加密密钥，生产环境请更换 |
| `A1_JWT_SECRET` | `not-default-secret-change-me` | JWT 签名密钥，**生产环境必须更换** |
| `DB_DSN` | `root:claw123@tcp(127.0.0.1:3306)/claw_studios?...` | claw_studios 数据库连接串 |
| `MYSQL_ROOT_USER` | `root` | MySQL root 用户名（建库用） |
| `MYSQL_ROOT_PASSWORD` | `claw123` | MySQL root 密码（建库用） |
| `MYSQL_HOST` | `127.0.0.1` | MySQL 主机地址 |
| `MYSQL_PORT` | `3306` | MySQL 端口 |
| `PORT` | `8088` | BFF 网关端口 |

完整环境变量列表见 `start_all.sh` 脚本头部。

---

## Git Subtree 管理

本项目采用 Git Subtree 管理子模块。各子模块均有自己的公开 GitHub 仓库：

| 模块 | GitHub 仓库 |
|------|------------|
| fanqie-account-manager | https://github.com/mengpingzeng/fanqie-account-manager |
| Front_design | https://github.com/mengpingzeng/Front_design |
| frontend | https://github.com/mengpingzeng/frontend |
| L0_AI_Account_Secret_Vault | https://github.com/mengpingzeng/L0_AI_Account_Secret_Vault |
| L1_AI_Dashboard | https://github.com/mengpingzeng/L1_AI_Dashboard |
| L1_AI_Doc_Hub | https://github.com/mengpingzeng/L1_AI_Doc_Hub |
| L1_AI_Provider | https://github.com/mengpingzeng/L1_AI_Provider |
| L1_AI_Releaser | https://github.com/mengpingzeng/L1_AI_Releaser |
| L1_opencode | https://github.com/mengpingzeng/L1_opencode |
| L1_skills_register | https://github.com/mengpingzeng/L1_skills_register |
| L2_AI_Interval | https://github.com/mengpingzeng/L2_AI_Interval |
| L2_AI_Workflow_Engine | https://github.com/mengpingzeng/L2_AI_Workflow_Engine |
| L2_conversion_manager | https://github.com/mengpingzeng/L2_conversion_manager |
| L3_AI_BFF | https://github.com/mengpingzeng/L3_AI_BFF |
| migrations | https://github.com/mengpingzeng/migrations |
| L1_novel_skill | 本地仓库 |
| L1_novel_cover_png | 本地仓库（内置于本仓库） |
| pkg | 本地仓库（共享 logging 库） |

### 更新子模块

```bash
# 在独立仓库修改并推送后，拉入主仓库
git fetch git@github.com:mengpingzeng/<repo>.git main
git read-tree --prefix=<repo>/ -u FETCH_HEAD
git commit -m "sync: update <repo> subtree"
```
