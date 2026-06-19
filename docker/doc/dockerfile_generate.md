# Dockerfile 部署文档

> 基于 `start_all.sh` 构建的生产环境 Docker 镜像，基础镜像为 `ubuntu:24.04`。

## 文件清单

```
/home/main-repo/docker/
├── Dockerfile              # 两阶段构建镜像
├── docker-entrypoint.sh    # 容器入口脚本
├── .dockerignore           # 构建排除规则
└── doc/
    └── dockerfile_generate.md   # 本文档
```

---

## 一、架构概览

镜像内以 `root` 用户运行，按 `start_all.sh` 的模块划分顺序启动 9 个服务：

| 模块 | 服务 | 端口 | 说明 |
|---|---|---|---|
| 大模块1 | Skills Register | 18090 | 写作风格仓库 |
| 大模块1 | AI Provider | 18180 | API Key 钱包 |
| 大模块1 | Session Manager | 18080 | 会话管家 |
| 大模块2 | A1 Account Vault | 8084 | 账号凭证加密 |
| 大模块2 | Workflow Engine | 9100 | 发布工作流 |
| 大模块3 | Dashboard | 8083 | 看板查询 |
| 大模块4 | Interval Scheduler | 9104 | 定时调度器 |
| 大模块5 | **BFF Gateway** | **8088** | **后端统一入口** |
| 大模块6 | **Frontend (Next.js)** | **3000** | **前端 UI** |

- 所有服务间通信走容器内 `localhost`，无需额外网络配置。

---

## 二、暴露端口

Dockerfile 中通过 `EXPOSE` 明确声明：

```
EXPOSE 8088   # BFF Gateway — 后端统一 API 入口
EXPOSE 3000   # Frontend — Next.js 前端 UI
```

---

## 三、持久化目录

三个目录需通过 `-v` 或 Docker Volume 映射到宿主机，防止容器重建后数据丢失：

| 容器路径 | 持久化内容 | 说明 |
|---|---|---|
| `/tmp/sm_demo` | 小说章节文件、`opencode_config.json`、`stopped_tasks.json`、skills 目录 | 小说输出根目录 |
| `/var/lib/mysql` | 所有业务数据库表（`xlongxia`、`claw_studios`） | 用户数据、发布任务、账号凭证 |
| `/tmp/logs` | 各服务运行日志 | 调试排查用 |

> 业务表清单（位于 MySQL 中）：
> - `xlongxia.a1_credentials` — 平台账号凭证
> - `claw_studios.auto_publish_task` — 自动发布任务
> - `claw_studios.*` — 其他增量迁移表

---

## 四、环境变量

所有变量在 Dockerfile 中已设默认值，可通过 `docker run -e` 覆盖。

### 必填

| 变量 | 说明 |
|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥，无此 Key AI 写稿功能完全不可用 |

### 数据库

| 变量 | 默认值 |
|---|---|
| `MYSQL_ROOT_PASSWORD` | `claw123` |
| `MYSQL_HOST` | `127.0.0.1` |
| `MYSQL_PORT` | `3306` |
| `A1_DB_DSN` | `xlongxia:Xlongxia_123@tcp(127.0.0.1:3306)/xlongxia?parseTime=true` |
| `DB_DSN` | `root:claw123@tcp(127.0.0.1:3306)/claw_studios?...` |

### 安全（生产环境务必覆盖默认值）

| 变量 | 默认值 |
|---|---|
| `A1_ENCRYPTION_KEY` | `eLvMeGfepGpOUw280t7dvJTf+dkVAWn5B5dLOA4rMjk=` |
| `A1_MOCK_ENCRYPTION_KEY` | 同上 |
| `A1_JWT_SECRET` | `not-default-secret-change-me` |
| `JWT_SECRET` | `not-default-secret-change-me` |

### 服务端口

| 变量 | 默认值 |
|---|---|
| `PORT` | `8088` |
| `FE_PORT` | `3000` |

