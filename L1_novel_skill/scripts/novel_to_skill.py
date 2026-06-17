#!/usr/bin/env python3
"""
novel_to_skill.py — 小说转子Skill管道脚本
将公版小说自动转化为灰度改写创作子Skill，包含封面图生成。

4阶段自动化：
  Phase A: 原作消化（统计 + 风格指纹 + 内核提炼）
  Phase B: 创作决策（大纲 + 角色 + 背景模板）
  Phase C: Skill物化（目录 + 12文件 + 封面图）
  Phase D: 交付（输出路径 + 使用说明）

用法:
  python3 scripts/novel_to_skill.py --source 源小说.txt --output ./子skill目录/
  python3 scripts/novel_to_skill.py --source 源小说.txt --output ./子skill目录/ \
      --title "书名" --protagonist "主角名" --no-cover
"""

import argparse
import json
import math
import os
import re
import shutil
import subprocess
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple


# ============================================================
# 文本分析工具
# ============================================================

def _is_chinese(char: str) -> bool:
    return '\u4e00' <= char <= '\u9fff'


def _is_punctuation(char: str) -> bool:
    return char in '，。！？；：、""''（）《》【】…—·～\n\r\t '


def _count_chinese_chars(text: str) -> int:
    return sum(1 for c in text if _is_chinese(c))


def _count_total_chars(text: str) -> int:
    return len(text.replace('\n', '').replace('\r', '').replace(' ', ''))


def _split_sentences(text: str) -> List[str]:
    """按中文句末标点切分句子"""
    sentences = re.split(r'[。！？!?…]+', text)
    return [s.strip() for s in sentences if s.strip() and _count_chinese_chars(s) >= 3]


def _split_paragraphs(text: str) -> List[str]:
    """按双换行切分段落"""
    paras = re.split(r'\n\s*\n', text)
    return [p.strip() for p in paras if p.strip() and _count_chinese_chars(p) >= 10]


def _detect_dialogue_lines(text: str) -> List[str]:
    """检测对话行（引号内的内容）"""
    patterns = [
        r'「[^」]+」',
        r'『[^』]+』',
        r'"[^"]{5,}"',
        r'"[^"]{5,}"',
        r'“[^”]{5,}”',
    ]
    dialogues = []
    for p in patterns:
        dialogues.extend(re.findall(p, text))
    return dialogues


def _detect_chapter_breaks(text: str) -> List[dict]:
    """检测章节分界"""
    patterns = [
        (r'第[零一二三四五六七八九十百千万\d]+[章回节卷篇部]', 'chinese_num'),
        (r'^Chapter\s+[IVXLCDM\d]+', 'roman'),
        (r'^第\s*(\d+)\s*章', 'arabic'),
    ]
    breaks = []
    for line in text.split('\n'):
        line = line.strip()
        if not line or len(line) > 60:
            continue
        for pat, pat_type in patterns:
            m = re.match(pat, line)
            if m:
                breaks.append({'title': line, 'type': pat_type})
                break
    return breaks


def _extract_frequent_bigrams(text: str, top_n: int = 20) -> List[Tuple[str, int]]:
    """提取高频双字组合（排除标点）"""
    clean = ''.join(c for c in text if not _is_punctuation(c))
    bigrams = [clean[i:i+2] for i in range(len(clean)-1) if _is_chinese(clean[i]) and _is_chinese(clean[i+1])]
    return Counter(bigrams).most_common(top_n)


def _estimate_genre(text: str) -> Dict:
    """通过关键词推断小说类型"""
    genre_keywords = {
        '仙侠': ['仙', '修炼', '灵气', '飞升', '修真', '魔', '妖', '丹药', '渡劫', '剑', '道', '仙境', '神'],
        '武侠': ['江湖', '武功', '内力', '门派', '侠', '剑', '刀', '掌', '拳', '轻功', '真经'],
        '奇幻': ['魔法', '精灵', '龙', '骑士', '咒语', '魔法师', '巫', '王国', '魔族', '圣'],
        '科幻': ['飞船', '星际', '机器人', '外星', '基因', '空间站', '机甲', '维度', '光速'],
        '言情': ['爱', '情', '嫁', '娶', '心', '念', '思', '相思', '姻缘', '宠'],
        '历史': ['皇上', '陛下', '宫中', '太监', '丞相', '将军', '公主', '皇子', '朝代'],
        '悬疑': ['凶手', '死亡', '尸体', '案件', '侦探', '密室', '线索', '血迹', '诡'],
        '都市': ['公司', '城市', '手机', '现代', '老板', '总裁', '办公室', '地铁'],
        '军旅': ['军队', '战争', '炮', '战场', '将军', '士兵', '指挥', '特种兵'],
    }
    scores = Counter()
    for genre, keywords in genre_keywords.items():
        for kw in keywords:
            scores[genre] += text.count(kw)
    top = scores.most_common(3)
    return {
        'primary': top[0][0] if top and top[0][1] > 0 else '未知',
        'secondary': [g for g, c in top[1:] if c > 0],
        'all_scores': dict(top),
    }


