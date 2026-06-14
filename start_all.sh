#!/usr/bin/env bash
# ============================================================
#  全模块后端 + 前端服务启动脚本 (main-repo 版本)
#  用法: bash start_all.sh
#  要求: 在 main-repo 根目录下执行
# ============================================================
set -euo pipefail

# ========== 路径常量（相对于脚本所在目录） ==========
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SR_DIR="$SCRIPT_DIR/L1_skills_register"
AP_DIR="$SCRIPT_DIR/L1_AI_Provider"
SM_DIR="$SCRIPT_DIR/L2_conversion_manager"
A1_DIR="$SCRIPT_DIR/L0_AI_Account_Secret_Vault"
DB_DIR="$SCRIPT_DIR/L1_AI_Dashboard"
WF_DIR="$SCRIPT_DIR/L2_AI_Workflow_Engine"
SCHEDULER_DIR="$SCRIPT_DIR/L2_AI_Interval"
BFF_DIR="$SCRIPT_DIR/L3_AI_BFF"
FE_DIR="$SCRIPT_DIR/Front_design"
COVER_DIR="$SCRIPT_DIR/L1_novel_cover_png"
MIGRATIONS_DIR="$SCRIPT_DIR/migrations"

DATA_DIR="/tmp/sm_demo"
LOG_DIR="/tmp/logs"

# ========== 环境变量（可覆盖） ==========
export A1_DB_DSN="${A1_DB_DSN:-xlongxia:Xlongxia_123@tcp(127.0.0.1:3306)/xlongxia?parseTime=true}"
export C2_DB_DSN="${C2_DB_DSN:-$A1_DB_DSN}"
export WF_DB_DSN="${WF_DB_DSN:-$A1_DB_DSN}"
export A1_ENCRYPTION_KEY="${A1_ENCRYPTION_KEY:-eLvMeGfepGpOUw280t7dvJTf+dkVAWn5B5dLOA4rMjk=}"
export A1_MOCK_ENCRYPTION_KEY="${A1_MOCK_ENCRYPTION_KEY:-$A1_ENCRYPTION_KEY}"
export A1_DB_USER="${A1_DB_USER:-xlongxia}"
export A1_DB_PASSWORD="${A1_DB_PASSWORD:-Xlongxia_123}"
export A1_DB_HOST="${A1_DB_HOST:-127.0.0.1}"
export A1_DB_NAME="${A1_DB_NAME:-xlongxia}"
export A1_JWT_SECRET="${A1_JWT_SECRET:-not-default-secret-change-me}"
export JWT_SECRET="${JWT_SECRET:-not-default-secret-change-me}"
export TEAM_DEEPSEEK_API_KEY="${TEAM_DEEPSEEK_API_KEY:-}"

export PORT="${PORT:-8088}"
export SESSION_MGR_URL="${SESSION_MGR_URL:-http://localhost:18080}"
export WORKFLOW_URL="${WORKFLOW_URL:-http://localhost:9100}"
export C2_DASHBOARD_URL="${C2_DASHBOARD_URL:-http://localhost:8083}"
export A1_ACCOUNT_URL="${A1_ACCOUNT_URL:-http://localhost:8084}"
export SKILL_REGISTRY_URL="${SKILL_REGISTRY_URL:-http://localhost:18090}"
export AI_MODEL_URL="${AI_MODEL_URL:-http://localhost:18180}"
export A1_BASE_URL="${A1_BASE_URL:-http://localhost:8084}"
export A4_STORAGE_DIR="${A4_STORAGE_DIR:-/tmp/sm_demo}"
export DB_DSN="${DB_DSN:-root:claw123@tcp(127.0.0.1:3306)/claw_studios?parseTime=true&charset=utf8mb4}"
export STOPPED_TASKS_FILE="${STOPPED_TASKS_FILE:-/tmp/sm_demo/stopped_tasks.json}"

# ========== 颜色 ==========
GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${CYAN}[INFO]${NC}  $1"; }
ok()   { echo -e "  ${GREEN}OK${NC}    $1"; }
fail() { echo -e "  ${RED}FAIL${NC}  $1"; }

