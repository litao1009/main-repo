#!/usr/bin/env python3
"""状态机读写工具：read / init / append-event / validate"""
import sys
import json
from datetime import datetime
from pathlib import Path


def read_state(state_path: str) -> dict:
    """读取状态"""
    with open(state_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def write_state(state_path: str, state: dict):
    """写入状态"""
    state["last_updated"] = datetime.now().isoformat()
    with open(state_path, 'w', encoding='utf-8') as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


def init_state(state_path: str):
    """初始化状态"""
    state = {
        "version": "1.0",
        "current_chapter": 0,
        "chapter_completed": [],
        "characters": {},
        "events": [],
        "foreshadowing_active": [],
        "foreshadowing_resolved": [],
        "timeline": "故事尚未开始",
        "current_location": None,
        "world_facts": {},
        "used_shadow_quotes": [],
        "rewrite_history": [],
        "last_updated": datetime.now().isoformat()
    }
    write_state(state_path, state)
    print(f"✓ State initialized at {state_path}")


def update_character(state: dict, name: str, updates: dict):
    """更新角色状态"""
    if name not in state["characters"]:
        state["characters"][name] = {
            "first_appearance": None,
            "status": "alive",
            "location": None,
            "traits": [],
            "relationships": {}
        }
    state["characters"][name].update(updates)


def add_event(state: dict, chapter: int, description: str, characters_involved: list[str]):
    """添加事件"""
    state["events"].append({
        "chapter": chapter,
        "description": description,
        "characters": characters_involved,
        "timestamp": datetime.now().isoformat()
    })


def add_foreshadowing(state: dict, chapter: int, description: str, target_chapter: int = None):
    """添加活跃伏笔"""
    state["foreshadowing_active"].append({
        "chapter_planted": chapter,
        "description": description,
        "target_chapter": target_chapter,
        "status": "active"
    })


def resolve_foreshadowing(state: dict, chapter: int, description_hint: str):
    """解决伏笔"""
    for fs in state["foreshadowing_active"]:
        if description_hint in fs.get("description", ""):
            fs["status"] = "resolved"
            fs["chapter_resolved"] = chapter
            state["foreshadowing_resolved"].append(fs)
            state["foreshadowing_active"].remove(fs)
            return fs
    return None


def validate(state_path: str) -> dict:
    """验证状态一致性"""
    state = read_state(state_path)
    issues = []

    # 检查章节连续性
    completed = sorted(state["chapter_completed"])
    if completed:
        expected = list(range(1, completed[-1] + 1))
        missing = [c for c in expected if c not in completed]
        if missing:
            issues.append(f"Missing chapters: {missing}")

        jumps = []
        for i in range(1, len(completed)):
            if completed[i] - completed[i-1] > 1:
                jumps.append(f"{completed[i-1]} → {completed[i]}")
        if jumps:
            issues.append(f"Chapter jumps: {jumps}")

    # 检查活跃伏笔数量
    active_count = len(state["foreshadowing_active"])
    if active_count > 15:
        issues.append(f"Too many active foreshadowings: {active_count} (max 15)")

    # 检查已死亡角色
    for name, char in state["characters"].items():
        if char.get("status") == "dead" and char.get("reappeared"):
            issues.append(f"Dead character reappeared: {name}")

    result = {
        "valid": len(issues) == 0,
        "issues": issues,
        "chapter_count": len(completed),
        "active_foreshadowing_count": active_count
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return result


def main():
    if len(sys.argv) < 2:
        print("Usage: state_machine.py <command> [args...]")
        print("Commands: init <path> | read <path> | validate <path>")
        sys.exit(2)

    cmd = sys.argv[1]

    if cmd == "init":
        state_path = sys.argv[2] if len(sys.argv) > 2 else "state.json"
        init_state(state_path)

    elif cmd == "read":
        state_path = sys.argv[2] if len(sys.argv) > 2 else "state.json"
        state = read_state(state_path)
        print(json.dumps(state, ensure_ascii=False, indent=2))

    elif cmd == "validate":
        state_path = sys.argv[2] if len(sys.argv) > 2 else "state.json"
        validate(state_path)

    else:
        print(f"Unknown command: {cmd}")
        sys.exit(1)


if __name__ == "__main__":
    main()
