"""扫全部 dsh 会话日志，找「工具调用循环」的真实证据（只读）。

判据与官方 repeat-tool-reminder 同口径：
  连续 (name, canonicalize(arguments)) 相同的链 ≥3 次。
额外统计：单回合工具调用总数、单 step 输出字符数（找输出侧复读）。
用法：uv run --no-project --with zstandard python scripts/scan-session-loops.py <sessionsRoot>
"""
import json
import sys
from pathlib import Path

import zstandard

# Windows 控制台默认 GBK，中文输出会乱码；强制 UTF-8 并容错
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def canonical(value):
    """官方 canonicalize 的同款：深键排序后 JSON.stringify（Python 侧等价实现）。"""
    def sort_keys(v):
        if isinstance(v, dict):
            return {k: sort_keys(v[k]) for k in sorted(v)}
        if isinstance(v, list):
            return [sort_keys(x) for x in v]
        return v
    return json.dumps(sort_keys(value), sort_keys=True, separators=(",", ":"))


def decompress(path: Path) -> str:
    dctx = zstandard.ZstdDecompressor()
    with path.open("rb") as fh:
        return dctx.stream_reader(fh).read().decode("utf-8", errors="replace")


def main() -> None:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else r"D:\agent\.dsh\sessions")
    files = sorted(root.rglob("*.jsonl.zstd"))
    print(f"发现 {len(files)} 个会话日志文件")

    tool_chains = []   # 连续同参工具链
    busy_turns = []    # 单回合工具调用数多的
    big_text = []      # 单 step 输出字符数大的
    parsed = 0

    for f in files:
        try:
            text = decompress(f)
        except Exception:
            continue
        events = []
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                pass
        if not events:
            continue
        parsed += 1
        tag = f.parent.name[:8]

        # —— 工具调用链 ——
        by_turn: dict = {}
        for e in events:
            if e.get("type") != "tool/call":
                continue
            d = e.get("data") or {}
            turn = d.get("turn", "?")
            by_turn.setdefault(turn, []).append(
                (d.get("name", "?"), canonical(d.get("arguments", d.get("args"))))
            )
        for turn, calls in by_turn.items():
            prev, run, best, best_tool = None, 0, 0, ""
            for name, key in calls:
                cur = f"{name}|{key}"
                run = run + 1 if cur == prev else 1
                prev = cur
                if run > best:
                    best, best_tool = run, name
            if best >= 3:
                tool_chains.append((best, turn, best_tool, tag, len(calls)))
            if len(calls) >= 25:
                busy_turns.append((len(calls), turn, best_tool, tag))

        # —— 单 step 输出字符数（输出侧复读的直接证据）——
        by_step_text: dict = {}
        for e in events:
            t = e.get("type")
            if t not in ("assistant/message", "assistant/chunk"):
                continue
            d = e.get("data") or {}
            # step 只是回合内的序号，跨回合会重号：键必须带上 turn
            key = (d.get("turn", "?"), d.get("step", "?"))
            message = d.get("message") or {}
            content = message.get("content") or []
            n = 0
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    n += len(block.get("text") or "")
            if n:
                by_step_text[key] = by_step_text.get(key, 0) + n
        for (turn, step), n in by_step_text.items():
            if n >= 30000:
                big_text.append((n, step, tag))

    print(f"成功解析 {parsed} 个会话\n")

    tool_chains.sort(reverse=True)
    print(f"【连续同名同参工具链 ≥3】命中 {len(tool_chains)} 处：")
    for run, turn, tool, tag, total in tool_chains[:15]:
        print(f"  连续 {run:>3} 次  turn={turn}  工具={tool}  该回合共 {total} 次调用  ({tag})")
    if not tool_chains:
        print("  （无）")

    busy_turns.sort(reverse=True)
    print(f"\n【单回合工具调用 ≥25】命中 {len(busy_turns)} 处：")
    for total, turn, tool, tag in busy_turns[:15]:
        print(f"  {total:>4} 次调用  turn={turn}  最热工具={tool}  ({tag})")
    if not busy_turns:
        print("  （无）")

    big_text.sort(reverse=True)
    print(f"\n【单 step 输出 ≥30000 字符】命中 {len(big_text)} 处：")
    for n, step, tag in big_text[:15]:
        print(f"  {n:>7} 字符  step={step}  ({tag})")
    if not big_text:
        print("  （无）")


if __name__ == "__main__":
    main()