def _extract_potential_character_names(text: str, top_n: int = 30) -> List[Tuple[str, int]]:
    """通过对话归属模式提取可能的人物名（2-3字中文名）"""
    name_pattern = re.compile(r'([\u4e00-\u9fff]{2,3})(?:说|道|问|答|叫|喊|叹|笑|骂|哭|吼|喝|吩咐|低声|大声|小声|轻声道)')
    names = name_pattern.findall(text)
    # 过滤常见非人名词
    stop_names = {'一个人', '两个人', '有人', '没有人', '所有人', '为什么', '怎么', '什么',
                  '只是', '可是', '但是', '于是', '不过', '所以', '因为', '如果', '虽然',
                  '忽然', '突然', '然后', '接着', '立刻', '马上', '已经', '一直', '一样',
                  '终于', '还是', '或者', '可以', '需要', '没有', '这里', '那里', '这个',
                  '那个', '有些', '有些', '一下', '一点', '一阵', '一声', '一眼', '这些',
                  '那些', '这样', '那样', '这么', '那么', '自己', '知道', '觉得', '看到',
                  '听到', '想到', '出来', '起来', '下来', '过来', '过去', '回来', '回去',
                  '说道', '问道', '答道'}
    filtered = [(n, c) for n, c in Counter(names).most_common(100) if n not in stop_names]
    return filtered[:top_n]


# ============================================================
# Phase A: 原作消化
# ============================================================

