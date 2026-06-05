---
name: novel-shadow-creator
description: Meta-skill that transforms any public domain novel into a shadow writing skill. Follows 4-phase workflow: analysis → creative decisions → skill materialization → delivery. Produces skills capable of generating 200,000+ word original novels with intertextual DNA from the source work.
cn_name: 灰度改写元技能
cn_description: 将任何公版小说转化为灰度改写长篇创作 Skill 的元技能。遵循4阶段工作流：原作消化→创作决策→Skill物化→交付。产出的Skill能持续产出20万字+的"灰度改写"长篇新作。
---

# novel-shadow-creator (灰度改写元技能)

> 基于经典公版小说，全自动孵化出"灰度改写长篇创作 Skill"的元技能。

## 什么是灰度改写

- **不是翻译**：直接译就是抄袭
- **不是续写**：不在原作世界里写新故事
- **不是戏仿**：不是搞笑致敬
- **是互文性写作**：保留原作 DNA（风格、骨架、人物原型、主题内核），全移植到新背景
- **目标效果**：读过原作的人感到"似曾相识但说不准是哪本"，没读过的人当成独立作品也成立

## 使用方式

```
use_skill("novel-shadow-creator")
提供一本公版小说 TXT 路径
```

## 4阶段工作流

### Phase A：原作消化（自动）
1. 基础统计分析（词频、句长、对话占比等）
2. 风格指纹提取（10维度YAML，含10条golden_samples）
3. 3句话内核提炼

### Phase B：创作决策（自动，不询问用户）
1. 3个候选新背景方案，自动选最优
2. 5个核心人物设计
3. 60章大纲（6硬节点 + 54过渡章）

### Phase C：Skill物化
产出完整子Skill目录，含以下文件（共12个）：

**核心文件（10个）：**
1. `SKILL.md` — 子Skill入口与核心设定
2. `README.md` — 说明文档
3. `style_fingerprint.yaml` — 风格指纹（含10条范例）
4. `outline.json` — 60章大纲（6硬节点）
5. `state.json` — 状态机
6. `summaries.md` — 章节梗概历史
7. `chapter_prompt.md` — 写章prompt模板
8. `self_check.md` — 章末自检模板
9. `chapters/` — 章节存放目录
10. `scripts/` — `similarity_check.py` + `state_machine.py`

**元数据文件（2个）：**
11. `novel_metadata.json` — 小说元信息（书名、简介、封面路径）
12. `cover.png` — 小说封面图（3:4比例，768×1024）

### Phase D：交付
告知用户子Skill路径与使用方式。

## novel_metadata.json 格式规范

每个子Skill目录下必须包含 `novel_metadata.json`，方便后端直接读取小说元信息。

```json
{
  "title": "中文书名",
  "title_en": "English Title",
  "source": {
    "title": "Original Work Title",
    "author": "Author Name",
    "year": 1865,
    "public_domain": true
  },
  "description": "中文简介，150-200字，适合小说平台展示",
  "description_en": "English description, 80-120 words",
  "cover_image": "./cover.png",
  "cover_prompt": "生成封面时使用的英文prompt",
  "genre": "中文类型标签",
  "genre_en": "English Genre Tags",
  "word_count_target": 200000,
  "total_chapters": 60,
  "chapters_completed": 0,
  "shadow_intensity": 0.5,
  "protagonist": "主角名 (Name)",
  "setting": "故事背景",
  "cover_generated_by": "Pollinations.ai",
  "cover_resolution": "768x1024 (3:4)",
  "created_at": "YYYY-MM-DD"
}
```

## 封面生成 (cover.png)

使用免费生图API **Pollinations.ai** 生成小说封面，无需注册、无API Key、免费使用。

### API格式
```
https://image.pollinations.ai/prompt/{URL-encoded-prompt}?width=768&height=1024&nologo=true
```

### 参数说明
| 参数 | 值 | 说明 |
|------|----|------|
| width | 768 | 宽度（3:4比例） |
| height | 1024 | 高度（3:4比例） |
| nologo | true | 去除水印 |
| model | flux (默认) | 生成模型 |

### 封面Prompt编写原则
1. 必须以 `Anime book cover illustration, 3:4 vertical` 开头
2. 描述主角外貌特征和姿态
3. 描述场景/背景氛围
4. 指定色调和美术风格
5. 结尾加 `Chinese light novel cover art style`
6. prompt必须为英文，以获得最佳生图效果

### 生成示例
```bash
curl -s -o cover.png \
  "https://image.pollinations.ai/prompt/Anime%20book%20cover%20illustration%2C%2034%20vertical.%20{具体描述}.%20Chinese%20light%20novel%20cover%20art%20style?width=768&height=1024&nologo=true"
```

### 注意事项
- 该API每次只允许1个并发请求，需串行生成
- 生图耗时约3-10秒
- 建议根据生成结果调整prompt重试，直到封面效果满意

## 7大不崩机制

1. **风格指纹注入**：每章写作前加载style_fingerprint.yaml
2. **状态机读写**：每章必读/必写state.json
3. **双轨大纲**：60章主线柔性，6硬节点刚性
4. **滚动窗口**：上下文控制在30K token以内
5. **相似度校验**：BLEU检测 + Jaccard重合度
6. **章末5项自检**：字数/风格/相似度/状态一致性/大纲符合度
7. **人工干预接口**：每10章软暂停，硬节点强制暂停

## 法律红线

仅处理公版书或用户明确授权的作品。
