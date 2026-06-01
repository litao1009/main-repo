# novel-shadow-creator

灰度改写长篇创作元技能。

将经典公版小说转化为可复用的"灰度改写"创作 Skill，产出20万字+原创长篇。

## 核心文件

- `SKILL.md` - 元技能入口
- `scripts/similarity_check.py` - BLEU相似度检测脚本
- `scripts/state_machine.py` - 状态机读写工具

## 子Skill文件结构

```
{source-name}-shadow/
├── SKILL.md                   # 子Skill入口
├── README.md                  # 说明文档
├── style_fingerprint.yaml     # 风格指纹（含10条范例）
├── outline.json               # 60章大纲（6硬节点）
├── state.json                 # 状态机
├── summaries.md               # 章节梗概历史
├── chapter_prompt.md          # 写章prompt模板
├── self_check.md              # 章末自检模板
├── novel_metadata.json        # 小说元信息（书名/简介/封面路径）
├── cover.png                  # 小说封面图（9:16, 576×1024）
├── chapters/                  # 章节存放目录
│   ├── chapter_001.md
│   └── ...
└── scripts/
    ├── similarity_check.py
    └── state_machine.py
```

## novel_metadata.json

后端可直接读取的小说元信息文件，包含：
- `title` / `title_en` — 小说书名（中/英）
- `description` / `description_en` — 小说简介（中/英）
- `cover_image` — 封面图片相对路径
- `cover_prompt` — 生成封面时使用的prompt
- `genre` / `genre_en` — 类型标签

## 封面生成

使用 [Pollinations.ai](https://pollinations.ai) 免费生图API生成小说封面（9:16比例，无需API Key）。
详见 SKILL.md 中的"封面生成"章节。