def analyze_novel(text: str) -> Dict:
    """对源小说做全方位统计分析，产出一个 stats dict"""
    chars_total = _count_total_chars(text)
    chinese_chars = _count_chinese_chars(text)

    sentences = _split_sentences(text)
    paragraphs = _split_paragraphs(text)
    dialogues = _detect_dialogue_lines(text)
    chapters = _detect_chapter_breaks(text)
    bigrams = _extract_frequent_bigrams(text)
    genre = _estimate_genre(text)
    names = _extract_potential_character_names(text)

    sentence_lengths = [len(s) for s in sentences]
    para_lengths = [_count_chinese_chars(p) for p in paragraphs]
    dialogue_chars = sum(len(d) for d in dialogues)

    stats = {
        # 基础统计
        'total_chars': chars_total,
        'chinese_chars': chinese_chars,
        'sentence_count': len(sentences),
        'paragraph_count': len(paragraphs),
        'dialogue_count': len(dialogues),
        'chapter_count': len(chapters),
        'estimated_chapters': len(chapters) if chapters else max(1, chinese_chars // 3000),

        # 句长统计
        'avg_sentence_length': round(sum(sentence_lengths) / len(sentence_lengths), 1) if sentence_lengths else 0,
        'max_sentence_length': max(sentence_lengths) if sentence_lengths else 0,
        'min_sentence_length': min(sentence_lengths) if sentence_lengths else 0,
        'long_sentence_ratio': round(sum(1 for l in sentence_lengths if l > 50) / len(sentence_lengths), 4) if sentence_lengths else 0,

        # 段长统计
        'avg_paragraph_length': round(sum(para_lengths) / len(para_lengths), 1) if para_lengths else 0,

        # 对话统计
        'dialogue_ratio': round(dialogue_chars / chinese_chars, 4) if chinese_chars else 0,
        'avg_dialogue_length': round(dialogue_chars / len(dialogues), 1) if dialogues else 0,

        # 词汇统计
        'unique_chars': len(set(c for c in text if _is_chinese(c))),
        'type_token_ratio': 0,  # 下面计算
        'top_bigrams': bigrams[:10],

        # 情绪标点
        'emotional_punctuation_ratio': round(
            sum(1 for c in text if c in '！!？?') / max(1, len(sentences)), 4
        ),

        # 推断信息
        'inferred_genre': genre['primary'],
        'genre_scores': genre['all_scores'],
        'potential_characters': names[:10],
        'chapter_titles': [c['title'] for c in chapters[:10]],
    }

    # type-token ratio (unique bigrams / total bigrams)
    all_bigrams_clean = [
        text[i:i+2] for i in range(len(text)-1)
        if _is_chinese(text[i]) and _is_chinese(text[i+1])
    ]
    if all_bigrams_clean:
        stats['type_token_ratio'] = round(len(set(all_bigrams_clean)) / len(all_bigrams_clean), 4)

    return stats


def generate_style_fingerprint(stats: Dict) -> Dict:
    """基于统计分析生成10维度风格指纹"""
    return {
        'fingerprint_version': '1.0',
        'dimensions': {
            'avg_sentence_length': {
                'value': stats['avg_sentence_length'],
                'description': '平均句子长度（字符数）',
                'guidance': f"每句控制在 {max(15, int(stats['avg_sentence_length']*0.8))}-{int(stats['avg_sentence_length']*1.2)} 字符之间"
            },
            'dialogue_ratio': {
                'value': stats['dialogue_ratio'],
                'description': '对话占比',
                'guidance': f"对话比例保持约 {stats['dialogue_ratio']*100:.0f}%"
            },
            'paragraph_density': {
                'value': stats['avg_paragraph_length'],
                'description': '平均段落长度（汉字数）',
                'guidance': f"段落控制在 {max(50, int(stats['avg_paragraph_length']*0.7))}-{int(stats['avg_paragraph_length']*1.3)} 字之间"
            },
            'vocabulary_richness': {
                'value': stats['type_token_ratio'],
                'description': '词汇丰富度（type-token ratio）',
                'guidance': f"词汇多样性参考值 {stats['type_token_ratio']:.2f}"
            },
            'long_sentence_ratio': {
                'value': stats['long_sentence_ratio'],
                'description': '长句占比（>50字句）',
                'guidance': f"长句比例约 {stats['long_sentence_ratio']*100:.1f}%"
            },
            'emotional_intensity': {
                'value': stats['emotional_punctuation_ratio'],
                'description': '情绪标点密度（！？/句）',
                'guidance': f"每{abs(1/stats['emotional_punctuation_ratio']):.0f}句出现一次情绪标点" if stats['emotional_punctuation_ratio'] > 0 else "情绪表达内敛"
            },
            'narrative_pace': {
                'value': {
                    'sentence_count': stats['sentence_count'],
                    'chapter_estimate': stats['estimated_chapters'],
                },
                'description': '叙述节奏',
                'guidance': f"每章预估 {stats['chinese_chars']//max(1,stats['estimated_chapters'])} 字"
            },
            'dialogue_frequency': {
                'value': stats['avg_dialogue_length'],
                'description': '对话片段平均长度',
                'guidance': f"对话片段约 {stats['avg_dialogue_length']:.0f} 字符"
            },
            'genre_tendency': {
                'value': stats['inferred_genre'],
                'description': '推断类型',
                'guidance': f"作品类型: {stats['inferred_genre']}"
            },
            'core_vocabulary': {
                'value': {bg: cnt for bg, cnt in stats['top_bigrams']},
                'description': '高频核心词汇（双字组合）',
                'guidance': '在写作中适当融入这些词汇以保持风格一致性'
            }
        },
        'computed_at': datetime.now().isoformat(),
        'source_chars_analyzed': stats['chinese_chars'],
    }


def extract_golden_samples(text: str, n: int = 10) -> List[dict]:
    """提取代表性段落作为 golden samples，兼顾叙事和对话"""
    paragraphs = _split_paragraphs(text)
    if not paragraphs:
        return []

    # 对每个段落评分
    scored = []
    for p in paragraphs:
        chars = _count_chinese_chars(p)
        if chars < 30 or chars > 500:
            continue
        has_dialogue = 1 if any(marker in p for marker in ['"', '"', '"', '"', '「', '」', '说', '道', '问']) else 0
        score = chars / 100 + has_dialogue * 2
        scored.append((score, p))

    scored.sort(key=lambda x: -x[0])

    # 均匀采样：从不同长度区间各取若干
    samples = []
    brackets = [
        (30, 80, '短片段'),
        (80, 150, '中片段'),
        (150, 300, '长片段'),
        (300, 500, '特长片段'),
    ]
    for lo, hi, label in brackets:
        candidates = [(s, p) for s, p in scored if lo <= _count_chinese_chars(p) <= hi]
        take = min(3, len(candidates))
        for s, p in candidates[:take]:
            samples.append({
                'type': label,
                'char_count': _count_chinese_chars(p),
                'text': p[:300],
                'has_dialogue': any(m in p for m in ['说', '道', '问', '"', '"', '「']),
            })
        if len(samples) >= n:
            break

    return samples[:n]


def generate_core_summary(stats: Dict) -> Dict:
    """生成3句话内核模板（留给AI填充具体内容）"""
    return {
        'sentence_1': {
            'label': '世界',
            'template': '故事发生在一个___的世界中，___',
            'hint': f"背景类型参考: {stats['inferred_genre']}",
        },
        'sentence_2': {
            'label': '冲突',
            'template': '主角___面临___的挑战，必须在___和___之间做出选择',
            'hint': f"角色参考: {[n for n, _ in stats['potential_characters'][:5]]}",
        },
        'sentence_3': {
            'label': '主题',
            'template': '这是一个关于___、___与___的故事',
            'hint': f"风格参考: 对话占比{stats['dialogue_ratio']*100:.0f}%, 平均句长{stats['avg_sentence_length']:.0f}字",
        },
    }


# ============================================================
# Phase B: 创作决策
# ============================================================

def generate_outline_skeleton(total_chapters: int = 60) -> Dict:
    """生成60章大纲骨架（6硬节点 + 54过渡章模板）"""
    hard_nodes = [
        {
            'chapter': 1, 'name': '开端：机缘初现', 'type': 'opening',
            'summary': '主角在日常中首次遇到打破平静的事件。介绍核心人物与世界规则。',
            'goal': '建立读者对主角的情感连接，抛出第一个悬念'
        },
        {
            'chapter': 10, 'name': '激励事件：被迫启程', 'type': 'inciting_incident',
            'summary': '主角无法再维持现状，被迫踏出舒适区。旧生活被不可逆地打破。',
            'goal': '完成从"普通人"到"行动者"的转变'
        },
        {
            'chapter': 20, 'name': '第一幕结束：无法回头', 'type': 'plot_point_one',
            'summary': '主角做出关键抉择，意识到已经回不去了。新目标正式确立。',
            'goal': '锁定核心矛盾，确立主线目标'
        },
        {
            'chapter': 30, 'name': '中点转折：发现真相', 'type': 'midpoint',
            'summary': '局势剧变。主角发现了关于敌人/世界/自身的关键真相，目标从"获取"转为"挣扎求生"。',
            'goal': '提升 stakes，让成功变得更加不可能'
        },
        {
            'chapter': 45, 'name': '至暗时刻：失去一切', 'type': 'dark_night',
            'summary': '主角遭遇最大挫折，看似一切希望都已破灭。在废墟中找到最后一搏的力量。',
            'goal': '让读者怀疑"这一次真的不行了"'
        },
        {
            'chapter': 60, 'name': '结局：新的开始', 'type': 'climax',
            'summary': '最终对决。核心矛盾爆发与解决。主角已不是最初那个人。留下开放感与余韵。',
            'goal': '满足主线期待，同时为"可能存在的续作"留一线'
        },
    ]

    # 生成过渡章骨架
    chapters = []
    arc_map = {
        (1, 9): '第一卷：旧世界的崩解',
        (10, 19): '第二卷：旅途的起点',
        (20, 29): '第三卷：困境与成长',
        (30, 44): '第四卷：真相的代价',
        (45, 59): '第五卷：至暗中的光',
        (60, 60): '第六卷：终章',
    }

    for ch in range(1, total_chapters + 1):
        is_hard = any(n['chapter'] == ch for n in hard_nodes)
        hn = next((n for n in hard_nodes if n['chapter'] == ch), None)

        arc = '未分配'
        for (lo, hi), name in arc_map.items():
            if lo <= ch <= hi:
                arc = name
                break

        chapters.append({
            'chapter': ch,
            'title': hn['name'] if hn else '',
            'hard_node': is_hard,
            'arc': arc,
            'keywords': [],
            'summary': hn['summary'] + ' [硬节点]' if hn else '[待AI填充]',
            'goal': hn.get('goal', '') if hn else '',
        })

    return {
        'total_chapters': total_chapters,
        'hard_nodes': [
            {'chapter': n['chapter'], 'name': n['name'], 'type': n['type'],
             'summary': n['summary'], 'goal': n['goal']}
            for n in hard_nodes
        ],
        'arcs': [
            {'name': name, 'chapters': f'{lo}-{hi}'}
            for (lo, hi), name in sorted(arc_map.items())
        ],
        'chapters': chapters,
    }


def generate_character_template(stats: Dict, count: int = 5) -> List[dict]:
    """生成核心角色模板（从源小说中提取名字作为占位）"""
    potential_names = [n for n, _ in stats['potential_characters']]
    roles = ['主角', '支持者/导师', '对手/反派', '情感纽带', '笑点/调剂']
    characters = []
    for i in range(count):
        characters.append({
            'id': i + 1,
            'role': roles[i] if i < len(roles) else f'角色{i+1}',
            'name': '',
            'name_hint': potential_names[i] if i < len(potential_names) else f'角色{i+1}',
            'archetype': '',
            'age': '',
            'appearance': '',
            'personality': '',
            'goal': '',
            'secret': '',
            'arc': '',
            'relationship_to_protagonist': '主角' if i == 0 else '',
        })
    return characters


def auto_select_setting(stats: Dict) -> Dict:
    """基于源小说特征自动推荐3个新背景方案，选第一个为默认"""
    genre = stats['inferred_genre']
    candidates = []

    if genre in ('仙侠', '武侠', '奇幻'):
        candidates = [
            {
                'name': f'星际{genre}',
                'description': f'将传统{genre}元素移植到星际殖民时代，功法变为基因锁，门派变为星际势力',
                'era': '未来星际',
                'score': 85,
            },
            {
                'name': f'都市{genre}',
                'description': f'现代都市中隐世的{genre}世界，灵气复苏与科技共存',
                'era': '现代都市',
                'score': 75,
            },
            {
                'name': f'蒸汽{genre}',
                'description': f'维多利亚蒸汽朋克背景下的{genre}世界，机械与玄学交织',
                'era': '蒸汽朋克',
                'score': 65,
            },
        ]
    elif genre in ('言情', '历史'):
        candidates = [
            {
                'name': '平行时空宫廷',
                'description': '与他国爆发战争的架空历史，宫廷与战场双线交织',
                'era': '架空古代',
                'score': 85,
            },
            {
                'name': '民国风云',
                'description': '民国时期，新旧文化碰撞中的爱恨情仇',
                'era': '近代',
                'score': 75,
            },
            {
                'name': '未来宫廷',
                'description': '高科技社会中的宫廷制度，基因贵族与平民的阶级冲突',
                'era': '未来',
                'score': 65,
            },
        ]
    elif genre in ('科幻', '都市'):
        candidates = [
            {
                'name': '赛博都市',
                'description': '高度发达的赛博朋克都市，人与AI的边界模糊',
                'era': '近未来',
                'score': 85,
            },
            {
                'name': '废土重生',
                'description': '大灾难后的废土世界，重建文明的故事',
                'era': '后末日',
                'score': 75,
            },
            {
                'name': '太空殖民地',
                'description': '太空殖民地的生存与斗争，资源稀缺下的道德困境',
                'era': '太空',
                'score': 65,
            },
        ]
    else:
        candidates = [
            {
                'name': '架空大陆',
                'description': '一个与地球相似的架空大陆，有着独特的历史与文化',
                'era': '架空',
                'score': 80,
            },
            {
                'name': '现代平行世界',
                'description': '与我们相似的世界，但某个关键事件改变了历史走向',
                'era': '现代',
                'score': 70,
            },
            {
                'name': '神话复兴',
                'description': '远古神话在现代社会中悄然苏醒',
                'era': '现代奇幻',
                'score': 60,
            },
        ]

    return {
        'selected': candidates[0]['name'],
        'selected_description': candidates[0]['description'],
        'selected_era': candidates[0]['era'],
        'candidates': candidates,
    }


# ============================================================
# Phase C: Skill物化
# ============================================================

def generate_cover_prompt(stats: Dict, setting: Dict) -> str:
    """基于分析结果自动生成封面prompt"""
    genre = stats['inferred_genre']
    characters = [n for n, _ in stats['potential_characters'][:3]]
    era = setting.get('selected_era', '')

    style_map = {
        '仙侠': '古风二次元',
        '武侠': '古风二次元水墨',
        '奇幻': '西方二次元',
        '科幻': '科幻二次元',
        '言情': '唯美古风二次元',
        '历史': '古风二次元写实',
        '悬疑': '暗黑二次元',
        '都市': '都市二次元',
        '军旅': '写实二次元',
    }
    art_style = style_map.get(genre, '二次元')

    prompt_parts = [f'小说封面，{art_style}风格']

    if characters:
        prompt_parts.append(f'主角{characters[0]}')

    if era:
        tone_map = {
            '未来星际': '星空与飞船背景',
            '现代都市': '现代城市夜景',
            '现代': '现代城市背景',
            '近未来': '赛博朋克城市',
            '后末日': '废土荒野',
            '架空古代': '古代宫殿',
            '近代': '民国街景',
            '架空': '奇幻世界',
            '蒸汽朋克': '蒸汽机械',
            '太空': '太空站',
            '未来': '未来都市',
            '现代奇幻': '神话与现代交融',
        }
        prompt_parts.append(tone_map.get(era, era))

    prompt_parts.append(setting.get('selected_description', '').split('，')[0] if setting else '')
    prompt_parts.append('3:4竖版，追求氛围感和故事感')

    prompt = '，'.join(p for p in prompt_parts if p)
    return prompt[:1024]


def _get_script_dir() -> Path:
    return Path(__file__).resolve().parent


def call_generate_cover(prompt: str, output_path: str):
    """调用 generate_cover.py 生成封面"""
    script = _get_script_dir() / 'generate_cover.py'
    if not script.exists():
        print(f'  [警告] 未找到 generate_cover.py，跳过封面生成', file=sys.stderr)
        return

    print(f'  调用 generate_cover.py ...')
    print(f'  Prompt: {prompt[:120]}...')
    try:
        result = subprocess.run(
            [sys.executable, str(script), '--prompt', prompt, '--output', str(output_path)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120
        )
        if result.returncode != 0:
            print(f'  [警告] 封面生成失败: {result.stderr.decode("utf-8", errors="replace")[-300:]}', file=sys.stderr)
        else:
            print(f'  封面已生成: {output_path}')
    except subprocess.CalledProcessError:
        print(f'  [警告] 封面生成失败', file=sys.stderr)

    except subprocess.TimeoutExpired:
        print('  [警告] 封面生成超时', file=sys.stderr)
    except Exception as e:
        print(f'  [警告] 封面生成异常: {e}', file=sys.stderr)


def write_file(path: Path, content: str):
    """写入文件，自动创建父目录"""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding='utf-8')


def copy_script(src_name: str, dest_dir: Path):
    """从当前脚本目录复制脚本到目标目录"""
    src = _get_script_dir() / src_name
    dest = dest_dir / 'scripts' / src_name
    if src.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)


