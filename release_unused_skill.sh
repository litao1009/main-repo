#!/usr/bin/env bash
# =============================================================================
# release_unused_skill.sh
# 清理 auto_publish_task 表中 status='deleted' 的任务：
#   1. 调用 session_mgr DELETE /api/task/:tid 释放磁盘资源
#   2. 物理删除 auto_publish_task 中对应行（默认开启，可用 --keep-db 跳过）
#
# 用法:
#   ./release_unused_skill.sh              # 执行清理
#   ./release_unused_skill.sh --dry-run    # 仅预览，不执行
#   ./release_unused_skill.sh --keep-db    # 清理 session_mgr 但保留 DB 行
# =============================================================================

set -euo pipefail

# ========== 默认配置 ==========
MYSQL_HOST="${MYSQL_HOST:-127.0.0.1}"
MYSQL_PORT="${MYSQL_PORT:-3306}"
MYSQL_USER="${MYSQL_USER:-root}"
MYSQL_PASS="${MYSQL_PASS:-claw123}"
MYSQL_DB="${MYSQL_DB:-claw_studios}"
SESSION_MGR_URL="${SESSION_MGR_URL:-http://localhost:18080}"

DRY_RUN=false
KEEP_DB=false

# ========== 颜色 ==========
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ========== 日志函数 ==========
log()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()     { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()   { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail()   { echo -e "${RED}[FAIL]${NC}  $*"; }
header() { echo -e "\n${BOLD}=== $* ===${NC}"; }

usage() {
    echo "用法: $0 [--dry-run] [--keep-db]"
    echo ""
    echo "  --dry-run   仅预览将被清理的任务，不执行任何删除"
    echo "  --keep-db   清理 session_mgr 资源，但保留 auto_publish_task 中的行"
    exit 0
}

# ========== 参数解析 ==========
for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=true ;;
        --keep-db) KEEP_DB=true ;;
        --help|-h) usage ;;
        *) warn "未知参数: $arg"; usage ;;
    esac
done

# ========== 前置检查 ==========
check_mysql() {
    if ! command -v mysql &>/dev/null; then
        fail "未找到 mysql 客户端，请安装后重试"
        exit 1
    fi
    if ! mysql -h"$MYSQL_HOST" -P"$MYSQL_PORT" -u"$MYSQL_USER" -p"$MYSQL_PASS" \
         -e "SELECT 1" "$MYSQL_DB" &>/dev/null; then
        fail "无法连接 MySQL ($MYSQL_USER@$MYSQL_HOST:$MYSQL_PORT/$MYSQL_DB)"
        exit 1
    fi
    ok "MySQL 连接正常 ($MYSQL_USER@$MYSQL_HOST:$MYSQL_PORT/$MYSQL_DB)"
}

check_session_mgr() {
    if ! curl -s --max-time 3 "${SESSION_MGR_URL}/healthz" &>/dev/null; then
        warn "无法访问 session_mgr ($SESSION_MGR_URL)，将继续但 API 调用会失败"
        return 1
    fi
    ok "session_mgr 可达 ($SESSION_MGR_URL)"
    return 0
}

# ========== 查询 deleted 任务 ==========
fetch_deleted_tasks() {
    log "查询 auto_publish_task 中 status='deleted' 的任务..." >&2
    mysql -h"$MYSQL_HOST" -P"$MYSQL_PORT" -u"$MYSQL_USER" -p"$MYSQL_PASS" \
          -N -B -e "SELECT task_id FROM auto_publish_task WHERE status='deleted'" "$MYSQL_DB" 2>/dev/null
}

# ========== 确认状态仍为 deleted ==========
confirm_status() {
    local task_id="$1"
    local status
    status=$(mysql -h"$MYSQL_HOST" -P"$MYSQL_PORT" -u"$MYSQL_USER" -p"$MYSQL_PASS" \
             -N -B -e "SELECT status FROM auto_publish_task WHERE task_id='$task_id'" "$MYSQL_DB" 2>/dev/null)
    if [ "$status" != "deleted" ]; then
        return 1
    fi
    return 0
}

# ========== 删除 auto_publish_task 行 ==========
purge_db_row() {
    local task_id="$1"
    if mysql -h"$MYSQL_HOST" -P"$MYSQL_PORT" -u"$MYSQL_USER" -p"$MYSQL_PASS" \
       -e "DELETE FROM auto_publish_task WHERE task_id='$task_id' AND status='deleted'" \
       "$MYSQL_DB" &>/dev/null; then
        return 0
    fi
    return 1
}