# ========== 清理旧进程 ==========
cleanup_old() {
    log "清理旧进程..."
    sudo pkill -f run_bff.sh      2>/dev/null || true
    sudo pkill -f skill_registry   2>/dev/null || true
    sudo pkill -f ai_provider      2>/dev/null || true
    sudo pkill -f session_manager  2>/dev/null || true
    sudo pkill -f a1_server        2>/dev/null || true
    sudo pkill -f c2_dashboard     2>/dev/null || true
    sudo pkill -f workflow_engine  2>/dev/null || true
    sudo pkill -f scheduler        2>/dev/null || true
    sudo pkill -f bff-server       2>/dev/null || true
    sudo pkill -f "next dev"       2>/dev/null || true
    sudo rm -f /tmp/fe.log 2>/dev/null || true
    sleep 2
}

# ========== 前置检查 ==========
check_prereq() {
    log "前置检查..."
    if [ -z "${TEAM_DEEPSEEK_API_KEY:-}" ]; then
        fail "TEAM_DEEPSEEK_API_KEY 未设置 — AI写稿将失败"
        echo "       请设置: export TEAM_DEEPSEEK_API_KEY=sk-xxx"
    else
        ok "TEAM_DEEPSEEK_API_KEY 已设置 (长度=${#TEAM_DEEPSEEK_API_KEY})"
    fi
    if ! command -v go &>/dev/null; then
        fail "Go 未安装"
        exit 1
    fi
    if ! command -v npm &>/dev/null; then
        fail "npm 未安装"
        exit 1
    fi
    if ! command -v mysql &>/dev/null; then
        fail "mysql 客户端未安装，数据库初始化将跳过"
    fi
    if [ ! -f "$AP_DIR/config/keys.json" ]; then
        fail "L1_AI_Provider/config/keys.json 不存在 — AI Provider 将无法调用 API"
        echo "       请参考 README.md 配置 API Key"
    fi
    if [ ! -f "$SCRIPT_DIR/L1_novel_skill/config.json" ]; then
        log "提示: L1_novel_skill/config.json 不存在，封面生成将不可用"
        echo "       如需使用封面生成，请参考 README.md 配置腾讯云密钥"
    fi
}

# ========== 准备数据目录 ==========
setup_data() {
    log "准备沙箱配置..."
    mkdir -p "$DATA_DIR"
    mkdir -p "$LOG_DIR"
    sudo chown -R admin:admin "$DATA_DIR" 2>/dev/null || true
    sudo chown -R admin:admin "$LOG_DIR" 2>/dev/null || true

    if [ ! -f "$DATA_DIR/opencode_config.json" ]; then
        cat > "$DATA_DIR/opencode_config.json" << 'CONFEOF'
{"permission":{"edit":"allow","bash":"deny","write":"allow","read":"allow","external_directory":"deny","doom_loop":"allow"},"skills":{"paths":["/tmp/sm_demo/skills"]}}
CONFEOF
    fi
    ok "沙箱配置已就绪: $DATA_DIR/opencode_config.json"
}