def build_skill_skel_md(stats: Dict, setting: Dict, source_title: str, output_name: str) -> str:
    """生成子Skill的 SKILL.md"""
    genre = stats['inferred_genre']
    characters = [n for n, _ in stats['potential_characters'][:5]]

    return f'''---
name: {output_name}
description: 灰度改写创作 Skill，基于"{source_title}"的风格DNA。在全新世界观中创作15万字+原创长篇（~2500字/章 × 60章）。
---

# {output_name}

基于 "{source_title}" 灰度改写的长篇创作 Skill。

## 核心设定

- **新世界**: {setting['selected']} — {setting['selected_description']}
- **时代背景**: {setting.get('selected_era', '架空')}
- **风格来源**: {source_title}（公版作品）
- **类型**: {genre}
- **字数目标**: 150,000字 / 60章 / ~2,500字/章

## 创作规则

### 写作流程

每章写作必须严格遵循以下步骤：

1. **加载风格指纹** — 读取 `style_fingerprint.yaml`，确保本章写作不偏离风格
2. **读取状态** — 运行 `python3 scripts/state_machine.py read state.json` 获取当前进度
3. **读取大纲** — 从 `outline.json` 获取当前章节规划
4. **读取上下文** — 阅读 `summaries.md` 中的前情提要，以及最近3章全文
5. **写作正文** — 严格控制在 2400-2600 字范围内
6. **更新状态** — 更新 `state.json` 中的角色状态、事件、伏笔
7. **追加摘要** — 在 `summaries.md` 末尾追加本章 ~200字 摘要
8. **自检** — 按 `self_check.md` 逐一核查，通过后再进入下一章

### 7大不崩机制

1. **风格指纹注入** — 每章写作前加载 `style_fingerprint.yaml`
2. **状态机读写** — 每章必读/必写 `state.json`
3. **双轨大纲** — 60章主线柔性，6硬节点刚性
4. **滚动窗口** — 上下文控制在合理范围内
5. **相似度校验** — `python3 scripts/similarity_check.py` 检测 BLEU + Jaccard
6. **章末5项自检** — 字数/风格/相似度/状态一致性/大纲符合度
7. **人工干预接口** — 每10章软暂停，硬节点强制暂停

## 灰度改写原则

- **不是翻译** — 不是把原作逐章翻译成白话
- **不是续写** — 不在原作世界里写新故事
- **不是戏仿** — 不是搞笑致敬
- **是互文性写作** — 保留原作DNA（风格、结构、人物原型、主题内核），全移植到新背景
- **目标效果** — 读过原作的人感到"似曾相识但说不准是哪本"，没读过的人当成独立作品也成立

## 参考角色原型
{chr(10).join(f'- {name}' for name in characters) if characters else '- 待从原作品中提取'}

## 候选新背景
{chr(10).join(f'{i+1}. **{c["name"]}** ({c["score"]}分): {c["description"]}' for i, c in enumerate(setting['candidates']))}

> 当前默认选择: **{setting['selected']}**，可在开始创作前手动更换。

## 法律红线

仅处理公版作品或用户明确授权的作品。灰度改写产生的文本必须与源文本有实质性差异（新角色、新情节、新背景）。
'''