# ========== 调用 session_mgr DELETE API ==========
delete_from_session_mgr() {
    local task_id="$1"
    local http_code
    http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
                -X DELETE "${SESSION_MGR_URL}/api/task/${task_id}" 2>/dev/null)
    if [ "$http_code" = "200" ]; then
        return 0
    fi
    return 1
}

# ========== 计算目录大小 ==========
get_task_dir_size() {
    local task_id="$1"
    local dir="/tmp/sm_demo/tasks/${task_id}"
    if [ -d "$dir" ]; then
        du -sh "$dir" 2>/dev/null | cut -f1
    else
        echo "N/A"
    fi
}

# ========== 主流程 ==========
main() {
    header "release_unused_skill - 清理 deleted 任务"

    if $DRY_RUN; then
        warn ">>> DRY-RUN 模式：仅预览，不执行任何删除操作 <<<"
    fi

    check_mysql
    check_session_mgr || true

    # ---------- 查询 ----------
    local task_ids
    task_ids=$(fetch_deleted_tasks)

    if [ -z "$task_ids" ]; then
        ok "没有 status='deleted' 的任务，无需清理"
        exit 0
    fi

    # 转为数组
    local -a tasks=()
    while IFS= read -r line; do
        [[ -n "$line" ]] && tasks+=("$line")
    done <<< "$task_ids"

    local total=${#tasks[@]}
    log "找到 ${total} 个 deleted 任务"

    # ---------- 预览 ----------
    header "任务清单"
    printf "  %-3s %-40s %-10s\n" "No." "Task ID" "磁盘大小"
    printf "  %-3s %-40s %-10s\n" "---" "----------------------------------------" "----------"
    for i in "${!tasks[@]}"; do
        local size
        size=$(get_task_dir_size "${tasks[$i]}")
        printf "  %-3d %-40s %-10s\n" "$((i+1))" "${tasks[$i]}" "$size"
    done

    if $DRY_RUN; then
        echo ""
        log "DRY-RUN 完成，以上任务不会被删除。去掉 --dry-run 以执行清理。"
        exit 0
    fi

    # ---------- 确认 ----------
    echo ""
    read -r -p "确认删除以上 ${total} 个任务? [y/N] " confirm
    if [ "${confirm,,}" != "y" ] && [ "$confirm" != "yes" ]; then
        log "已取消"
        exit 0
    fi

    # ---------- 执行 ----------
    header "执行清理"
    local success=0
    local fail_count=0
    local -a failed_list=()

    for task_id in "${tasks[@]}"; do
        log "处理: $task_id"

        # 二次确认状态
        if ! confirm_status "$task_id"; then
            warn "  $task_id 状态已变更（不再为 deleted），跳过"
            fail_count=$((fail_count + 1))
            failed_list+=("$task_id (status_changed)")
            continue
        fi

        # 步骤1: 调 session_mgr DELETE API
        if ! delete_from_session_mgr "$task_id"; then
            warn "  session_mgr 删除失败: $task_id"
            fail_count=$((fail_count + 1))
            failed_list+=("$task_id (session_mgr_failed)")
            continue
        fi
        log "  session_mgr 资源已释放"

        # 步骤2: 物理删 MySQL 行（除非 --keep-db）
        if ! $KEEP_DB; then
            if purge_db_row "$task_id"; then
                log "  auto_publish_task 行已删除"
            else
                warn "  auto_publish_task 行删除失败（session_mgr 已清理）"
                fail_count=$((fail_count + 1))
                failed_list+=("$task_id (db_purge_failed)")
                continue
            fi
        else
            log "  --keep-db: 跳过 DB 行删除"
        fi

        ok "  $task_id 完成"
        success=$((success + 1))
    done

    # ---------- 汇总 ----------
    header "清理完成"
    echo "  总数: ${total}"
    echo -e "  成功: ${GREEN}${success}${NC}"
    if [ "$fail_count" -gt 0 ]; then
        echo -e "  失败: ${RED}${fail_count}${NC}"
        for f in "${failed_list[@]}"; do
            echo "    - $f"
        done
    fi
}

main "$@"
