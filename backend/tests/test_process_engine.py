"""进程状态机引擎单元测试。

覆盖：5 种调度算法 × 状态转换 × I/O 阻塞唤醒 × 动态到达 × 指标计算。

引擎时序说明：
  - 引擎初始化时 clock=0，arrival≤0 的进程标记为"就绪"
  - 每次 tick() 先 clock+=1，然后：唤醒阻塞 → 检查到达 → 推进运行 → 调度
  - 因此 arrival=0 的进程在 tick 1 时被调度运行（不是 tick 0）
  - 被唤醒/到达的进程在同一 tick 内可能被立即调度为"运行"
"""
from app.engines import process_engine
from app.engines.process_engine import ProcessEngine, _choose_next

# ────────────────────────── 公共测试数据 ──────────────────────────

PROCS = [
    {"pid": 1, "name": "A", "arrival": 0, "burst": 6, "priority": 3},
    {"pid": 2, "name": "B", "arrival": 0, "burst": 4, "priority": 1},
    {"pid": 3, "name": "C", "arrival": 0, "burst": 8, "priority": 4},
    {"pid": 4, "name": "D", "arrival": 0, "burst": 3, "priority": 2},
]


# ────────────────────────── 1. FCFS 基本生命周期 ──────────────────────────

def test_basic_lifecycle_fcfs():
    """FCFS：创建→就绪→运行→完成，验证完成顺序和指标。"""
    trace = process_engine.run(PROCS, "FCFS")
    order = trace.final_state["完成顺序"]
    # FCFS 按 pid 顺序（arrival 全为 0）
    assert order == ["A", "B", "C", "D"]
    assert trace.metrics["完成进程数"] == 4
    assert trace.metrics["平均周转时间"] > 0
    assert len(trace.steps) > 0
    assert trace.module == "process"
    assert trace.algorithm == "FCFS"


# ────────────────────────── 2. I/O 阻塞与唤醒 ──────────────────────────

def test_io_blocking_and_wake():
    """I/O 阻塞：运行进程被阻塞，I/O 完成后唤醒并重新调度。"""
    procs = [
        {"pid": 1, "name": "A", "arrival": 0, "burst": 10, "priority": 1},
    ]
    engine = ProcessEngine(procs, "FCFS")

    # tick 1: A 被调度运行
    engine.tick()
    assert engine._current is not None
    assert engine._current["name"] == "A"
    assert engine._current["state"] == "运行"

    # tick 2: 强制 I/O 阻塞
    engine.tick(force_io=True)
    blocked = engine._get_by_state("阻塞")
    assert len(blocked) == 1
    assert blocked[0]["name"] == "A"
    assert blocked[0]["io_remaining"] == 3
    assert engine._current is None  # CPU 空闲

    # tick 3,4: A 仍在阻塞，io_remaining 递减
    engine.tick()
    engine.tick()
    blocked = engine._get_by_state("阻塞")
    assert len(blocked) == 1
    assert blocked[0]["io_remaining"] == 1

    # tick 5: A 唤醒回就绪 → 同一 tick 内被调度为运行（唯一进程）
    engine.tick()
    blocked = engine._get_by_state("阻塞")
    assert len(blocked) == 0
    # A 唤醒后被立即调度，所以是运行状态
    assert engine._current is not None
    assert engine._current["name"] == "A"
    assert engine._current["state"] == "运行"

    # 验证事件记录了唤醒
    last_step = engine._steps[-1]
    assert "唤醒" in last_step.description


# ────────────────────────── 3. RR 时间片轮转抢占 ──────────────────────────

def test_rr_preemption():
    """RR：时间片用完后运行进程被抢占，切换到下一个进程。"""
    procs = [
        {"pid": 1, "name": "A", "arrival": 0, "burst": 5, "priority": 1},
        {"pid": 2, "name": "B", "arrival": 0, "burst": 3, "priority": 2},
    ]
    engine = ProcessEngine(procs, "RR", time_quantum=2)

    # tick 1: A 运行（quantum_used=1）
    engine.tick()
    assert engine._current["name"] == "A"

    # tick 2: A 继续运行（quantum_used=2=quantum）→ 时间片到，抢占 → B 调度
    engine.tick()
    # A 被抢占后，B 在同一 tick 被调度
    assert engine._current is not None
    assert engine._current["name"] == "B"

    # 验证甘特图记录了 A 的段
    assert len(engine.gantt) >= 1
    assert engine.gantt[0]["作业"] == "A"


