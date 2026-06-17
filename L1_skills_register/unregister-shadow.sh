#!/usr/bin/env bash
# ============================================================
# unregister-shadow.sh — 批量下架已注册的 shadow 技能
#
# 依赖: python3, shadow_utils.sh
# ============================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/shadow_utils.sh"

FIXTURES_DIR=$(get_fixtures_dir)

show_help() {
    cat << 'EOF'
╔══════════════════════════════════════════════════════════════╗
║         unregister-shadow — 下架已注册的 shadow 技能        ║
╚══════════════════════════════════════════════════════════════╝

【功能】
  物理删除 fixtures/ 中的 shadow 目录，完成下架。
  删除后需重启 skill_registry 才能从内存中彻底清除。

【三种使用模式】

  1. 交互模式（无参数）— 推荐新手使用
     ./unregister-shadow
     → 展示所有已注册 shadow 的表格
     → 输入编号/名称选择要删除的
     → 一次性确认后批量删除

  2. 直接模式（带参数）
     ./unregister-shadow middlemarch-shadow
     ./unregister-shadow "西望镇" 1-3 moby-dick-shadow

  3. 批量模式（从文件读取）
     ./unregister-shadow --batch to_delete.txt

     【to_delete.txt 样例写法】
        # 每行一个 slug（即 fixtures/ 下的目录名），支持编号/slug/书名
        The_Metamorphosis-Franz_Kafka_2500_shadow
        Emma-Jane_Austen_2500_shadow
        1,3,5
        西望镇
        moby-dick-shadow

     注意: 不要写完整路径（含 / 会被拒绝），只写路径最后一段即 slug

【选择器语法】
  支持三种书写方式，可混合使用:

    编号    1              删除第 1 个
            1,3,5          删除第 1、3、5 个
            1-3            删除第 1 到第 3 个
            1,3,5-7        删除第 1、3、5、6、7 个

    slug    middlemarch-shadow    精确匹配 (slug 或目录名均可)

    书名    西望镇              模糊匹配中文书名 (contains)

【选项】
  --batch FILE      从文件读取选择器（每行一个，支持编号/slug/书名）
  --all             删除全部已注册 shadow（需二次确认）
  --dry-run         只展示将要删除的，不实际删除
  --force, -y       跳过确认直接删除
  --fixtures DIR    指定 fixtures 目录（默认: ./fixtures）
  --help            显示本帮助

【确认机制】
  - 普通删除: 输入 yes 确认
  - --all 全部删除: 输入 "DELETE ALL" 确认（防止手滑）
  - --force / -y: 跳过所有确认

【环境变量】
  SHADOW_FIXTURES_DIR   fixtures 目录路径（默认: ./fixtures）
  FORCE_COLOR=1         强制彩色输出
EOF
}

