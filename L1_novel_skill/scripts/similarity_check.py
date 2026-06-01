#!/usr/bin/env python3
"""相似度检测脚本：滑动窗口BLEU + 词汇Jaccard重合度"""
import re
import sys
import json
import math
from collections import Counter
from pathlib import Path


def tokenize(text: str, lang: str = "zh") -> list[str]:
    """简易分词"""
    if lang == "zh":
        tokens = []
        for char in text:
            if '\u4e00' <= char <= '\u9fff':
                tokens.append(char)
            elif char.isalpha():
                tokens.append(char.lower())
            elif char.isdigit():
                tokens.append(char)
        return tokens
    else:
        return re.findall(r'\b\w+\b', text.lower())


def ngram_precision(candidate: list[str], reference: list[str], n: int) -> float:
    """n-gram精确率"""
    if len(candidate) < n:
        return 0.0
    cand_ngrams = Counter(tuple(candidate[i:i+n]) for i in range(len(candidate)-n+1))
    ref_ngrams  = Counter(tuple(reference[i:i+n])   for i in range(len(reference)-n+1))
    total = sum(cand_ngrams.values())
    if total == 0:
        return 0.0
    matches = sum(min(cand_ngrams[g], ref_ngrams.get(g, 0)) for g in cand_ngrams)
    return matches / total


def bleu_score(candidate: list[str], reference: list[str], max_n: int = 3) -> float:
    """简易BLEU (1-3 gram 几何平均)"""
    precisions = []
    for n in range(1, max_n + 1):
        p = ngram_precision(candidate, reference, n)
        if p > 0:
            precisions.append(p)
    if not precisions:
        return 0.0
    geo_mean = math.exp(sum(math.log(p) for p in precisions) / len(precisions))
    if len(candidate) < len(reference):
        return geo_mean * math.exp(1 - len(reference)/len(candidate))
    return geo_mean


def jaccard_similarity(tokens_a: list[str], tokens_b: list[str]) -> float:
    """词汇Jaccard重合度"""
    set_a = set(tokens_a)
    set_b = set(tokens_b)
    if not set_a or not set_b:
        return 0.0
    return len(set_a & set_b) / len(set_a | set_b)


def sliding_bleu_check(chapter_tokens: list[str], source_tokens: list[str],
                        window: int = 50, step: int = 25) -> dict:
    """滑动窗口BLEU检测"""
    max_score = 0.0
    violations = []

    for i in range(0, len(chapter_tokens) - window + 1, step):
        window_tokens = chapter_tokens[i:i + window]
        score = bleu_score(window_tokens, source_tokens)
        if score > max_score:
            max_score = score
        if score > 0.3:
            violations.append({
                "start_pos": i,
                "bleu_score": round(score, 4),
                "text_preview": ''.join(window_tokens[:20])
            })

    return {
        "max_bleu": round(max_score, 4),
        "violation_count": len(violations),
        "violations": violations,
        "pass": len(violations) == 0
    }


def check_chapter(chapter_path: str, source_path: str, lang: str = "zh") -> dict:
    """检查单章"""
    chapter_text = Path(chapter_path).read_text(encoding='utf-8')
    source_text  = Path(source_path).read_text(encoding='utf-8')

    chapter_tokens = tokenize(chapter_text, lang)
    source_tokens  = tokenize(source_text, lang)

    bleu_result = sliding_bleu_check(chapter_tokens, source_tokens)
    jaccard = jaccard_similarity(chapter_tokens, source_tokens)

    result = {
        "chapter": chapter_path,
        "chapter_tokens": len(chapter_tokens),
        "source_tokens": len(source_tokens),
        "max_bleu_window": bleu_result["max_bleu"],
        "bleu_violations": bleu_result["violation_count"],
        "bleu_pass": bleu_result["pass"],
        "jaccard": round(jaccard, 4),
        "jaccard_pass": jaccard <= 0.15,
        "overall_pass": bleu_result["pass"] and jaccard <= 0.15
    }

    return result


def main():
    if len(sys.argv) < 3:
        print("Usage: similarity_check.py <chapter.md> <source.txt> [lang=zh]")
        sys.exit(2)

    chapter_path = sys.argv[1]
    source_path  = sys.argv[2]
    lang         = sys.argv[3] if len(sys.argv) > 3 else "zh"

    result = check_chapter(chapter_path, source_path, lang)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    sys.exit(0 if result["overall_pass"] else 1)


if __name__ == "__main__":
    main()
