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


def test_page_fault_blocks_before_cpu_progress():
    state = _load("twin_init.json")
    running = next(p for p in state["processes"] if p["state"] == "运行")
    running["refString"] = [0]
    running["refPtr"] = 0
    for row in running["pageTable"]:
        row["标志"] = 0
        row["主存块号"] = None

    # Mulberry32(7) 的首次抽样小于 0.4，强制本拍发生访存。
    state["rngState"] = 7
    before_ran = running["ran"]

    state, events = twin_engine.tick(state)

    assert running["state"] == "阻塞"
    assert running["pageWaitingFor"] == 0
    assert running["ran"] == before_ran
    assert running["faults"] == 1
    assert state["memory"]["faults"] == 1
    assert state["memory"]["tickAccess"] == {
        "clock": 1, "pid": running["pid"], "processName": running["name"],
        "performed": True, "result": "fault", "page": 0, "unit": 17,
    }
    assert state["gantt"] == [{"作业": "空闲", "开始": 0, "结束": 1}]
    assert state["metrics"]["cpuUtil"] == 0
    assert any(event["type"] == "缺页中断" for event in events)

    twin_engine._load_page_after_disk_io(
        state, {"进程名": running["name"], "page": 0, "unit": 17},
        lambda *_: None,
    )
    assert running["faults"] == 1
    assert state["memory"]["faults"] == 1
    assert running["pageTable"][0]["标志"] == 1


@pytest.mark.parametrize(
    ("clock", "gantt", "expected"),
    [
        (2, [{"作业": "空闲", "开始": 0, "结束": 2}], 0),
        (2, [{"作业": "init", "开始": 0, "结束": 2}], 100),
        (
            4,
            [
                {"作业": "init", "开始": 0, "结束": 2},
                {"作业": "空闲", "开始": 2, "结束": 4},
            ],
            50,
        ),
    ],
)
def test_cpu_utilization_excludes_idle_segments(clock, gantt, expected):
    state = _load("twin_init.json")
    state["clock"] = clock
    state["gantt"] = gantt

    twin_engine._recompute_runtime_metrics(state)

    assert state["metrics"]["cpuUtil"] == expected


def test_tick_reports_running_process_without_memory_access():
    state = _load("twin_init.json")
    running = next(p for p in state["processes"] if p["state"] == "运行")
    before = (running["refPtr"], running["hits"], running["faults"], list(state["memory"]["frames"]))
    state["rngState"] = 1  # Mulberry32(1) 首次抽样大于 0.4。

    state, events = twin_engine.tick(state)

    assert running["ran"] == 1
    assert (running["refPtr"], running["hits"], running["faults"], state["memory"]["frames"]) == before
    assert state["memory"]["tickAccess"]["result"] == "none"
    assert state["memory"]["tickAccess"]["processName"] == running["name"]
    assert any(event["type"] == "未访存" for event in events)


def test_tick_reports_memory_hit():
    state = _load("twin_init.json")
    running = next(p for p in state["processes"] if p["state"] == "运行")
    resident = next(row for row in running["pageTable"] if row["标志"] == 1)
    running["refString"] = [resident["页号"]]
    running["refPtr"] = 0
    state["rngState"] = 7

    state, events = twin_engine.tick(state)

    assert running["state"] == "运行"
    assert running["ran"] == 1
    assert running["hits"] == 1
    assert state["memory"]["tickAccess"]["result"] == "hit"
    assert state["memory"]["tickAccess"]["page"] == resident["页号"]
    assert any(event["type"] == "访存命中" for event in events)


@pytest.mark.parametrize("algorithm", ["LOOK", "SCAN"])
def test_disk_direction_uses_head_position_before_move(algorithm):
    state = _load("twin_init.json")
    state["config"]["diskAlgo"] = algorithm
    state["disk"]["head"] = 100
    state["disk"]["direction"] = -1
    state["disk"]["activeRequest"] = None
    state["disk"]["queue"] = [{"进程名": "init", "柱面号": 40, "磁道号": 0, "物理记录号": 0}]

    twin_engine._serve_disk(state, lambda *_: None)

    assert state["disk"]["head"] == 40
    assert state["disk"]["direction"] == -1


def test_process_completion_reports_all_released_frames():
    state = _load("twin_init.json")
    running = next(p for p in state["processes"] if p["state"] == "运行")
    owned = [
        (row["主存块号"], row["页号"])
        for row in running["pageTable"] if row["标志"] == 1
    ]
    assert len(owned) == 2
    running["ran"] = running["burst"]

    state, events = twin_engine.tick(state)

    release = next(event for event in events if event["type"] == "内存释放")
    assert f"统一释放 {len(owned)} 个物理页框" in release["desc"]
    for slot, page in owned:
        assert f"块 {slot}(页 {page})" in release["desc"]
        assert state["memory"]["frames"][slot] is None
