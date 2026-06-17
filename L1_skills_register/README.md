# Shadow 技能管理工具集

本目录包含一套将公版小说批量转化为 shadow 写作技能、注册到 skill_registry、以及下架管理的完整工具链。

## 工具概览

| 脚本 | 用途 |
|---|---|
| `batch-create-shadows.sh` | 批量将公版小说 `.txt` 通过 AI 转化为 shadow 技能目录 |
| `register-shadow.sh` | 将 shadow 目录拷贝到 `fixtures/`，完成注册 |
| `unregister-shadow.sh` | 从 `fixtures/` 中删除已注册的 shadow，完成下架 |
| `shadow_utils.sh` | 共享函数库（颜色输出、校验、JSON 读取等），被以上三个脚本引用 |

---

## 完整工作流

```
.txt 小说文件
    │
    ▼
batch-create-shadows.sh   ← AI 驱动，生成 shadow 目录
    │
    ▼
shadow_output/*-shadow/   ← 产出目录
    │
    ▼
register-shadow.sh        ← 注册到 fixtures/
    │
    ▼
skill_registry 重启       ← 前端可识别
    │
    ▼
unregister-shadow.sh      ← 下架（从 fixtures/ 删除）
```

---

## 1. batch-create-shadows.sh

将一批公版小说 `.txt` 文件，通过 opencode (AI) 逐个转化为 shadow 写作技能目录。

```bash
./batch-create-shadows.sh --list novels.txt
```

### 参数

| 参数 | 说明 |
|---|---|
| `--list FILE` | **必填**。小说列表文件，每行一个 `.txt` 绝对路径 |
| `--output-dir DIR` | 输出目录（默认 `./shadow_output`） |
| `--progress FILE` | 进度跟踪文件（默认 `./batch_progress.json`） |
| `--timeout SECONDS` | 单部小说处理超时（默认 2400 = 40分钟） |
| `--model PROVIDER/MODEL` | 指定 opencode 的模型 |
| `--resume` | 从上次中断处续传 |
| `--retry-cover-only` | 仅重试封面生成失败的条目 |
| `--no-cover` | 跳过封面生成 |
| `--help` | 显示帮助 |

### 输入文件格式

```
/data/novels/Dracula.txt
/data/novels/Frankenstein.txt
# 以 # 开头为注释，空行自动跳过
```

### 续传与重试

```bash
# 中断后续传
./batch-create-shadows.sh --list novels.txt --resume

# 仅重试失败的封面
./batch-create-shadows.sh --list novels.txt --retry-cover-only
```

### 环境变量

| 变量 | 说明 |
|---|---|
| `SHADOW_OPENCODE_MODEL` | 指定模型，如 `deepseek/deepseek-v4-pro` |
| `SHADOW_OPENAIDE_DIR` | opencode 工作目录（默认 `/home/main-repo`） |
| `SHADOW_COVER_SCRIPT` | 封面生成脚本路径 |
| `SHADOW_OWNER_ID` | `_meta.json` 中的 ownerId |

---

## 2. register-shadow.sh

将 shadow 目录拷贝到 `fixtures/` 目录完成注册。注册后需重启 skill_registry 才能生效。

```bash
# 注册单个
./register-shadow ./Dracula-shadow

# 注册多个
./register-shadow ./a-shadow ./b-shadow ./c-shadow

# 批量注册
ls -d ./shadow_output/*-shadow/ > to_register.txt
./register-shadow --batch to_register.txt
```

### 参数

| 参数 | 说明 |
|---|---|
| `<shadow-dir>...` | 一个或多个 shadow 目录路径 |
| `--batch FILE` | 从文件读取目录列表（一行一个） |
| `--dry-run` | 只校验不拷贝 |
| `--force` | 覆盖 fixtures 中已存在的同名目录 |
| `--fixtures DIR` | 指定 fixtures 目录（默认 `./fixtures`） |
| `--help` | 显示帮助 |

### 工作流程

1. 对每个 shadow 目录执行 13 项校验
2. 校验通过 → 拷贝到 `FIXTURES_DIR/`
3. 校验失败 → 跳过并打印缺失项
4. 打印统计：已注册 / 跳过 / 失败

### 环境变量

| 变量 | 说明 |
|---|---|
| `SHADOW_FIXTURES_DIR` | fixtures 目录路径（默认 `./fixtures`） |
| `FORCE_COLOR=1` | 强制彩色输出 |

---

## 3. unregister-shadow.sh

从 `fixtures/` 中删除已注册的 shadow 目录，完成下架。

### 三种使用模式

**交互模式**（推荐新手）：
```bash
./unregister-shadow
# 展示所有已注册 shadow 表格 → 输入编号/名称 → 确认后删除
```

**直接模式**：
```bash
./unregister-shadow middlemarch-shadow
./unregister-shadow "西望镇" 1-3 moby-dick-shadow
```

**批量模式**：
```bash
./unregister-shadow --batch to_delete.txt
```

### 参数

| 参数 | 说明 |
|---|---|
| `--batch FILE` | 从文件读取选择器（每行支持编号/slug/书名） |
| `--all` | 删除全部，需二次确认 |
| `--dry-run` | 只展示将要删除的，不实际删除 |
| `--force, -y` | 跳过确认直接删除 |
| `--fixtures DIR` | 指定 fixtures 目录 |
| `--help` | 显示帮助 |

### 选择器语法

| 写法 | 含义 |
|---|---|
| `1` | 删除第 1 个 |
| `1,3,5` | 删除第 1、3、5 个 |
| `1-3` | 删除第 1 到第 3 个 |
| `1,3,5-7` | 删除第 1、3、5、6、7 个 |
| `middlemarch-shadow` | 按 slug 精确匹配 |
| `西望镇` | 按中文书名模糊匹配 |

### 确认机制

- 普通删除：输入 `yes` 确认
- `--all` 全部删除：输入 `DELETE <数量>` 确认（防手滑）
- `--force` / `-y`：跳过所有确认

---

## 4. shadow_utils.sh

被以上三个脚本通过 `source` 引用，提供：

- **颜色输出函数**：`ok`、`skip`、`fail`、`warn`、`info`、`tip`、`die`、`heading`
- **路径工具**：`slug_from_path`、`get_fixtures_dir`
- **JSON 读取**：`_meta_slug`、`_novel_title`、`_novel_cover_prompt` 等
- **文件校验**：`validate_shadow_dir`（13 项详细校验）、`validate_quiet`（快速校验）
- **工具函数**：`human_size`、`file_size`、`dir_total_size`、`chapter_count`
- **依赖检查**：`check_deps`（检查 python3 等）
- **确认对话**：`confirm`、`confirm_delete_all`
- **超时执行**：`run_with_timeout`
- **列表解析**：`parse_list_file`

一般不直接调用此脚本，而是由其他三个脚本自动引用。

---

## 注册生效

`register-shadow.sh` 和 `unregister-shadow.sh` 操作完成后，都需要重启 skill_registry 才能使变更生效：

```bash
pkill skill_registry
./skill_registry --port 18090 --internal-auth="" \
    --cover-bin /path/to/novelcover_pure \
    --fonts-dir /path/to/fonts \
    > /tmp/sr.log 2>&1 &
```

或使用 `start_all.sh` 一键重启全部服务。