def build_skill_readme_md(output_name: str, source_title: str, setting: Dict) -> str:
    return f'''# {output_name}

基于 "{source_title}" 的灰度改写长篇创作 Skill。

## 世界设定

**{setting['selected']}**: {setting['selected_description']}

## 文件结构

```
├── SKILL.md                   # 核心设定与创作规则
├── README.md                  # 本文件
├── style_fingerprint.yaml     # 风格指纹（10维度，含10条范例）
├── outline.json               # 60章大纲（6硬节点 + 54过渡章）
├── state.json                 # 状态机（角色/事件/伏笔追踪）
├── summaries.md               # 章节梗概累积
├── chapter_prompt.md          # 写章prompt模板
├── self_check.md              # 章末5项自检模板
├── novel_metadata.json        # 小说元信息（书名/简介/封面路径）
├── cover.png                  # 小说封面图（3:4, 768×1024）
├── chapters/                  # 章节存放目录
│   ├── chapter_001.md
│   └── ...
└── scripts/
    ├── similarity_check.py    # BLEU + Jaccard 相似度检测
    └── state_machine.py       # 状态机读写工具
```

## 使用方式

```
use_skill("{output_name}")

或直接按 SKILL.md 中的创作规则进行章节写作。
```
'''


def build_chapter_prompt_md(output_name: str, stats: Dict) -> str:
    return f'''# 写章Prompt模板

## 本章写作指令

你将撰写 **{output_name}** 的第 N 章。

### 写作前必读

1. 读取 `style_fingerprint.yaml` — 风格指纹（10维度约束）
2. 读取 `state.json` — 当前状态（角色位置/活跃事件/未解伏笔）
3. 读取 `outline.json` 中本章的大纲规划
4. 读取 `summaries.md` 末尾的最新摘要
5. 读取 `chapters/` 中的最近3章全文

### 字数要求

**严格控制在 2400-2600 汉字之间**（不含空格、不含标点不计入的符号）。
- 低于 2400 字 → 太短，需扩写
- 超过 2600 字 → 需删减
- 目标: 2500 字

### 写作原则

1. **场景连续性** — 从上章的结尾处自然衔接
2. **人物一致性** — 检查 `state.json` 确认人物当前状态和位置
3. **风格一致性** — 参考 `style_fingerprint.yaml`，保持句长/对话比/段落密度的稳定
4. **伏笔管理** — 适时种植1-2条新伏笔，必要时回收旧伏笔
5. **本章完整性** — 每章应有一个微型"起承转合"

### 参考风格数据

- 平均句长: {stats['avg_sentence_length']} 字符
- 对话占比: {stats['dialogue_ratio']*100:.0f}%
- 平均段落长度: {stats['avg_paragraph_length']} 汉字

### 写作后

1. 写入 `chapters/chapter_NNN.md`
2. 运行 `python3 scripts/state_machine.py <update command> state.json ...` 更新状态
3. 在 `summaries.md` 末尾追加本章摘要
4. 运行 `python3 scripts/self_check.py` 或按 `self_check.md` 进行5项自检
'''