---

## 五、构建与运行

### 构建

```bash
cd /home/main-repo
docker build -f docker/Dockerfile -t main-repo:prod .
```

### 运行（完整模式，内建 MySQL）

```bash
docker run -d \
  --name main-repo \
  -p 8088:8088 \
  -p 3000:3000 \
  -v /data/sm_demo:/tmp/sm_demo \
  -v /data/mysql:/var/lib/mysql \
  -v /data/logs:/tmp/logs \
  -e DEEPSEEK_API_KEY=sk-xxxxxxxx \
  -e JWT_SECRET=your-production-secret \
  -e A1_JWT_SECRET=your-production-secret \
  -e A1_ENCRYPTION_KEY=your-encryption-key \
  main-repo:prod
```

### 运行（连接外部 MySQL）

如需使用外部 MySQL，启动时可覆写连接信息并跳过容器内 MySQL 初始化：

```bash
docker run -d \
  --name main-repo \
  -p 8088:8088 \
  -p 3000:3000 \
  -v /data/sm_demo:/tmp/sm_demo \
  -v /data/logs:/tmp/logs \
  -e MYSQL_HOST=192.168.1.100 \
  -e MYSQL_PORT=3306 \
  -e MYSQL_ROOT_PASSWORD=your_password \
  -e A1_DB_DSN="xlongxia:Xlongxia_123@tcp(192.168.1.100:3306)/xlongxia?parseTime=true" \
  -e DB_DSN="root:your_password@tcp(192.168.1.100:3306)/claw_studios?parseTime=true&charset=utf8mb4" \
  -e DEEPSEEK_API_KEY=sk-xxxxxxxx \
  main-repo:prod
```

> 外部 MySQL 需预先执行 `schema_xlongxia.sql`、`schema_claw_studios.sql` 及 `migrations/*.sql` 完成初始化。

### 健康检查

镜像内置 `HEALTHCHECK`，每 30 秒访问 `http://localhost:8088/healthz`：

```bash
docker ps   # STATUS 列显示 (healthy) 即所有服务正常
```

---

## 六、构建流程（Dockerfile 内部）

### Stage 1: Build

```text
ubuntu:24.04
  ├── 安装 curl, ca-certificates, git, xz-utils, build-essential
  ├── 安装 Go 1.25.2
  ├── 安装 Node.js 22 LTS
  ├── COPY 源码到 /app
  ├── 修正 go.mod 中 replace 路径 (/home/main-repo → /app)
  ├── go mod download（所有模块）
  ├── go build（9 个二进制文件）
  └── npm install && npm run build（Next.js 生产构建）
```

### Stage 2: Runtime

```text
ubuntu:24.04
  ├── 安装 mysql-server, mysql-client
  ├── 安装 Node.js 22 LTS, opencode
  ├── 安装 curl, ca-certificates, git, psmisc, python3
  ├── COPY --from=build（二进制 + .next + node_modules + 静态资源 + schema/migrations）
  ├── COPY docker-entrypoint.sh
  ├── EXPOSE 8088 3000
  └── ENTRYPOINT [docker-entrypoint.sh]
```

---

## 七、注意事项

1. `keys.json` 和 `config.json` 已 baked 进镜像。如需更新 API Key，建议通过 Volume 挂载覆盖：
   ```bash
   -v /path/to/keys.json:/app/L1_AI_Provider/config/keys.json
   -v /path/to/config.json:/app/L1_novel_skill/config.json
   ```

2. 默认 `JWT_SECRET` 和 `A1_ENCRYPTION_KEY` 为演示值，**生产环境务必生成随机密钥**。

3. 初次启动需等待 MySQL 初始化 + 全部服务启动，约 60-120 秒，可通过 `docker logs -f main-repo` 观察进度。

4. 容器以 `root` 运行（与 `start_all.sh` 要求的 `admin` 用户不同，Docker 环境下无影响）。
