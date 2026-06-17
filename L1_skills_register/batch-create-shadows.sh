#!/usr/bin/env bash
# ============================================================
# batch-create-shadows.sh — 批量将公版小说 .txt 转化为 shadow 技能
#
# 依赖: opencode (AI驱动), python3, L1_novel_skill/generate_cover.py
# 共享库: shadow_utils.sh (同目录)
# ============================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/shadow_utils.sh"

# ---- 默认值 ----
OUTPUT_DIR_DEFAULT="./shadow_output"
PROGRESS_FILE_DEFAULT="./batch_progress.json"
TIMEOUT_DEFAULT=2400
MODEL="${SHADOW_OPENCODE_MODEL:-}"
OPENAIDE_DIR="${SHADOW_OPENAIDE_DIR:-/home/main-repo}"
GENERATE_COVER_SCRIPT="${SHADOW_COVER_SCRIPT:-$SCRIPT_DIR/../L1_novel_skill/scripts/generate_cover.py}"

# ---- 帮助 ----
show_help() {
    cat << 'EOF'
╔══════════════════════════════════════════════════════════════╗
║       batch-create-shadows — 批量 txt → shadow 技能         ║
╚══════════════════════════════════════════════════════════════╝

【功能】
  将一批公版小说 .txt 文件，逐个通过 AI（opencode）转化为
  shadow 写作技能目录。每部小说独立处理，互不干扰。

【基本用法】
  ./batch-create-shadows --list novels.txt

【输入文件格式】
  novels.txt 中每行一个小说 .txt 的绝对路径:
    /data/novels/Dracula.txt
    /data/novels/Frankenstein.txt
    /data/novels/Jane_Eyre.txt
    # 以 # 开头的行为注释，空行自动跳过

【选项】
  --list FILE          小说列表文件（每行一个 .txt 路径）[必填]
  --output-dir DIR     输出目录（默认: ./shadow_output）
  --progress FILE      进度跟踪文件（默认: ./batch_progress.json）
  --timeout SECONDS    单部小说处理超时秒数（默认: 2400 = 40分钟）
  --model PROVIDER/MODEL  指定 opencode 使用的模型
  --resume             从上次中断处续传（读取 progress 文件）
  --retry-cover-only   仅重试封面生成失败的条目（不重新跑 AI）
  --no-cover           跳过封面生成
  --help               显示本帮助

【工作流程（每部小说）】
  1. 调用 opencode run → AI 执行 4 阶段工作流:
     Phase A: 原作消化 (分析统计 + 风格指纹 + 内核提炼)
     Phase B: 创作决策 (大纲 + 角色 + 背景)
     Phase C: Skill 物化 (12 个文件产出)
     Phase D: 交付
  2. 自动校验 13 项产出文件
  3. 若缺 cover.png → 自动调用 generate_cover.py 重试生图
  4. 自动生成 _meta.json
  5. 记录进度到 progress 文件

【续传与重试】
  中断后可续传:
    ./batch-create-shadows --list novels.txt --resume
  仅重试失败的封面:
    ./batch-create-shadows --list novels.txt --retry-cover-only

【环境变量】
  SHADOW_OPENCODE_MODEL    指定模型 (如 deepseek/deepseek-v4-pro)
  SHADOW_OPENAIDE_DIR      opencode 工作目录 (默认 /home/main-repo)
  SHADOW_COVER_SCRIPT      封面生成脚本路径
  SHADOW_OWNER_ID          _meta.json 中的 ownerId
  FORCE_COLOR=1            强制彩色输出

【完整示例】
  # 准备小说列表
  find /data/public_domain -name '*.txt' > novels.txt

  # 批量生成（首次运行）
  ./batch-create-shadows --list novels.txt --output-dir ./my_shadows

  # 中途断了？续传
  ./batch-create-shadows --list novels.txt --resume

  # 封面生成失败的？单独重试
  ./batch-create-shadows --list novels.txt --retry-cover-only

  # 全部生成完后，注册到 skill_registry
  ls -d ./my_shadows/*-shadow/ > to_register.txt
  ./register-shadow --batch to_register.txt
EOF
}

# ---- 进度文件操作 ----
progress_load() {
    local f="$1"
    [ -f "$f" ] && python3 -c "import json; print(json.dumps(json.load(open('$f'))))" 2>/dev/null || echo '{"novels":{}}'
}

progress_is_done() {
    local prog="$1" novel="$2"
    local status
    status=$(python3 -c "
import json, sys
d=json.loads('''$prog''')
print(d.get('novels',{}).get('$novel',{}).get('status',''))
" 2>/dev/null)
    [ "$status" = "done" ]
}

progress_is_cover_failed() {
    local prog="$1" novel="$2"
    local status
    status=$(python3 -c "
import json
d=json.loads('''$prog''')
print(d.get('novels',{}).get('$novel',{}).get('status',''))
" 2>/dev/null)
    [ "$status" = "cover_failed" ]
}

progress_save() {
    local prog_file="$1" novel="$2" status="$3"
    python3 -c "
import json, os, sys

prog_file = '$prog_file'
novel = '$novel'
status = '$status'

data = {'novels': {}}
if os.path.exists(prog_file):
    try:
        with open(prog_file) as f:
            data = json.load(f)
    except:
        pass

data.setdefault('novels', {})
data['novels'][novel] = data['novels'].get(novel, {})
data['novels'][novel]['status'] = status
data['novels'][novel]['updated_at'] = __import__('datetime').datetime.now().isoformat()

with open(prog_file, 'w') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write('\n')
"
    return 0
}

# ---- 封面生成 ----
retry_cover() {
    local dir="$1"
    local prompt cover_output

    prompt=$(_novel_cover_prompt "$dir")
    if [ -z "$prompt" ]; then
        warn "novel_metadata.json 中无 cover_prompt，无法自动生成封面"
        warn "请手动执行: python3 $GENERATE_COVER_SCRIPT --prompt '...' --output $dir/cover.png"
        return 1
    fi

    cover_output="$dir/cover.png"
    info "重试封面生成..."
    info "  Prompt: ${prompt:0:120}..."

    if [ ! -f "$GENERATE_COVER_SCRIPT" ]; then
        warn "封面生成脚本不存在: $GENERATE_COVER_SCRIPT"
        return 1
    fi

    python3 "$GENERATE_COVER_SCRIPT" --prompt "$prompt" --output "$cover_output" 2>&1 | while IFS= read -r line; do
        echo "        $line"
    done

    if [ -f "$cover_output" ] && [ "$(file_size "$cover_output")" -gt 10240 ]; then
        ok "封面生成成功 ($(human_size $(file_size "$cover_output")))"
        # 更新 novel_metadata.json 中的封面字段
        python3 -c "
import json, os
f='$dir/novel_metadata.json'
if os.path.exists(f):
    d=json.load(open(f))
    d['cover_image']='./cover.png'
    d['cover_generated_by']='混元 TextToImageLite'
    d['cover_resolution']='768x1024 (3:4)'
    json.dump(d, open(f,'w'), ensure_ascii=False, indent=2)
    open(f,'a').write('\n')
" 2>/dev/null
        return 0
    else
        fail "封面生成失败"
        return 1
    fi
}

# ---- 单部小说处理 ----
process_novel() {
    local novel_path="$1" output_dir="$2" no_cover="$3"

    local novel_name=$(basename "$novel_path" .txt)

    heading "处理: $novel_name"
    info "源文件: $novel_path"
    info "输出目录: $output_dir"

    # 构建 opencode prompt
    local prompt="使用 novel-shadow-creator 技能处理公版小说。

源小说文件路径: $novel_path
输出目录: $output_dir

严格按照skill定义的4阶段工作流执行:
  Phase A: 原作消化 (统计分析 + 风格指纹 + 内核提炼)
  Phase B: 创作决策 (大纲 + 角色 + 背景，自动决策不需询问)
  Phase C: Skill物化 (必须生成全部12个文件)
  Phase D: 交付

重要要求:
1. novel_metadata.json 必须包含 cover_prompt 字段（用于后续封面生成）
2. 产出目录结构严格遵循skill规范
3. 完成后无需额外说明，直接退出"

    if [ "$no_cover" = "true" ]; then
        prompt="$prompt

4. 封面生成已禁用，跳过 cover.png 生成"
    fi

    # 调用 opencode
    info "启动 opencode..."
    local opencode_args=(run --dir "$OPENAIDE_DIR")
    [ -n "$MODEL" ] && opencode_args+=(--model "$MODEL")
    opencode_args+=(--dangerously-skip-permissions)
    opencode_args+=("$prompt")
    opencode_args+=(--file "$novel_path")

    local start_time=$(date +%s)

    # 使用 timeout 包裹，超时自动杀
    run_with_timeout "$TIMEOUT" opencode "${opencode_args[@]}" </dev/null
    local exit_code=$?

    local elapsed=$(($(date +%s) - start_time))
    info "opencode 退出码: $exit_code (耗时 ${elapsed}s)"

    if [ $exit_code -eq 124 ]; then
        fail "超时 (${TIMEOUT}s)，open代码进程已终止"
        # 确保彻底清理
        pkill -f "opencode run" 2>/dev/null || true
        sleep 1
        return 2
    fi

    return 0
}

# ---- 主逻辑 ----
main() {
    local LIST_FILE="" OUTPUT_DIR="$OUTPUT_DIR_DEFAULT" PROGRESS_FILE="$PROGRESS_FILE_DEFAULT"
    local TIMEOUT="$TIMEOUT_DEFAULT" RESUME=false RETRY_COVER_ONLY=false NO_COVER=false
    local mode="full"

    # 解析参数
    while [ $# -gt 0 ]; do
        case "$1" in
            --help|-h)   show_help; exit 0 ;;
            --list)      LIST_FILE="$2"; shift 2 ;;
            --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
            --progress)  PROGRESS_FILE="$2"; shift 2 ;;
            --timeout)   TIMEOUT="$2"; shift 2 ;;
            --model)     MODEL="$2"; shift 2 ;;
            --resume)    RESUME=true; shift ;;
            --retry-cover-only) RETRY_COVER_ONLY=true; shift ;;
            --no-cover)  NO_COVER=true; shift ;;
            *) fail "未知参数: $1 (用 --help 查看帮助)"; exit 1 ;;
        esac
    done

    # 校验
    [ -n "$LIST_FILE" ] || { fail "缺少 --list <文件> (用 --help 查看帮助)"; exit 1; }
    [ -f "$LIST_FILE" ] || die "列表文件不存在: $LIST_FILE"
    check_deps || exit 1
    command -v opencode &>/dev/null || die "opencode 未安装或不在 PATH 中"

    if [ "$NO_COVER" = false ] && [ ! -f "$GENERATE_COVER_SCRIPT" ]; then
        warn "封面生成脚本不存在: $GENERATE_COVER_SCRIPT"
        warn "封面生成将不可用。设置 SHADOW_COVER_SCRIPT 环境变量指定路径。"
    fi

    mkdir -p "$OUTPUT_DIR"
    OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)"

    # 读列表
    local novels=()
    while IFS= read -r line; do
        line="${line//$'\r'/}"
        [[ -z "$line" ]] && continue
        [[ "$line" =~ ^[[:space:]]*# ]] && continue
        [ -f "$line" ] && novels+=("$line") || warn "跳过不存在的文件: $line"
    done < "$LIST_FILE"

    [ ${#novels[@]} -gt 0 ] || die "列表中没有找到有效的小说文件"

    heading "批量生成 shadow 技能"
    info "共 ${#novels[@]} 部小说"
    info "输出目录: $OUTPUT_DIR"
    info "进度文件: $PROGRESS_FILE"
    info "单部超时: ${TIMEOUT}s"
    [ -n "$MODEL" ] && info "模型: $MODEL"
    [ "$RESUME" = true ] && info "模式: 续传"
    [ "$RETRY_COVER_ONLY" = true ] && info "模式: 仅封面重试"
    [ "$NO_COVER" = true ] && warn "封面生成已禁用"

    # 加载进度
    local progress_data
    progress_data=$(progress_load "$PROGRESS_FILE")

    # 预检查 (仅非 retry 模式)
    if [ "$RETRY_COVER_ONLY" = false ]; then
        for novel in "${novels[@]}"; do
            if progress_is_done "$progress_data" "$novel"; then
                local n=$(basename "$novel")
                if [ "$RESUME" = true ] || [ -d "$OUTPUT_DIR/${n%.txt}-shadow" ]; then
                    skip "$n (已完成, 跳过)"
                fi
            fi
        done
    fi

    local total=${#novels[@]}
    local done_count=0 skip_count=0 fail_count=0 cover_fail=0
    local start_all=$(date +%s)

    for novel in "${novels[@]}"; do
        local novel_name=$(basename "$novel" .txt)
        # 规范化目录名: 转小写, 空格→短横, 去特殊字符, 加 -shadow
        local slug=$(slug_from_path "$novel")
        local shadow_dir="$OUTPUT_DIR/${slug}-shadow"

        echo ""

        # ---- 续传跳过 ----
        if [ "$RETRY_COVER_ONLY" = false ]; then
            if progress_is_done "$progress_data" "$novel"; then
                if [ "$RESUME" = true ]; then
                    skip "$novel_name (已完成)"
                    ((skip_count++)) || true
                    continue
                fi
            fi
        fi

        # ---- 仅封面重试 ----
        if [ "$RETRY_COVER_ONLY" = true ]; then
            if ! progress_is_cover_failed "$progress_data" "$novel"; then
                skip "$novel_name (非封面失败)"
                ((skip_count++)) || true
                continue
            fi
            # 检查是否有 shadow 目录
            if [ ! -d "$shadow_dir" ]; then
                fail "$novel_name: shadow 目录不存在, 无法重试封面"
                ((fail_count++)) || true
                continue
            fi
            info "重试封面: $novel_name"
            if retry_cover "$shadow_dir"; then
                progress_save "$PROGRESS_FILE" "$novel" "done"
                ok "$novel_name (封面已修复)"
                ((done_count++)) || true
            else
                fail "$novel_name (封面重试失败)"
                ((cover_fail++)) || true
            fi
            continue
        fi

        # ---- 完整处理 ----
        [ -f "$novel" ] || { fail "$novel_name: 源文件已不存在"; ((fail_count++)); continue; }

        # 检查 shadow 目录
        if [ -d "$shadow_dir" ] && [ "$RESUME" = false ]; then
            if validate_quiet "$shadow_dir"; then
                skip "$novel_name (shadow 目录已存在且完整)"
                progress_save "$PROGRESS_FILE" "$novel" "done"
                ((skip_count++)) || true
                continue
            else
                warn "$novel_name: shadow 目录存在但不完整, 将重新生成"
            fi
        fi

        # 标记开始
        progress_save "$PROGRESS_FILE" "$novel" "in_progress"

        # 调用 opencode
        process_novel "$novel" "$shadow_dir" "$NO_COVER"
        local process_rc=$?

        # 校验产出
        local validation_ok=true
        local cover_ok=true

        if ! validate_quiet "$shadow_dir"; then
            warn "产出校验未完全通过:"
            validate_shadow_dir "$shadow_dir" >/dev/null || true
            validation_ok=false
        fi

        # 检查封面
        if [ "$NO_COVER" = false ]; then
            if [ ! -f "$shadow_dir/cover.png" ] || [ "$(file_size "$shadow_dir/cover.png")" -le 10240 ]; then
                # 尝试封面重试
                if [ -f "$GENERATE_COVER_SCRIPT" ]; then
                    info "封面缺失, 尝试自动生成..."
                    if ! retry_cover "$shadow_dir"; then
                        cover_ok=false
                    fi
                else
                    cover_ok=false
                fi
            fi
        fi

        # 生成 _meta.json (如果缺失)
        if [ ! -f "$shadow_dir/_meta.json" ]; then
            generate_meta_json "$shadow_dir" "${slug}-shadow"
        fi

        # 最终状态
        if [ "$validation_ok" = true ] && [ "$cover_ok" = true ]; then
            progress_save "$PROGRESS_FILE" "$novel" "done"
            ok "$novel_name → $(basename "$shadow_dir")"
            ((done_count++)) || true
        elif [ "$validation_ok" = true ] && [ "$cover_ok" = false ]; then
            progress_save "$PROGRESS_FILE" "$novel" "cover_failed"
            warn "$novel_name (封面生成失败, 可用 --retry-cover-only 重试)"
            ((cover_fail++)) || true
        else
            progress_save "$PROGRESS_FILE" "$novel" "failed"
            fail "$novel_name (校验未通过)"
            ((fail_count++)) || true
        fi

    done

    local total_elapsed=$(($(date +%s) - start_all))

    # 输出统计
    echo ""
    heading "批量生成完成"
    echo "  总数: ${total}"
    echo "  成功: ${C_GREEN}${done_count}${C_RESET}"
    [ "$skip_count" -gt 0 ] && echo "  跳过: ${C_YELLOW}${skip_count}${C_RESET}"
    [ "$cover_fail" -gt 0 ] && echo "  封面失败: ${C_YELLOW}${cover_fail}${C_RESET}"
    [ "$fail_count" -gt 0 ] && echo "  失败: ${C_RED}${fail_count}${C_RESET}"
    echo "  耗时: ${total_elapsed}s"
    echo ""
    if [ "$cover_fail" -gt 0 ]; then
        tip "封面失败的条目, 可运行: ./batch-create-shadows --list $LIST_FILE --retry-cover-only"
    fi
    if [ "$done_count" -gt 0 ]; then
        tip "生成完成的 shadow 位于: $OUTPUT_DIR"
        tip "注册到 skill_registry: ls -d $OUTPUT_DIR/*-shadow/ > list.txt && ./register-shadow --batch list.txt"
    fi
}

main "$@"