def build_self_check_md() -> str:
    return '''# 章末5项自检模板

每章写作完成后，必须逐项检查以下5项，全部通过才可进入下一章。

---

## 1. 字数检查

- 本章汉字数: `___` 字
- 要求范围: **2400 - 2600 字**
- 通过: ☐

> 计算方法: 去除标点、空格、换行后统计汉字数

---

## 2. 风格一致性检查

对照 `style_fingerprint.yaml` 的10个维度，检查本章是否偏离风格指纹。

| 维度 | 目标值 | 本章值 | 是否偏离 |
|------|--------|--------|----------|
| 平均句长 | ~ 字 | | |
| 对话占比 | ~ % | | |
| 段落密度 | ~ 字/段 | | |
| 长句比例 | ~ % | | |
| 情绪标点密度 | | | |

- 通过: ☐（若无明显偏离）

---

## 3. 相似度检查

运行相似度检测脚本：

```bash
python3 scripts/similarity_check.py chapters/chapter_NNN.md <源小说路径>
```

| 指标 | 阈值 | 本章值 | 是否通过 |
|------|------|--------|----------|
| BLEU | < 0.3 | | |
| Jaccard | ≤ 0.15 | | |

- 通过: ☐（两项均通过）

---

## 4. 状态一致性检查

运行状态验证：

```bash
python3 scripts/state_machine.py validate state.json
```

- 无缺章: ☐
- 无章跳跃: ☐
- 活跃伏笔 ≤ 15条: ☐
- 无死亡角色复现: ☐

- 通过: ☐

---

## 5. 大纲符合度

对比 `outline.json` 中本章的规划：

- 本章是否完成了硬节点的剧情目标？ ☐
- 本章情节是否与主线方向一致？ ☐
- 本章的角色行为是否与 arc 设定一致？ ☐

- 通过: ☐

---

## 总体判定

- 5项全部通过 → ✅ 进入下一章
- 有未通过项 → ❌ 修正后重新自检
'''