# ────────────────────────── 4. SJF 短作业优先 ──────────────────────────

def test_sjf_scheduling():
    """SJF：优先选 remaining 最小的进程。"""
    trace = process_engine.run(PROCS, "SJF")
    order = trace.final_state["完成顺序"]
    # SJF: D(3) 先于 B(4) 先于 A(6) 先于 C(8)
    assert order[0] == "D"
    assert order[-1] == "C"
    assert trace.metrics["完成进程数"] == 4


# ────────────────────────── 5. HRRN 最高响应比 ──────────────────────────

def test_hrrn_scheduling():
    """HRRN：响应比 = (等待+服务)/服务，优先选最高的。"""
    trace = process_engine.run(PROCS, "HRRN")
    order = trace.final_state["完成顺序"]
    # HRRN 所有进程都能完成
    assert len(order) == 4
    assert trace.metrics["完成进程数"] == 4
    assert trace.metrics["平均周转时间"] > 0
    # 验证 SJF 不等于 HRRN（说明 HRRN 确实用了响应比）
    sjf_trace = process_engine.run(PROCS, "SJF")
    # HRRN 和 SJF 的完成顺序可能不同（取决于数据），但都能完成
    assert len(sjf_trace.final_state["完成顺序"]) == 4


# ────────────────────────── 6. 优先级调度 ──────────────────────────

def test_priority_scheduling():
    """PRIORITY：数字越小优先级越高。"""
    trace = process_engine.run(PROCS, "PRIORITY")
    order = trace.final_state["完成顺序"]
    # 优先级: B(1) > D(2) > A(3) > C(4)
    assert order == ["B", "D", "A", "C"]
    assert trace.metrics["完成进程数"] == 4


# ────────────────────────── 7. CPU 空闲后恢复调度 ──────────────────────────

def test_cpu_idle_then_schedule():
    """当就绪队列为空时 CPU 空闲，进程到达后在同一 tick 被调度。"""
    procs = [
        {"pid": 1, "name": "A", "arrival": 5, "burst": 3, "priority": 1},
    ]
    engine = ProcessEngine(procs, "FCFS")

    # tick 1-4: 无就绪进程，CPU 空闲
    for _ in range(4):
        engine.tick()
        assert engine._current is None

    # tick 5: A 到达 → 同一 tick 内被调度为运行（就绪队列唯一进程）
    engine.tick()
    assert engine._current is not None
    assert engine._current["name"] == "A"
    assert engine._current["state"] == "运行"


# ────────────────────────── 8. 多进程状态转换 ──────────────────────────

def test_multiple_state_transitions():
    """复杂场景：多个进程同时经历不同状态转换。"""
    procs = [
        {"pid": 1, "name": "A", "arrival": 0, "burst": 12, "priority": 1},
        {"pid": 2, "name": "B", "arrival": 2, "burst": 5, "priority": 2},
        {"pid": 3, "name": "C", "arrival": 4, "burst": 3, "priority": 3},
    ]
    engine = ProcessEngine(procs, "FCFS")

    # 运行 10 个 tick
    for _ in range(10):
        engine.tick()

    # 验证有进程在运行或已完成
    states = {p["state"] for p in engine._all_procs.values()}
    assert "运行" in states or "完成" in states
    # 验证 B 和 C 已到达
    arrived = [p for p in engine._all_procs.values() if p["state"] != "新建"]
    assert len(arrived) == 3


# ────────────────────────── 9. Trace 结构完整性 ──────────────────────────

def test_trace_shape():
    """验证 SimulationTrace 输出结构完整。"""
    trace = process_engine.run(PROCS, "FCFS")
    assert trace.module == "process"
    assert trace.algorithm == "FCFS"
    assert isinstance(trace.steps, list)
    assert len(trace.steps) > 0
    assert "完成顺序" in trace.final_state
    assert "甘特图" in trace.final_state
    assert "作业明细" in trace.final_state
    assert len(trace.final_state["作业明细"]) == 4
    assert "平均周转时间" in trace.metrics
    assert "平均带权周转时间" in trace.metrics
    assert "CPU利用率" in trace.metrics

    # 验证 step 结构
    step = trace.steps[0]
    assert hasattr(step, "index")
    assert hasattr(step, "description")
    assert hasattr(step, "state")
    assert hasattr(step, "highlight")