# ========== 数据库初始化 ==========
init_database() {
    log "初始化数据库..."
    if ! command -v mysql &>/dev/null; then
        log "  mysql 未安装，跳过数据库初始化"
        return
    fi

    local db_user="root"
    local db_pass="claw123"
    local db_host="127.0.0.1"
    local db_port="3306"

    # 执行 xlongxia schema
    local xlongxia_sql="$SCRIPT_DIR/schema_xlongxia.sql"
    if [ -f "$xlongxia_sql" ]; then
        if mysql -h"$db_host" -P"$db_port" -u"$db_user" -p"$db_pass" < "$xlongxia_sql" 2>/tmp/db_err.log; then
            ok "xlongxia 数据库已初始化"
        else
            if grep -qi "already exists\|Access denied" /tmp/db_err.log 2>/dev/null; then
                log "  xlongxia 初始化跳过（数据库已存在或无权限）"
            else
                fail "xlongxia 初始化失败"
                cat /tmp/db_err.log
            fi
        fi
    fi

    # 执行 claw_studios schema
    local clawstudios_sql="$SCRIPT_DIR/schema_claw_studios.sql"
    if [ -f "$clawstudios_sql" ]; then
        if mysql -h"$db_host" -P"$db_port" -u"$db_user" -p"$db_pass" < "$clawstudios_sql" 2>/tmp/db_err.log; then
            ok "claw_studios 数据库已初始化"
        else
            if grep -qi "already exists\|Access denied" /tmp/db_err.log 2>/dev/null; then
                log "  claw_studios 初始化跳过（数据库已存在或无权限）"
            else
                fail "claw_studios 初始化失败"
                cat /tmp/db_err.log
            fi
        fi
    fi

    # 执行增量迁移
    if [ -d "$MIGRATIONS_DIR" ]; then
        for f in $(ls "$MIGRATIONS_DIR"/*.sql 2>/dev/null | sort); do
            local fname=$(basename "$f")
            if mysql -h"$db_host" -P"$db_port" -u"$db_user" -p"$db_pass" < "$f" 2>/tmp/migrate_err.log; then
                ok "migration: $fname"
            else
                if grep -qi "duplicate column\|already exists\|duplicate key\|Duplicate entry" /tmp/migrate_err.log 2>/dev/null; then
                    log "  migration $fname 已执行过，跳过"
                else
                    fail "migration: $fname"
                    cat /tmp/migrate_err.log
                fi
            fi
        done
    fi
    echo ""
}

# ========== 编译所有模块 ==========
build_all() {
    log "编译所有模块..."
    local build_failed=0

    build_one() {
        local binary="$1" dir="$2" target="$3"
        log "  编译 $binary ..."
        cd "$dir"
        if go build -o "$binary" $target 2>/tmp/build_err.log; then
            ok "$binary"
        else
            fail "$binary"
            cat /tmp/build_err.log
            build_failed=1
        fi
    }

    build_one "skill_registry"   "$SR_DIR"          "."
    build_one "ai_provider"      "$AP_DIR"           "."
    build_one "session_manager"  "$SM_DIR"           "."
    build_one "a1_server"        "$A1_DIR"           "./cmd/a1_server/"
    build_one "workflow_engine"  "$WF_DIR"           "./cmd/workflow_engine/"
    build_one "c2_dashboard"     "$DB_DIR"           "./cmd/c2_dashboard/"
    build_one "scheduler"        "$SCHEDULER_DIR"    "./cmd/scheduler/"
    build_one "bff-server"       "$BFF_DIR"          "."
    build_one "novelcover_pure"  "$COVER_DIR"        "."

    # 编译前端
    log "  编译 Frontend (Next.js) ..."
    cd "$FE_DIR"
    if npm install 2>/tmp/build_err.log && npm run build 2>>/tmp/build_err.log; then
        ok "frontend"
    else
        fail "frontend"
        cat /tmp/build_err.log
        build_failed=1
    fi

    if [ "$build_failed" -ne 0 ]; then
        echo ""
        fail "部分模块编译失败，终止启动"
        exit 1
    fi
    echo ""
}

# ============================================================
# 大模块1: 文档编写 (ailenlu 开发)
# ============================================================

start_skills_register() {
    log "启动 Skills Register (:18090)..."
    cd "$SR_DIR"
    setsid ./skill_registry --port 18090 --internal-auth="" \
        --cover-bin "$COVER_DIR/novelcover_pure" \
        --fonts-dir "$COVER_DIR/fonts" \
        > /tmp/sr.log 2>&1 &
    sleep 2
    if curl -s --max-time 3 http://127.0.0.1:18090/api/skill/status > /dev/null 2>&1; then
        ok "Skills Register :18090"
    else
        fail "Skills Register 启动失败"
    fi
}

start_ai_provider() {
    log "启动 AI Provider (:18180)..."
    cd "$AP_DIR"
    setsid ./ai_provider --port 18180 --config-path "$DATA_DIR/opencode_config.json" > /tmp/ap.log 2>&1 &
    sleep 2
    if curl -s --max-time 3 http://127.0.0.1:18180/healthz > /dev/null 2>&1; then
        ok "AI Provider :18180"
    else
        fail "AI Provider 启动失败"
    fi
}

start_session_manager() {
    log "启动 Session Manager (:18080)..."
    cd "$SM_DIR"
    sudo chown -R admin:admin "$DATA_DIR" 2>/dev/null || true
    sudo -u admin setsid ./session_manager --port 18080 --data-dir "$DATA_DIR" --max-concurrent 2 --stale-timeout-min 60 --skill-registry http://localhost:18090 > /tmp/sm.log 2>&1 &
    sleep 3
    if curl -s --max-time 3 http://127.0.0.1:18080/api/status > /dev/null 2>&1; then
        ok "Session Manager :18080"
    else
        fail "Session Manager 启动失败"
    fi
}

# ============================================================
# 大模块2: 发布沉淀 (zmp 开发)
# ============================================================

start_a1_vault() {
    log "启动 A1 Account Vault (:8084)..."
    cd "$A1_DIR"
    sudo -u admin env \
      A1_DB_DSN="$A1_DB_DSN" \
      A1_ENCRYPTION_KEY="$A1_ENCRYPTION_KEY" \
      A1_MOCK_ENCRYPTION_KEY="$A1_MOCK_ENCRYPTION_KEY" \
      A1_JWT_SECRET="$A1_JWT_SECRET" \
      A1_DB_USER="$A1_DB_USER" \
      A1_DB_PASSWORD="$A1_DB_PASSWORD" \
      A1_DB_HOST="$A1_DB_HOST" \
      A1_DB_NAME="$A1_DB_NAME" \
      setsid ./a1_server > /tmp/a1.log 2>&1 &
    sleep 3
    if curl -s --max-time 3 http://127.0.0.1:8084/healthz > /dev/null 2>&1; then
        ok "A1 Account Vault :8084"
    else
        fail "A1 Account Vault 启动失败"
    fi
}

start_workflow_engine() {
    log "启动 Workflow Engine (:9100)..."
    cd "$WF_DIR"
    sudo -u admin setsid ./workflow_engine > /tmp/wf.log 2>&1 &
    sleep 3
    if curl -s --max-time 3 http://127.0.0.1:9100/health > /dev/null 2>&1; then
        ok "Workflow Engine :9100"
    else
        fail "Workflow Engine 启动失败"
    fi
}

# ============================================================
# 大模块3: 定时调度看板 (zmp 开发)
# ============================================================

start_dashboard() {
    log "启动 Dashboard (:8083)..."
    cd "$DB_DIR"
    sudo -u admin setsid ./c2_dashboard > /tmp/c2.log 2>&1 &
    sleep 3
    if curl -s --max-time 3 http://127.0.0.1:8083/health > /dev/null 2>&1; then
        ok "Dashboard :8083"
    else
        fail "Dashboard 启动失败"
    fi
}

# ============================================================
# 大模块4: 定时调度器 (Interval Scheduler)
# ============================================================

start_scheduler() {
    log "启动 Interval Scheduler (:9104)..."
    cd "$SCHEDULER_DIR"

    local cfg_path="/tmp/scheduler_cfg.yaml"
    cat > "$cfg_path" << YAMLEOF
scheduler:
  cron_expr: "0,30 * * * *"
  batch_size: 10
  fetch_timeout: 30s
  batch_interval: 200ms
  lookback_days: 30
  max_retry: 1
  retry_backoff: 1s
  listen_port: 9104
database:
  dsn: "${A1_DB_DSN}"
YAMLEOF

    setsid env SCHEDULER_CONFIG_PATH="$cfg_path" SCHEDULER_USE_MOCK=true ./scheduler > /tmp/scheduler.log 2>&1 &
    sleep 2
    if curl -s --max-time 3 http://127.0.0.1:9104/healthz > /dev/null 2>&1; then
        ok "Interval Scheduler :9104"
    else
        fail "Interval Scheduler 启动失败"
    fi
}

# ============================================================
# 大模块5: BFF 网关 (zmp 开发)
# ============================================================

start_bff() {
    log "启动 BFF Gateway (:8088)..."
    cd "$BFF_DIR"
    export SESSION_MGR_URL="http://127.0.0.1:18080"
    export WORKFLOW_URL="${WORKFLOW_URL:-http://localhost:9100}"
    export C2_DASHBOARD_URL="${C2_DASHBOARD_URL:-http://localhost:8083}"
    export A1_ACCOUNT_URL="${A1_ACCOUNT_URL:-http://localhost:8084}"
    export SKILL_REGISTRY_URL="${SKILL_REGISTRY_URL:-http://localhost:18090}"
    export AI_MODEL_URL="${AI_MODEL_URL:-http://localhost:18180}"
    export A1_BASE_URL="${A1_BASE_URL:-http://localhost:8084}"
    export DB_DSN="${DB_DSN:-root:claw123@tcp(127.0.0.1:3306)/claw_studios?parseTime=true&charset=utf8mb4}"
    export A4_STORAGE_DIR="${A4_STORAGE_DIR:-/tmp/sm_demo}"
    export STOPPED_TASKS_FILE="${STOPPED_TASKS_FILE:-/tmp/sm_demo/stopped_tasks.json}"
    export JWT_SECRET="${JWT_SECRET:-not-default-secret-change-me}"
    setsid ./bff-server > /tmp/bff.log 2>&1 &
    sleep 2
    if curl -s --max-time 3 http://127.0.0.1:8088/healthz > /dev/null 2>&1; then
        ok "BFF Gateway :8088"
    else
        fail "BFF Gateway 启动失败"
    fi
}

# ============================================================
# 大模块6: 前端 (Next.js)
# ============================================================

start_frontend() {
    log "启动 Frontend (:3000)..."
    cd "$FE_DIR"

    # 确保 .env.local 存在
    if [ ! -f ".env.local" ]; then
        cat > ".env.local" << 'ENVEOF'
NEXT_PUBLIC_API_BASE=http://localhost:8088
NEXT_PUBLIC_WS_BASE=ws://localhost:8088
ENVEOF
        log "  已创建 .env.local (默认指向 localhost:8088)"
    fi

    setsid npm run dev > /tmp/fe.log 2>&1 &
    sleep 5
    if curl -s --max-time 3 http://127.0.0.1:3000 > /dev/null 2>&1; then
        ok "Frontend :3000"
    else
        fail "Frontend 启动失败 (可能仍在编译中，请稍等或查看 /tmp/fe.log)"
    fi
}

# ============================================================
# 主流程
# ============================================================

main() {
    echo ""
    echo -e "${CYAN}========================================${NC}"
    echo -e "${CYAN}  全模块后端 + 前端服务启动脚本${NC}"
    echo -e "${CYAN}========================================${NC}"
    echo ""

    cleanup_old
    check_prereq
    setup_data
    init_database
    build_all

    echo ""
    echo -e "${CYAN}--- 大模块1: 文档编写 ---${NC}"
    start_skills_register
    start_ai_provider
    start_session_manager

    echo ""
    echo -e "${CYAN}--- 大模块2: 发布沉淀 ---${NC}"
    start_a1_vault
    start_workflow_engine

    echo ""
    echo -e "${CYAN}--- 大模块3: 调度看板 ---${NC}"
    start_dashboard
    start_scheduler

    echo ""
    echo -e "${CYAN}--- 大模块5: BFF 网关 ---${NC}"
    start_bff

    echo ""
    echo -e "${CYAN}--- 大模块6: 前端 ---${NC}"
    start_frontend

    echo ""
    echo -e "${CYAN}========================================${NC}"
    echo -e "${GREEN}所有服务启动完成${NC}"
    echo ""
    echo "服务端口对照:"
    echo "  :18080  Session Manager      (会话管家)"
    echo "  :18090  Skills Register      (写作风格仓库)"
    echo "  :18180  AI Provider          (API Key钱包)"
    echo "  :8083   Dashboard            (看板查询)"
    echo "  :8084   A1 Account Vault     (账号凭证加密)"
    echo "  :8088   BFF Gateway          (前端统一入口)"
    echo "  :9100   Workflow Engine      (发布工作流)"
    echo "  :9104   Interval Scheduler   (定时调度器)"
    echo "  :3000   Frontend             (Next.js 前端)"
    echo ""
    echo "前置统一入口: http://localhost:8088"
    echo "前端UI入口:   http://localhost:3000"
    echo ""
}

main