def build_summaries_md() -> str:
    return '''# 章节梗概历史

> 每章写作完成后，在此文件末尾追加 ~200字 的章节摘要。
> 格式: `## 第N章 - 章节标题` + 摘要内容

---
'''


def build_novel_metadata(args, stats: Dict, setting: Dict, output_dir: Path) -> Dict:
    """生成 novel_metadata.json"""
    source_name = Path(args.source).stem
    title = args.title or source_name
    characters = [n for n, _ in stats['potential_characters']]
    protagonist = args.protagonist or (characters[0] if characters else '未命名')

    return {
        'title': title,
        'title_en': args.title_en or '',
        'source': {
            'title': source_name,
            'author': args.author or '未知',
            'year': args.year or 0,
            'public_domain': True,
        },
        'description': args.description or f'{title}是一部基于经典作品灰度改写创作的原创长篇{stats["inferred_genre"]}小说，共60章约15万字。',
        'description_en': args.description_en or '',
        'cover_image': './cover.png' if (output_dir / 'cover.png').exists() else '',
        'cover_prompt': args.cover_prompt or '',
        'genre': stats['inferred_genre'],
        'genre_en': '',
        'word_count_target': 150000,
        'total_chapters': 60,
        'chapters_completed': 0,
        'shadow_intensity': args.shadow_intensity or 0.5,
        'protagonist': protagonist,
        'setting': setting['selected_description'],
        'cover_generated_by': '混元 TextToImageLite' if (output_dir / 'cover.png').exists() else '',
        'cover_resolution': '768x1024 (3:4)' if (output_dir / 'cover.png').exists() else '',
        'created_at': datetime.now().strftime('%Y-%m-%d'),
        'created_by': 'novel_to_skill.py (novel-shadow-creator)',
    }


# ============================================================
# Phase D: 交付
# ============================================================

def print_delivery_summary(output_dir: Path, stats: Dict, setting: Dict, cover_generated: bool):
    """打印交付摘要"""
    print()
    print('=' * 60)
    print('  灰度改写子Skill 已生成')
    print('=' * 60)
    print(f'  路径: {output_dir}')
    print()
    print('  包含文件:')
    files = sorted(output_dir.rglob('*'))
    for f in files:
        if f.is_file() and '__pycache__' not in str(f):
            rel = f.relative_to(output_dir)
            size = f.stat().st_size
            print(f'    {rel} ({size} bytes)')
    print()
    print('  📊 分析摘要:')
    print(f'    源文件字数: {stats["chinese_chars"]:,} 汉字')
    print(f'    推断类型: {stats["inferred_genre"]}')
    print(f'    平均句长: {stats["avg_sentence_length"]} 字')
    print(f'    对话占比: {stats["dialogue_ratio"]*100:.0f}%')
    print(f'    新世界观: {setting["selected"]}')
    print(f'    硬节点数: 6 / 目标总章数: 60')
    if cover_generated:
        print(f'    封面: ✅ 已生成 (768×1024)')
    else:
        print(f'    封面: ⚠️  未生成（如需生成请确保配置了腾讯云密钥）')
    print()
    print('  使用方式:')
    print(f'    use_skill("{output_dir.name}")')
    print()
    print('  写作流程:')
    print('    1. 每章写作前读取 style_fingerprint.yaml + state.json')
    print('    2. 写入 chapters/chapter_NNN.md (2400-2600字)')
    print('    3. 运行 self_check.md 中的5项自检')
    print('    4. 更新 state.json + summaries.md')
    print('=' * 60)


# ============================================================
# 主入口
# ============================================================