# ---- 扫描 fixtures 获取所有 shadow ----
scan_fixtures() {
    local entries=()
    if [ ! -d "$FIXTURES_DIR" ]; then
        die "Fixtures 目录不存在: $FIXTURES_DIR"
    fi
    for d in "$FIXTURES_DIR"/*/; do
        [ -d "$d" ] || continue
        local dir="${d%/}"
        # 必须有 _meta.json 才视为 shadow
        [ -f "$dir/_meta.json" ] || continue
        local slug=""
        slug=$(_meta_slug "$dir")
        [ -n "$slug" ] || continue
        entries+=("$dir")
    done
    printf '%s\n' "${entries[@]}"
}

# ---- 展示表格 ----
show_table() {
    local dirs=("$@")
    local i=1
    echo ""
    echo -e "  ${C_BOLD}已注册 shadow 列表${C_RESET}  (${C_DIM}$FIXTURES_DIR/${C_RESET})"
    echo -e "  ${C_DIM}$(printf '─%.0s' {1..72})${C_RESET}"
    printf "  ${C_DIM}%-4s %-32s %-18s %-8s %s${C_RESET}\n" "#" "目录名 / slug" "书名" "大小" "章节"
    echo -e "  ${C_DIM}$(printf '─%.0s' {1..72})${C_RESET}"

    for d in "${dirs[@]}"; do
        local slug=$(_meta_slug "$d")
        local dirname=$(basename "$d")
        local title=$(_novel_title "$d")
        local size=$(human_size $(dir_total_size "$d"))
        local ch=$(chapter_count "$d")
        local chapter_str="$ch 章"
        [ "$ch" -gt 0 ] && chapter_str="${C_YELLOW}${ch} 章${C_RESET}" || chapter_str="-"

        [ -z "$title" ] && title="(无书名)"

        # 目录名和 slug 不同时, 显示为 "dirname (slug)"
        local display_key
        if [ "$dirname" = "$slug" ]; then
            display_key="${dirname:0:31}"
        else
            # 优先显示目录名, 后面缩进显示 slug
            display_key="${dirname:0:20} (${slug:0:10})"
        fi

        local display_title="${title:0:17}"
        [ ${#title} -gt 17 ] && display_title="${display_title}…"

        printf "  ${C_GREEN}%-4s${C_RESET} ${C_BOLD}%-32s${C_RESET} %-18s %-8s %s\n" \
            "$i" "$display_key" "$display_title" "$size" "$chapter_str"
        ((i++)) || true
    done
    echo -e "  ${C_DIM}$(printf '─%.0s' {1..72})${C_RESET}"
    echo ""
}

# ---- 解析选择器 ----
# 解析 "1,3,5-7" → "1 3 5 6 7"
parse_number_selector() {
    local input="$1" total="$2"
    local result=()
    IFS=',' read -ra parts <<< "$input"
    for part in "${parts[@]}"; do
        part="${part// /}"
        if [[ "$part" =~ ^([0-9]+)-([0-9]+)$ ]]; then
            local start="${BASH_REMATCH[1]}" end="${BASH_REMATCH[2]}"
            [ "$start" -lt 1 ] && start=1
            [ "$end" -gt "$total" ] && end="$total"
            for ((n=start; n<=end; n++)); do
                result+=("$n")
            done
        elif [[ "$part" =~ ^[0-9]+$ ]]; then
            local n="$part"
            if [ "$n" -ge 1 ] && [ "$n" -le "$total" ]; then
                result+=("$n")
            else
                warn "编号 $n 超出范围 (1-$total), 忽略"
            fi
        else
            warn "无法解析: '$part', 忽略"
        fi
    done
    printf '%s\n' "${result[@]}" | sort -n | uniq
}

# 判断输入是编号/slug/书名
classify_selector() {
    local sel="$1"
    # 纯数字/逗号/横线 → 编号
    if [[ "$sel" =~ ^[0-9,\ -]+$ ]]; then
        echo "number"
    # 含 .. → 路径穿越，拒绝
    elif [[ "$sel" =~ \.\. ]]; then
        echo "reject"
    # 含 / → 可能是完整路径，提取末尾作为 slug 再试
    elif [[ "$sel" =~ [/] ]]; then
        local basename=$(basename "$sel")
        # 防止 basename 为空或还是路径
        if [ -n "$basename" ] && [[ ! "$basename" =~ [/] ]] && [[ ! "$basename" =~ \.\. ]]; then
            echo "path:${basename}"
        else
            echo "reject"
        fi
    # 含 - 或 _ → slug
    elif [[ "$sel" =~ [-_] ]]; then
        echo "slug"
    else
        echo "title"
    fi
}

# 按 slug 或目录名查找索引
find_by_slug() {
    local query="$1"; shift
    local dirs=("$@")
    local idx=1
    for d in "${dirs[@]}"; do
        local s=$(_meta_slug "$d")
        local dn=$(basename "$d")
        # 匹配 slug 或实际目录名
        if [ "$s" = "$query" ] || [ "$dn" = "$query" ]; then
            echo "$idx"
            return 0
        fi
        ((idx++)) || true
    done
    echo ""
}

# 按书名模糊查找索引
find_by_title() {
    local pattern="$1"; shift
    local dirs=("$@")
    local idx=1 matches=()
    for d in "${dirs[@]}"; do
        local t=$(_novel_title "$d")
        if [[ "$t" == *"$pattern"* ]]; then
            matches+=("$idx")
        fi
        ((idx++)) || true
    done
    if [ ${#matches[@]} -eq 1 ]; then
        echo "${matches[0]}"
    elif [ ${#matches[@]} -gt 1 ]; then
        echo "MULTI:${matches[*]}"
    else
        echo ""
    fi
}

# 将选择器解析为索引列表
resolve_selector() {
    local sel="$1" total="$2"; shift 2
    local dirs=("$@")
    local type
    type=$(classify_selector "$sel")

    case "$type" in
        number)
            parse_number_selector "$sel" "$total"
            ;;
        slug)
            local idx
            idx=$(find_by_slug "$sel" "${dirs[@]}")
            if [ -n "$idx" ]; then
                echo "$idx"
            else
                warn "slug 未匹配: $sel"
            fi
            ;;
        path:*)
            # 完整路径输入：提取 basename 作为 slug
            local slug_from_path="${type#path:}"
            local idx
            idx=$(find_by_slug "$slug_from_path" "${dirs[@]}")
            if [ -n "$idx" ]; then
                ok "自动识别: $sel → $slug_from_path"
                echo "$idx"
            else
                warn "自动提取 slug '$slug_from_path' 未匹配: $sel"
            fi
            ;;
        title)
            local result
            result=$(find_by_title "$sel" "${dirs[@]}")
            if [[ "$result" == MULTI:* ]]; then
                warn "书名 '$sel' 匹配多个, 请用编号选择: ${result#MULTI:}"
            elif [ -z "$result" ]; then
                warn "书名未匹配: $sel"
            else
                echo "$result"
            fi
            ;;
        reject)
            warn "拒绝危险输入: '$sel'"
            ;;
    esac
}

# ---- 主逻辑 ----
main() {
    local selectors=() batch="" dry_run=false force=false all_mode=false

    while [ $# -gt 0 ]; do
        case "$1" in
            --help|-h)     show_help; exit 0 ;;
            --batch)       batch="$2"; shift 2 ;;
            --all)         all_mode=true; shift ;;
            --dry-run)     dry_run=true; shift ;;
            --force|-y)    force=true; shift ;;
            --fixtures)    FIXTURES_DIR="$2"; shift 2 ;;
            -*)            fail "未知参数: $1 (用 --help 查看帮助)"; exit 1 ;;
            *)             selectors+=("$1"); shift ;;
        esac
    done

    check_deps || exit 1

    # 扫描
    local dirs=()
    while IFS= read -r line; do
        [ -n "$line" ] && dirs+=("$line")
    done < <(scan_fixtures)

    local total="${#dirs[@]}"
    [ "$total" -gt 0 ] || die "Fixtures 中没有已注册的 shadow"

    # 处理 --all
    if [ "$all_mode" = true ]; then
        selectors=()
        for ((i=1; i<=total; i++)); do selectors+=("$i"); done
    fi

    # 处理 --batch
    if [ -n "$batch" ]; then
        [ -f "$batch" ] || die "列表文件不存在: $batch"
        while IFS= read -r line; do
            line="${line//$'\r'/}"
            [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
            selectors+=("$line")
        done < "$batch"
    fi

    # 交互模式
    if [ ${#selectors[@]} -eq 0 ]; then
        show_table "${dirs[@]}"

        local input
        tip "删除全部: 输入 all 或 --all"
        echo -n "  要删除的编号/名称 (空格分隔): "
        read -r input

        if [ "${input,,}" = "all" ] || [ "${input,,}" = "--all" ]; then
            all_mode=true
            for ((i=1; i<=total; i++)); do selectors+=("$i"); done
        else
            IFS=' ' read -ra selectors <<< "$input"
        fi
    fi

    [ ${#selectors[@]} -gt 0 ] || die "未指定任何选择器"

    # 解析选择器 → 索引集合
    local indices=()
    for sel in "${selectors[@]}"; do
        while IFS= read -r idx; do
            [ -n "$idx" ] && indices+=("$idx")
        done < <(resolve_selector "$sel" "$total" "${dirs[@]}")
    done

    # 去重排序
    indices=($(printf '%s\n' "${indices[@]}" | sort -n | uniq))
    [ ${#indices[@]} -gt 0 ] || die "没有匹配到任何 shadow"

    # 解析为目录信息 (实际路径 + 展示用 slug/书名)
    local to_delete_dirs=() to_delete_slugs=() to_delete_titles=() to_delete_size=0
    local has_content=false

    for idx in "${indices[@]}"; do
        local d="${dirs[$((idx-1))]}"
        local slug=$(_meta_slug "$d")
        local title=$(_novel_title "$d")
        local sz=$(dir_total_size "$d")
        local ch=$(chapter_count "$d")
        [ -z "$title" ] && title="(无书名)"

        to_delete_dirs+=("$d")          # 实际路径，用于 rm -rf
        to_delete_slugs+=("$slug")
        to_delete_titles+=("$title")
        to_delete_size=$((to_delete_size + sz))
        [ "$ch" -gt 0 ] && has_content=true
    done

    # 展示确认表格
    local count=${#to_delete_slugs[@]}
    echo ""
    heading "将要删除以下 $count 个 shadow"
    echo -e "  ${C_DIM}$(printf '─%.0s' {1..68})${C_RESET}"
    printf "  ${C_DIM}%-4s %-30s %-20s %-10s${C_RESET}\n" "#" "slug" "书名" "大小"
    echo -e "  ${C_DIM}$(printf '─%.0s' {1..68})${C_RESET}"

    for i in "${!to_delete_slugs[@]}"; do
        local d="${to_delete_dirs[$i]}"
        local ch=$(chapter_count "$d")
        local ch_str=""
        [ "$ch" -gt 0 ] && ch_str=" ${C_YELLOW}⚠${ch}章${C_RESET}"
        printf "  ${C_GREEN}%-4s${C_RESET} ${C_BOLD}%-30s${C_RESET} %-20s %-10s%s\n" \
            "$((i+1))" "${to_delete_slugs[$i]:0:29}" "${to_delete_titles[$i]:0:19}" "$(human_size $(dir_total_size "$d"))" "$ch_str"
        # 如果实际目录名和 slug 不一致，提示
        local actual_name=$(basename "$d")
        if [ "$actual_name" != "${to_delete_slugs[$i]}" ]; then
            echo -e "      ${C_DIM}实际目录: $actual_name${C_RESET}"
        fi
    done
    echo -e "  ${C_DIM}$(printf '─%.0s' {1..68})${C_RESET}"
    echo -e "  总大小: ${C_BOLD}$(human_size $to_delete_size)${C_RESET}"
    if [ "$has_content" = true ]; then
        echo -e "  ${C_YELLOW}⚠ 部分 shadow 包含已写章节内容，删除不可恢复${C_RESET}"
    fi
    echo ""

    # DRY-RUN 退出
    if [ "$dry_run" = true ]; then
        info "DRY-RUN 完成，未实际删除"
        exit 0
    fi

    # 确认
    if [ "$force" != true ]; then
        if [ "$all_mode" = true ]; then
            if ! confirm_delete_all "$count" "确认删除全部 ${count} 个 shadow? 输入 \"DELETE ${count}\" 确认: "; then
                info "已取消"
                exit 0
            fi
        else
            if ! confirm "确认删除以上全部 ${count} 个 shadow? (yes/NO): "; then
                info "已取消"
                exit 0
            fi
        fi
    fi

    # 执行删除 (使用实际目录路径, 不依赖 slug 拼路径)
    echo ""
    local deleted=0 fail_del=0
    for i in "${!to_delete_dirs[@]}"; do
        local target="${to_delete_dirs[$i]}"
        local slug="${to_delete_slugs[$i]}"
        if [ -d "$target" ]; then
            rm -rf "$target"
            if [ ! -d "$target" ]; then
                ok "已删除: $slug"
                ((deleted++)) || true
            else
                fail "删除失败: $slug"
                ((fail_del++)) || true
            fi
        else
            skip "目录不存在: $target (可能已删除)"
        fi
    done

    echo ""
    heading "下架完成"
    echo "  ${C_GREEN}已删除${C_RESET}: $deleted"
    [ "$fail_del" -gt 0 ] && echo "  ${C_RED}失败${C_RESET}: $fail_del"
    echo ""

    if [ "$deleted" -gt 0 ]; then
        echo ""
        echo -e "  ${C_YELLOW}╔══════════════════════════════════════════════════════════╗${C_RESET}"
        echo -e "  ${C_YELLOW}║${C_RESET}  ${C_BOLD}⚠ 注意：前端的变更需要重启后才生效${C_RESET}                   ${C_YELLOW}║${C_RESET}"
        echo -e "  ${C_YELLOW}╚══════════════════════════════════════════════════════════╝${C_RESET}"
        echo ""
        echo -e "  ${C_DIM}skill_registry 将 skill 数据加载在内存中。${C_RESET}"
        echo -e "  ${C_DIM}目录已删除，但前端查询的仍是内存中的旧数据。${C_RESET}"
        echo -e "  ${C_DIM}重启后重新扫描 fixtures/，下架的 skill 即完全消失。${C_RESET}"
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