# ────────────────────────── 10. 动态新进程到达 ──────────────────────────

def test_new_arrivals():
    """通过 new_arrivals 动态添加新进程。"""
    procs = [
        {"pid": 1, "name": "A", "arrival": 0, "burst": 4, "priority": 1},
    ]
    engine = ProcessEngine(procs, "FCFS")

    # tick 1: A 运行
    engine.tick()
    assert engine._current["name"] == "A"

    # tick 2: 动态到达新进程 B
    engine.tick(new_arrivals=[{"pid": 2, "name": "B", "burst": 3, "priority": 2}])
    assert 2 in engine._all_procs
    assert engine._all_procs[2]["state"] in ("就绪", "运行")

    # 继续运行直到完成
    trace = engine.run(max_ticks=20)
    assert trace.metrics["完成进程数"] == 2
    assert "B" in trace.final_state["完成顺序"]


# ────────────────────────── 11. 最终指标计算 ──────────────────────────

def test_final_metrics():
    """验证最终指标计算的正确性。"""
    procs = [
        {"pid": 1, "name": "A", "arrival": 0, "burst": 3, "priority": 1},
        {"pid": 2, "name": "B", "arrival": 0, "burst": 3, "priority": 2},
    ]
    trace = process_engine.run(procs, "FCFS")

    assert trace.metrics["完成进程数"] == 2
    assert trace.metrics["总时钟周期"] > 0
    assert trace.metrics["平均周转时间"] > 0
    assert trace.metrics["平均等待时间"] >= 0
    assert 0 <= trace.metrics["CPU利用率"] <= 1

    # 验证明细表
    detail = trace.final_state["作业明细"]
    assert len(detail) == 2
    for d in detail:
        assert "作业" in d
        assert "到达" in d
        assert "服务" in d
        assert "完成" in d
        assert "周转" in d
        assert "带权周转" in d
        assert "等待" in d


# ────────────────────────── 12. _choose_next 纯函数测试 ──────────────────────────

def test_choose_next_fcfs():
    """验证 FCFS 选择 arrival 最小的。"""
    ready = [
        {"pid": 2, "arrival": 5, "remaining": 3},
        {"pid": 1, "arrival": 2, "remaining": 5},
    ]
    result = _choose_next(ready, "FCFS", 10, [])
    assert result["pid"] == 1


def test_choose_next_sjf():
    """验证 SJF 选择 remaining 最小的。"""
    ready = [
        {"pid": 1, "arrival": 0, "remaining": 5},
        {"pid": 2, "arrival": 0, "remaining": 2},
    ]
    result = _choose_next(ready, "SJF", 1, [])
    assert result["pid"] == 2


def test_choose_next_priority():
    """验证 PRIORITY 选择 priority 数字最小的。"""
    ready = [
        {"pid": 1, "arrival": 0, "priority": 3, "remaining": 5},
        {"pid": 2, "arrival": 0, "priority": 1, "remaining": 5},
    ]
    result = _choose_next(ready, "PRIORITY", 1, [])
    assert result["pid"] == 2


# ────────────────────────── 13. 异常处理 ──────────────────────────

def test_invalid_algorithm():
    """未知算法应抛出 ValueError。"""
    try:
        process_engine.run(PROCS, "INVALID")
        assert False, "应抛出 ValueError"
    except ValueError as e:
        assert "未知调度算法" in str(e)


# ────────────────────────── 14. 甘特图连续性 ──────────────────────────

def test_gantt_continuity():
    """甘特图段之间不应有时间重叠。"""
    trace = process_engine.run(PROCS, "FCFS")
    gantt = trace.final_state["甘特图"]
    for i in range(1, len(gantt)):
        assert gantt[i]["开始"] >= gantt[i - 1]["结束"], \
            f"甘特图段 {i-1} 和 {i} 有时间重叠"


# ────────────────────────── 15. RR 完整运行 ──────────────────────────

def test_rr_full_run():
    """RR 完整运行验证所有进程完成。"""
    trace = process_engine.run(PROCS, "RR", time_quantum=2)
    assert trace.metrics["完成进程数"] == 4
    assert len(trace.final_state["完成顺序"]) == 4
    assert trace.metrics["平均周转时间"] > 0