def main():
    parser = argparse.ArgumentParser(
        description='小说转子Skill管道 — 将公版小说自动转化为灰度改写创作子Skill',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
示例:
  python3 scripts/novel_to_skill.py --source 红楼梦.txt --output ./dream-red-mansion-shadow/
  python3 scripts/novel_to_skill.py --source 源.txt --output ./my-skill/ \\
      --title "我的小说" --protagonist "林飞" --author "原作作者" --year 1865
  python3 scripts/novel_to_skill.py --source 源.txt --output ./my-skill/ --no-cover
        '''
    )

    parser.add_argument('--source', required=True, help='源小说 TXT 文件路径')
    parser.add_argument('--output', required=True, help='输出子Skill目录路径')
    parser.add_argument('--title', default=None, help='新书名（默认取文件名）')
    parser.add_argument('--title-en', default=None, help='英文书名')
    parser.add_argument('--author', default=None, help='原作者')
    parser.add_argument('--year', type=int, default=None, help='原作出版年份')
    parser.add_argument('--protagonist', default=None, help='主角名')
    parser.add_argument('--description', default=None, help='小说简介（150-200字）')
    parser.add_argument('--description-en', default=None, help='英文简介')
    parser.add_argument('--shadow-intensity', type=float, default=0.5, help='灰度强度 (0-1, 默认0.5)')
    parser.add_argument('--no-cover', action='store_true', help='跳过封面生成')
    parser.add_argument('--cover-prompt', default=None, help='自定义封面prompt（覆盖自动生成的prompt）')

    args = parser.parse_args()

    source_path = Path(args.source)
    if not source_path.exists():
        print(f'错误: 源文件不存在: {source_path}', file=sys.stderr)
        sys.exit(1)
    if not source_path.is_file():
        print(f'错误: 源路径不是文件: {source_path}', file=sys.stderr)
        sys.exit(1)

    output_dir = Path(args.output).resolve()
    if output_dir.exists():
        print(f'警告: 输出目录已存在，将覆写内容: {output_dir}')

    # ============================================================
    # Phase A: 原作消化
    # ============================================================
    print(' Phase A: 分析源小说...')
    text = source_path.read_text(encoding='utf-8', errors='replace')
    print(f'  已读取: {len(text):,} 字符')

    stats = analyze_novel(text)
    print(f'  分析完成: {stats["chinese_chars"]:,} 汉字, {stats["sentence_count"]:,} 句, '
          f'{stats["paragraph_count"]:,} 段, 对话率 {stats["dialogue_ratio"]*100:.0f}%')

    fingerprint = generate_style_fingerprint(stats)
    samples = extract_golden_samples(text, n=10)
    print(f'  风格指纹: 10维度, {len(samples)}条范例')

    core = generate_core_summary(stats)

    # ============================================================
    # Phase B: 创作决策
    # ============================================================
    print(' Phase B: 创作决策...')
    setting = auto_select_setting(stats)
    print(f'  新世界观: {setting["selected"]} — {setting["selected_description"]}')

    outline = generate_outline_skeleton(total_chapters=60)
    print(f'  大纲: {outline["total_chapters"]}章（{len(outline["hard_nodes"])}硬节点）')

    characters = generate_character_template(stats, count=5)
    print(f'  角色模板: {len(characters)}个核心角色')

    # ============================================================
    # Phase C: Skill物化
    # ============================================================
    print(' Phase C: Skill物化...')
    source_title = args.title or source_path.stem
    output_name = args.output.rstrip('/').rstrip('\\').split('/')[-1].split('\\')[-1] or f'{source_title}-shadow'

    # 创建目录结构
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / 'chapters').mkdir(exist_ok=True)
    print(f'  目录: {output_dir}')

    # 1. SKILL.md
    skel_md = build_skill_skel_md(stats, setting, source_title, output_name)
    write_file(output_dir / 'SKILL.md', skel_md)
    print(f'  写入: SKILL.md')

    # 2. README.md
    readme_md = build_skill_readme_md(output_name, source_title, setting)
    write_file(output_dir / 'README.md', readme_md)
    print(f'  写入: README.md')

    # 3. style_fingerprint.yaml
    import yaml
    fingerprint_with_samples = dict(fingerprint)
    fingerprint_with_samples['golden_samples'] = samples
    fingerprint_with_samples['core_summary'] = core
    write_file(output_dir / 'style_fingerprint.yaml',
               yaml.dump(fingerprint_with_samples, allow_unicode=True, default_flow_style=False))
    print(f'  写入: style_fingerprint.yaml')

    # 4. outline.json
    write_file(output_dir / 'outline.json',
               json.dumps(outline, ensure_ascii=False, indent=2))
    print(f'  写入: outline.json')

    # 5. state.json — 调用 state_machine.py init
    state_machine_script = _get_script_dir() / 'state_machine.py'
    state_json_path = output_dir / 'state.json'
    if state_machine_script.exists():
        subprocess.run(
            [sys.executable, str(state_machine_script), 'init', str(state_json_path)],
            check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE
        )
        print(f'  写入: state.json (state_machine.py init)')
    else:
        print(f'  警告: 未找到 state_machine.py，跳过 state.json 初始化')

    # 6. summaries.md
    write_file(output_dir / 'summaries.md', build_summaries_md())
    print(f'  写入: summaries.md')

    # 7. chapter_prompt.md
    write_file(output_dir / 'chapter_prompt.md', build_chapter_prompt_md(output_name, stats))
    print(f'  写入: chapter_prompt.md')

    # 8. self_check.md
    write_file(output_dir / 'self_check.md', build_self_check_md())
    print(f'  写入: self_check.md')

    # 9. chapters/ — already created above
    print(f'  目录: chapters/ (空)')

    # 10. scripts/
    copy_script('similarity_check.py', output_dir)
    copy_script('state_machine.py', output_dir)
    print(f'  复制: scripts/similarity_check.py')
    print(f'  复制: scripts/state_machine.py')

    # 11. Cover image
    cover_generated = False
    if not args.no_cover:
        print('  生成封面...')
        cover_prompt = args.cover_prompt or generate_cover_prompt(stats, setting)
        cover_output = output_dir / 'cover.png'
        call_generate_cover(cover_prompt, str(cover_output))
        cover_generated = cover_output.exists()
    else:
        print('  封面: 已跳过 (--no-cover)')

    # 12. novel_metadata.json
    metadata = build_novel_metadata(args, stats, setting, output_dir)
    write_file(output_dir / 'novel_metadata.json',
               json.dumps(metadata, ensure_ascii=False, indent=2))
    print(f'  写入: novel_metadata.json')

    # ============================================================
    # Phase D: 交付
    # ============================================================
    print_delivery_summary(output_dir, stats, setting, cover_generated)


if __name__ == '__main__':
    main()
