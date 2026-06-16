"""进程状态机引擎 —— 实时进程生命周期管理。

状态转换：
  [新建] → [就绪] → [运行] → [完成]
                ↑       ↓
                └─ [阻塞] ←─┘(I/O 中断)

每调用一次 tick()，推进一个时钟周期：
  1. 检查阻塞队列，I/O 倒计时归零的进程唤醒到就绪
  2. 推进运行进程（ran++），判断是否完成/抢占/阻塞
  3. CPU 空闲时按调度算法从就绪队列选下一个进程
  4. 检查新进程到达
"""
from __future__ import annotations

from app.schemas.common import SimulationStep, SimulationTrace

ALGORITHMS = ["FCFS", "SJF", "HRRN", "PRIORITY", "RR"]

# —————————————————————————————— PCB 工具函数 ——————————————————————————————

def _make_pcb(proc: dict) -> dict:
    """规范化 PCB 字段。"""
    burst = proc["burst"]
    ran = proc.get("ran", 0)
    return {
        "pid": proc["pid"],
        "name": proc["name"],
        "state": proc.get("state", "就绪"),
        "arrival": proc.get("arrival", 0),
        "burst": burst,
        "ran": ran,
        "remaining": burst - ran,
        "priority": proc.get("priority") if proc.get("priority") is not None else 99,
        "io_blocked_at": None,
        "io_duration": 0,
        "io_remaining": 0,
        "finish_time": None,
        "turnaround": None,
        "weighted_turnaround": None,
        "waiting_time": 0,
    }


def _snapshot(procs: list[dict]) -> list[dict]:
    """生成进程快照（不暴露内部字段）。"""
    return [
        {k: p[k] for k in (
            "pid", "name", "state", "arrival", "burst", "ran",
            "remaining", "priority", "io_remaining", "finish_time",
            "turnaround", "weighted_turnaround", "waiting_time",
        )}
        for p in procs
    ]


# —————————————————————————————— 调度选择 ——————————————————————————————

def _choose_next(ready: list[dict], algo: str, clock: int, rr_queue: list[int]) -> dict | None:
    """按调度算法从就绪队列选一个进程。"""
    if not ready:
        return None

    if algo == "FCFS":
        return min(ready, key=lambda p: (p["arrival"], p["pid"]))
    if algo == "SJF":
        return min(ready, key=lambda p: (p["remaining"], p["arrival"], p["pid"]))
    if algo == "HRRN":
        def _rr(p):
            wait = max(0, clock - p["arrival"])
            return (wait + p["burst"]) / max(1, p["burst"])
        return max(ready, key=lambda p: (_rr(p), -p["pid"]))
    if algo == "PRIORITY":
        return min(ready, key=lambda p: (p["priority"], p["arrival"], p["pid"]))
    if algo == "RR":
        # 按 FCFS 顺序，但用 rr_queue 维护轮转顺序
        if rr_queue:
            for pid in rr_queue:
                for p in ready:
                    if p["pid"] == pid:
                        return p
        return min(ready, key=lambda p: (p["arrival"], p["pid"]))
    raise ValueError(f"未知调度算法: {algo}")


# —————————————————————————————— 核心引擎 ——————————————————————————————

