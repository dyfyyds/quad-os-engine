"""前后端整拍 parity：后端 twin_engine.tick 必须与前端 localTick 逐拍一致。

金标准来自 frontend/scripts/twin_oracle.mjs（纯 localTick 跑 30 拍）。
首个不一致即定位（含 tick 号 + 字段 diff）。
"""
import json
from pathlib import Path

import pytest

from app.engines import twin_engine

FIX = Path(__file__).parent / "fixtures"


def _load(name):
    return json.loads((FIX / name).read_text(encoding="utf-8"))


def _first_diff(a, b, path=""):
    """返回首个不一致的路径字符串，便于定位。"""
    if isinstance(a, dict) and isinstance(b, dict):
        if set(a.keys()) != set(b.keys()):
            return f"{path}: keys {set(a.keys()) ^ set(b.keys())}"
        for k in a:
            d = _first_diff(a[k], b[k], f"{path}.{k}")
            if d:
                return d
        return None
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return f"{path}: len {len(a)} != {len(b)}"
        for i, (x, y) in enumerate(zip(a, b)):
            d = _first_diff(x, y, f"{path}[{i}]")
            if d:
                return d
        return None
    if a != b:
        return f"{path}: {a!r} != {b!r}"
    return None


def test_30_tick_parity_with_frontend():
    state = _load("twin_init.json")
    expected = _load("twin_expected.json")
    for exp in expected:
        state, events = twin_engine.tick(state)
        ed = _first_diff(events, exp["events"], "events")
        assert ed is None, f"tick {exp['tick']} 事件不一致 @ {ed}"
        sd = _first_diff(state, exp["state"], "state")
        assert sd is None, f"tick {exp['tick']} 状态不一致 @ {sd}"
