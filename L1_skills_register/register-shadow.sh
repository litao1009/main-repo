#!/usr/bin/env bash
# ============================================================
# register-shadow.sh — 批量注册 shadow 目录到 skill_registry
#
# 依赖: python3, shadow_utils.sh
# ============================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/shadow_utils.sh"

FIXTURES_DIR=$(get_fixtures_dir)

show_help() {
    cat << EOF
╔══════════════════════════════════════════════════════════════╗
║          register-shadow — 注册 shadow 到 skill_registry    ║
╚══════════════════════════════════════════════════════════════╝

【功能】
  将 shadow 目录拷贝到 fixtures/ 完成注册。注册后需重启
  skill_registry 才能生效。

【基本用法】
  ./register-shadow ./Dracula-shadow
  ./register-shadow ./a-shadow ./b-shadow ./c-shadow
  ./register-shadow --batch list.txt

【输入文件格式 (--batch)】
  list.txt 中每行一个 shadow 目录路径:
    /home/output/Dracula-shadow
    /home/output/Frankenstein-shadow
    # 注释行以 # 开头，空行自动跳过

【选项】
  <shadow-dir>...      一个或多个 shadow 目录路径
  --batch FILE          从文件读取 shadow 目录列表（一行一个）
  --dry-run             只校验不拷贝
  --force               覆盖 fixtures 中已存在的同名目录
  --fixtures DIR        指定 fixtures 目录（默认: ./fixtures）
  --help                显示本帮助

【工作流程】
  1. 对每个 shadow 目录执行 13 项校验
  2. 校验通过 → 拷贝到 FIXTURES_DIR/
  3. 校验失败 → 跳过并打印缺失项
  4. 打印统计: 已注册 / 跳过 / 失败

【完整工作流示例】
  # 1. 注册单个
  ./register-shadow ./shadow_output/Dracula-shadow

  # 2. 批量注册
  ls -d ./shadow_output/*-shadow/ > to_register.txt
  ./register-shadow --batch to_register.txt

  # 3. 预览（不实际拷贝）
  ./register-shadow --batch to_register.txt --dry-run

  # 4. 重启使生效
  pkill skill_registry && start_all.sh

【环境变量】
  SHADOW_FIXTURES_DIR   fixtures 目录路径（默认: ./fixtures）
  FORCE_COLOR=1         强制彩色输出
EOF
}

main() {
    local targets=() batch="" dry_run=false force=false

    while [ $# -gt 0 ]; do
        case "$1" in
            --help|-h)     show_help; exit 0 ;;
            --batch)       batch="$2"; shift 2 ;;
            --dry-run)     dry_run=true; shift ;;
            --force)       force=true; shift ;;
            --fixtures)    FIXTURES_DIR="$2"; shift 2 ;;
            -*)            fail "未知参数: $1 (用 --help 查看帮助)"; exit 1 ;;
            *)             targets+=("$1"); shift ;;
        esac
    done

    # 收集目标
    if [ -n "$batch" ]; then
        [ -f "$batch" ] || die "列表文件不存在: $batch"
        while IFS= read -r line; do
            line="${line//$'\r'/}"
            [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
            targets+=("$line")
        done < "$batch"
    fi

    [ ${#targets[@]} -gt 0 ] || die "没有指定 shadow 目录。用法: ./register-shadow <dir> 或 --batch <file>"

    # 确保 fixtures 目录存在
    mkdir -p "$FIXTURES_DIR"

    check_deps || exit 1

    heading "注册 shadow 技能 → fixtures/"
    info "Fixtures 目录: $FIXTURES_DIR"
    [ "$dry_run" = true ] && warn "DRY-RUN 模式 — 不会实际拷贝"
    [ "$force" = true ] && warn "FORCE 模式 — 将覆盖已存在的目录"
    echo ""

    local ok_count=0 skip_count=0 fail_count=0
    local dedup_seen=()

    for target in "${targets[@]}"; do
        # 解析路径
        local dir
        dir="$(realpath "$target" 2>/dev/null || echo "$target")"
        local name=$(basename "$dir")

        # 去重
        local seen=false
        for s in "${dedup_seen[@]}"; do [ "$s" = "$dir" ] && seen=true; done
        if [ "$seen" = true ]; then
            skip "$name (重复输入, 跳过)"
            skip_count=$((skip_count + 1))
            continue
        fi
        dedup_seen+=("$dir")

        # 1. 校验
        if ! validate_quiet "$dir"; then
            heading "$name"
            validate_shadow_dir "$dir" || true
            echo ""
            fail "$name — 校验未通过, 跳过"
            ((fail_count++)) || true
            continue
        fi

        local slug=""
        slug=$(_meta_slug "$dir")
        local cname=""
        cname=$(_novel_title "$dir")
        [ -z "$cname" ] && cname="$slug"

        heading "$name"
        # 2. 检查已存在（按实际目录名 + 按 slug 双重检查）
        local dest="$FIXTURES_DIR/$name"
        if [ -d "$dest" ]; then
            if [ "$force" = true ]; then
                warn "  fixtures 中已存在同名目录, 强制覆盖..."
                rm -rf "$dest"
            else
                skip "  fixtures 中已有同名目录 ($name)"
                echo "  用 --force 强制覆盖"
                skip_count=$((skip_count + 1))
                continue
            fi
        fi

        # 检查 slug 冲突: 扫描 fixtures 中已有的 shadow
        local slug_conflict_dir=""
        if [ -d "$FIXTURES_DIR" ]; then
            for existing in "$FIXTURES_DIR"/*/; do
                [ -d "$existing" ] || continue
                [ -f "$existing/_meta.json" ] || continue
                local existing_slug
                existing_slug=$(_meta_slug "${existing%/}")
                if [ "$existing_slug" = "$slug" ] && [ "${existing%/}" != "$dir" ]; then
                    slug_conflict_dir="${existing%/}"
                    break
                fi
            done
        fi

        if [ -n "$slug_conflict_dir" ]; then
            if [ "$force" = true ]; then
                warn "  slug '$slug' 已被 '$(basename "$slug_conflict_dir")' 占用, 强制覆盖..."
                rm -rf "$slug_conflict_dir"
            else
                skip "  slug '$slug' 已被 '$(basename "$slug_conflict_dir")' 占用"
                echo "  用 --force 强制覆盖"
                skip_count=$((skip_count + 1))
                continue
            fi
        fi

        # 3. 拷贝
        if [ "$dry_run" = true ]; then
            ok "  [DRY-RUN] 将拷贝 → fixtures/$name"
            info "  slug=$slug  title=$cname"
            local sz=$(dir_total_size "$dir")
            info "  大小: $(human_size $sz)"
            ((ok_count++)) || true
        else
            info "  拷贝中 ($(human_size $(dir_total_size "$dir"))) ..."
            cp -r "$dir" "$dest"
            ok "  $name → fixtures/$name  (slug=$slug, $cname)"
            ((ok_count++)) || true
        fi
        echo ""
    done

    # 统计
    echo ""
    heading "注册完成"
    echo "  ${C_GREEN}已注册${C_RESET} (或 DRY-RUN): $ok_count"
    [ "$skip_count" -gt 0 ] && echo "  ${C_YELLOW}跳过${C_RESET}: $skip_count"
    [ "$fail_count" -gt 0 ] && echo "  ${C_RED}失败${C_RESET}: $fail_count"
    echo ""

    if [ "$ok_count" -gt 0 ] && [ "$dry_run" = false ]; then
        echo ""
        echo -e "  ${C_YELLOW}╔══════════════════════════════════════════════════════════╗${C_RESET}"
        echo -e "  ${C_YELLOW}║${C_RESET}  ${C_BOLD}⚠ 注意：注册需要重启后才生效${C_RESET}                       ${C_YELLOW}║${C_RESET}"
        echo -e "  ${C_YELLOW}╚══════════════════════════════════════════════════════════╝${C_RESET}"
        echo ""
        echo -e "  ${C_DIM}skill_registry 启动时一次性扫描 fixtures/ 加载到内存。${C_RESET}"
        echo -e "  ${C_DIM}新拷贝的目录不会被自动发现，需要重启才能识别。${C_RESET}"
        echo ""
        echo -e "  ${C_BOLD}重启命令:${C_RESET}"
        echo ""
        echo "    pkill skill_registry"
        echo "    cd $SCRIPT_DIR"
        echo "    ./skill_registry --port 18090 --internal-auth=\"\" \\"
        echo "        --cover-bin /path/to/novelcover_pure \\"
        echo "        --fonts-dir /path/to/fonts \\"
        echo "        > /tmp/sr.log 2>&1 &"
        echo ""
        echo "  或使用 start_all.sh 一键重启全部服务"
        echo ""
    fi
}

main "$@"