class ProcessEngine:
    """进程状态机引擎，支持 tick-by-tick 推进。"""

    def __init__(self, processes: list[dict], algorithm: str, time_quantum: int = 2):
        algo = algorithm.upper()
        if algo not in ALGORITHMS:
            raise ValueError(f"未知调度算法: {algorithm}")

        self.algorithm = algo
        self.time_quantum = time_quantum
        self.clock = 0
        self.gantt: list[dict] = []

        # 初始化 PCB
        self._all_procs: dict[int, dict] = {}
        self._rr_queue: list[int] = []   # RR 轮转队列（pid 列表）
        for p in processes:
            pcb = _make_pcb(p)
            # 到达时间为 0 或已到达的进程进入就绪
            if pcb["arrival"] <= 0:
                pcb["state"] = "就绪"
                pcb["arrival"] = max(pcb["arrival"], 0)
                if algo == "RR":
                    self._rr_queue.append(pcb["pid"])
            else:
                pcb["state"] = "新建"
            self._all_procs[pcb["pid"]] = pcb
        self._current: dict | None = None  # 当前运行进程
        self._current_segment: dict | None = None  # 当前甘特图段
        self._quantum_used = 0  # 当前时间片已用
        self._steps: list[SimulationStep] = []
        self._events: list[str] = []
        self._done_count = 0
        self._total_procs = len(processes)

    # —— 状态查询 ——

    @property
    def all_done(self) -> bool:
        return self._done_count >= self._total_procs

    def _get_by_state(self, state: str) -> list[dict]:
        return [p for p in self._all_procs.values() if p["state"] == state]

    # —— 状态转换操作 ——

    def _wake_blocked(self):
        """唤醒 I/O 完成的阻塞进程。"""
        for p in self._all_procs.values():
            if p["state"] == "阻塞":
                p["io_remaining"] -= 1
                if p["io_remaining"] <= 0:
                    p["state"] = "就绪"
                    p["io_blocked_at"] = None
                    p["io_duration"] = 0
                    if self.algorithm == "RR":
                        self._rr_queue.append(p["pid"])
                    self._events.append(f"I/O 完成，{p['name']} 唤醒回就绪队列")

    def _check_arrivals(self, new_arrivals: list[dict] | None = None):
        """检查本时刻到达的新进程。"""
        # 检查初始化时标记为"新建"的进程
        for p in self._all_procs.values():
            if p["state"] == "新建" and p["arrival"] <= self.clock:
                p["state"] = "就绪"
                if self.algorithm == "RR":
                    self._rr_queue.append(p["pid"])
                self._events.append(f"进程 {p['name']} 到达，进入就绪队列")

        # 检查外部传入的新到达进程
        if new_arrivals:
            for na in new_arrivals:
                pid = na["pid"]
                if pid in self._all_procs:
                    continue  # 已存在，跳过
                pcb = _make_pcb(na)
                pcb["state"] = "就绪"
                pcb["arrival"] = self.clock
                self._all_procs[pid] = pcb
                self._total_procs += 1
                if self.algorithm == "RR":
                    self._rr_queue.append(pid)
                self._events.append(f"进程 {pcb['name']} 到达，进入就绪队列")

    def _finalize(self, p: dict):
        """完成进程，计算指标。"""
        p["state"] = "完成"
        p["finish_time"] = self.clock
        p["turnaround"] = self.clock - p["arrival"]
        p["weighted_turnaround"] = round(p["turnaround"] / max(1, p["burst"]), 2)
        p["waiting_time"] = p["turnaround"] - p["burst"]
        self._done_count += 1
        # 结束甘特图段
        if self._current_segment:
            self._current_segment["结束"] = self.clock
            self._current_segment = None
        self._events.append(
            f"进程 {p['name']} 执行完毕，周转 {p['turnaround']}，"
            f"带权周转 {p['weighted_turnaround']}"
        )

    def _start_running(self, p: dict):
        """让进程开始运行。"""
        p["state"] = "运行"
        self._current = p
        self._quantum_used = 0
        # 开始新甘特图段
        self._current_segment = {"作业": p["name"], "开始": self.clock, "结束": self.clock}
        self.gantt.append(self._current_segment)
        if len(self.gantt) > 50:
            self.gantt.pop(0)
        self._events.append(f"{self.algorithm} 调度器选中 {p['name']} 占用 CPU")

    def _preempt_current(self, reason: str):
        """抢占当前运行进程。"""
        if not self._current:
            return
        p = self._current
        if self._current_segment:
            self._current_segment["结束"] = self.clock
        p["state"] = "就绪"
        if self.algorithm == "RR":
            self._rr_queue.append(p["pid"])
        self._events.append(f"{p['name']} {reason}，让出 CPU 回就绪队列")
        self._current = None
        self._current_segment = None

    def _block_current(self):
        """当前进程因 I/O 阻塞。"""
        if not self._current:
            return
        p = self._current
        if self._current_segment:
            self._current_segment["结束"] = self.clock
        p["state"] = "阻塞"
        p["io_blocked_at"] = self.clock
        p["io_duration"] = 3  # 默认 I/O 耗时 3 个周期
        p["io_remaining"] = 3
        self._events.append(f"{p['name']} 请求 I/O，进入阻塞队列（等待 3 个周期）")
        self._current = None
        self._current_segment = None

    # —— 单步推进 ——

    def tick(
        self,
        new_arrivals: list[dict] | None = None,
        force_io: bool | None = None,
    ) -> SimulationStep:
        """推进一个时钟周期，返回本步的 SimulationStep。

        Args:
            new_arrivals: 本时刻新到达的进程列表（可选）。
            force_io: None=不触发I/O, True=强制触发I/O阻塞。用于测试。
        """
        self.clock += 1
        self._events = []

        # 1. 唤醒阻塞进程
        self._wake_blocked()

        # 2. 新进程到达
        self._check_arrivals(new_arrivals)

        # 3. 调度：CPU 空闲且就绪队列非空（在运行前调度，使新进程当 tick 即可执行）
        if not self._current:
            ready = self._get_by_state("就绪")
            next_proc = _choose_next(ready, self.algorithm, self.clock, self._rr_queue)
            if next_proc:
                self._start_running(next_proc)
                # RR: 从轮转队列移除
                if self.algorithm == "RR" and next_proc["pid"] in self._rr_queue:
                    self._rr_queue.remove(next_proc["pid"])

        # 4. 运行进程推进
        if self._current and self._current["state"] == "运行":
            p = self._current
            p["ran"] += 1
            p["remaining"] -= 1
            self._quantum_used += 1

            # 检查是否执行完毕
            if p["remaining"] <= 0:
                self._finalize(p)
                self._current = None
            # RR 时间片到
            elif self.algorithm == "RR" and self._quantum_used >= self.time_quantum:
                self._preempt_current("时间片到")
            # 强制 I/O 阻塞（测试用）
            elif force_io is True:
                self._block_current()

        # 5. 抢占/完成/阻塞后，再次调度（同一 tick 内立即切换到下一个进程）
        if not self._current:
            ready = self._get_by_state("就绪")
            next_proc = _choose_next(ready, self.algorithm, self.clock, self._rr_queue)
            if next_proc:
                self._start_running(next_proc)
                if self.algorithm == "RR" and next_proc["pid"] in self._rr_queue:
                    self._rr_queue.remove(next_proc["pid"])

        # 5. 更新就绪进程的等待时间
        for p in self._all_procs.values():
            if p["state"] == "就绪":
                p["waiting_time"] += 1

        # 6. 生成 SimulationStep
        procs_snapshot = _snapshot(list(self._all_procs.values()))
        ready_names = [p["name"] for p in self._all_procs.values() if p["state"] == "就绪"]
        blocked_names = [p["name"] for p in self._all_procs.values() if p["state"] == "阻塞"]
        running_name = self._current["name"] if self._current else "空闲"

        step = SimulationStep(
            index=self.clock - 1,
            description=f"时刻 {self.clock}：CPU={running_name}，"
                        f"就绪=[{','.join(ready_names) or '空'}]，"
                        f"阻塞=[{','.join(blocked_names) or '空'}]"
                        + (f"；{'; '.join(self._events)}" if self._events else ""),
            state={
                "时刻": self.clock,
                "进程列表": procs_snapshot,
                "运行进程": running_name,
                "就绪队列": ready_names,
                "阻塞队列": blocked_names,
                "已完成": self._done_count,
                "甘特图": [dict(s) for s in self.gantt],
                "算法": self.algorithm,
                "时间片": self.time_quantum,
            },
            highlight={
                "运行": running_name,
                "事件": self._events[-1] if self._events else None,
            },
        )
        self._steps.append(step)
        return step

    # —— 构建 tick 响应 ——

    def build_tick_response(self) -> dict:
        """构建单步推进的响应数据。"""
        procs_snapshot = _snapshot(list(self._all_procs.values()))
        ready_procs = self._get_by_state("就绪")
        blocked_procs = self._get_by_state("阻塞")
        done_procs = [p for p in self._all_procs.values() if p["state"] == "完成"]
        running_name = self._current["name"] if self._current else "空闲"

        return {
            "clock": self.clock,
            "processes": procs_snapshot,
            "gantt": [dict(s) for s in self.gantt],
            "events": list(self._events),
            "metrics": {
                "cpuUtil": 100 if self._current else 0,
                "readyLen": len(ready_procs),
                "blockedLen": len(blocked_procs),
                "completed": self._done_count,
                "throughput": round(self._done_count / max(1, self.clock), 2),
            },
            "step": {
                "index": self.clock - 1,
                "description": self._steps[-1].description if self._steps else "",
                "state": self._steps[-1].state if self._steps else {},
                "highlight": self._steps[-1].highlight if self._steps else {},
            },
        }

    # —— 批量运行 ——

    def run(self, max_ticks: int = 200) -> SimulationTrace:
        """一次性运行到所有进程完成（或达到 max_ticks 上限）。"""
        while not self.all_done and self.clock < max_ticks:
            self.tick()

        return self._build_trace()

    def _build_trace(self) -> SimulationTrace:
        """构建最终的 SimulationTrace。"""
        done = [p for p in self._all_procs.values() if p["state"] == "完成"]
        n = len(done) or 1

        makespan = self.clock
        busy = sum(p["burst"] for p in self._all_procs.values())
        finish_order = [
            p["name"] for p in sorted(done, key=lambda p: (p["finish_time"], p["pid"]))
        ]

        detail = [
            {
                "作业": p["name"], "到达": p["arrival"], "服务": p["burst"],
                "完成": p["finish_time"], "周转": p["turnaround"],
                "带权周转": p["weighted_turnaround"], "等待": p["waiting_time"],
            }
            for p in sorted(self._all_procs.values(), key=lambda p: p["pid"])
        ]

        metrics = {
            "平均周转时间": round(sum(p["turnaround"] or 0 for p in done) / n, 2),
            "平均带权周转时间": round(sum(p["weighted_turnaround"] or 0 for p in done) / n, 2),
            "平均等待时间": round(sum(p["waiting_time"] for p in done) / n, 2),
            "CPU利用率": round(busy / makespan, 2) if makespan else 0,
            "完成进程数": len(done),
            "总时钟周期": self.clock,
        }

        return SimulationTrace(
            module="process",
            algorithm=self.algorithm,
            input_echo={"algorithm": self.algorithm, "time_quantum": self.time_quantum},
            steps=self._steps,
            metrics=metrics,
            final_state={
                "完成顺序": finish_order,
                "甘特图": self.gantt,
                "作业明细": detail,
            },
        )


# —————————————————————————————— 便捷函数 ——————————————————————————————

def run(processes: list[dict], algorithm: str, time_quantum: int = 2, max_ticks: int = 200) -> SimulationTrace:
    """一次性运行所有进程到完成。"""
    engine = ProcessEngine(processes, algorithm, time_quantum)
    return engine.run(max_ticks)


def tick(
    engine: ProcessEngine,
    new_arrivals: list[dict] | None = None,
    force_io: bool | None = None,
) -> SimulationStep:
    """推进一步。"""
    return engine.tick(new_arrivals, force_io)
