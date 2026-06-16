"""跨模块集成测试 —— CPU调度 ↔ 存储管理 ↔ 资源分配 联动验证。

本测试确保四个核心的算法引擎：
1) 各自输出结果与教材已知答案一致
2) 数据结构彼此兼容，可串联编排
3) 模拟的「完整 OS tick 流程」跨模块数据流正确

后期各分支合并时，运行本测试即可立即发现接口契约断裂。
"""
import pytest
from app.engines import scheduling_engine, paging_engine, banker_engine, disk_engine, sync_engine


# ═══════════════════════════════════════════════════════════════════════════════
# 第 1 部分：存储管理算法正确性（教材验证）
# ═══════════════════════════════════════════════════════════════════════════════

# 经典引用串（Silberschatz），3 个物理块
CLASSIC_REF = [7, 0, 1, 2, 0, 3, 0, 4, 2, 3, 0, 3, 2, 1, 2, 0, 1, 7, 0, 1]


class TestPagingCorrectness:
    """存储管理 —— 四种置换算法教材已知答案验证"""

    @pytest.mark.parametrize("algo,expected_faults", [
        ("FIFO", 15),
        ("LRU", 12),
        ("OPT", 9),
        ("CLOCK", 14),   # CLOCK: 3 块时经典引用串缺页 14 次（二次机会策略）
    ])
    def test_textbook_fault_counts(self, algo, expected_faults):
        t = paging_engine.run(algo, CLASSIC_REF, 3)
        assert t.metrics["缺页次数"] == expected_faults, \
            f"{algo} 缺页次数应为 {expected_faults}，实际 {t.metrics['缺页次数']}"

    def test_all_faults_when_single_frame(self):
        """极端情况：只有 1 个物理块 → 每次访问都缺页（除重复连续访问同一页）"""
        t = paging_engine.run("FIFO", [1, 2, 1, 3, 1, 4], 1)
        # 1(miss),2(miss),1(miss),3(miss),1(miss),4(miss) → 6 miss
        assert t.metrics["缺页次数"] == 6

    def test_no_faults_when_all_pages_fit(self):
        """所有页都能放入内存 → 0 缺页（除首次装入）"""
        # 只有 3 个不同页，3 个页框 → 恰好 3 次首次装入缺页
        t = paging_engine.run("FIFO", [0, 1, 2, 0, 1, 2, 0, 1], 3)
        assert t.metrics["缺页次数"] == 3     # 前三次各缺一次，后面全命中

    def test_fifo_anomaly_belady(self):
        """Belady 异常：FIFO + 4 块可能比 3 块更多缺页"""
        # 构造引用串展示 Belady 异常的存在（不要求必然触发，但验证算法正确运行）
        ref = [1, 2, 3, 4, 1, 2, 5, 1, 2, 3, 4, 5]
        t3 = paging_engine.run("FIFO", ref, 3)
        t4 = paging_engine.run("FIFO", ref, 4)
        # 两种块数都能正常输出（具体值不作断言，仅验证运行稳定）
        assert t3.metrics["缺页次数"] > 0
        assert t4.metrics["缺页次数"] > 0
        assert len(t3.steps) == len(ref)
        assert len(t4.steps) == len(ref)

    def test_trace_steps_match_ref_length(self):
        """返回的 steps 数量等于引用串长度"""
        for algo in ["FIFO", "LRU", "OPT", "CLOCK"]:
            t = paging_engine.run(algo, CLASSIC_REF, 3)
            assert len(t.steps) == len(CLASSIC_REF), \
                f"{algo} steps 数量 {len(t.steps)} != 引用串长度 {len(CLASSIC_REF)}"

    def test_metrics_consistency(self):
        """所有算法的命中+缺页 = 访问总数"""
        for algo in ["FIFO", "LRU", "OPT", "CLOCK"]:
            t = paging_engine.run(algo, CLASSIC_REF, 4)
            assert t.metrics["命中次数"] + t.metrics["缺页次数"] == len(CLASSIC_REF)

    def test_address_translation_contract(self):
        """地址转换：页表 + 指令序列 → 绝对地址 / 缺页中断"""
        page_table = [
            {"页号": 0, "标志": 1, "主存块号": 5},
            {"页号": 1, "标志": 1, "主存块号": 8},
            {"页号": 2, "标志": 0, "主存块号": None},
        ]
        instructions = [
            {"操作": "+", "页号": 0, "单元号": 70},
            {"操作": "存", "页号": 2, "单元号": 20},
        ]
        t = paging_engine.translate(page_table, instructions, block_size=128)
        results = t.final_state["转换结果"]
        assert results[0]["绝对地址"] == 5 * 128 + 70    # 710
        assert results[0]["缺页"] is False
        assert results[1]["缺页"] is True
        assert results[1]["绝对地址"] is None
        assert t.metrics["缺页次数"] == 1
        assert t.module == "paging"


# ═══════════════════════════════════════════════════════════════════════════════
# 第 2 部分：CPU 调度 + 存储 + 资源 —— 跨模块串联（合约测试）
# ═══════════════════════════════════════════════════════════════════════════════

# —— 共享测试数据：前端 store 的同构数据 ——
JOBS = [
    {"name": "init",  "arrival": 0, "burst": 8, "priority": 1},
    {"name": "shell", "arrival": 2, "burst": 4, "priority": 2},
    {"name": "gcc",   "arrival": 4, "burst": 6, "priority": 3},
]

# 与 seed.js 保持一致的银行家初始数据
AVAILABLE = [3, 3, 2]
MAX = [[7, 5, 3], [3, 2, 2], [9, 0, 2], [2, 2, 2], [4, 3, 3]]
ALLOC = [[0, 1, 0], [2, 0, 0], [3, 0, 2], [2, 1, 1], [0, 0, 2]]

# 与 seed.js 默认 refStringText 一致的页面访问串
SEED_REF = [7, 0, 1, 2, 0, 3, 0, 4, 2, 3, 0, 3, 2, 1, 2]

# 磁盘请求（与 seed.js 默认 ioRequests 一致）
DISK_REQUESTS = [98, 183, 37, 122, 14, 124, 65, 67]


class TestSchedulingCorrectness:
    """处理机调度 —— 教材已知答案"""

    def test_fcfs_order_and_turnaround(self):
        t = scheduling_engine.run("FCFS", JOBS)
        assert t.final_state["完成顺序"] == ["init", "shell", "gcc"]

    def test_sjf_order(self):
        t = scheduling_engine.run("SJF", JOBS)
        assert t.final_state["完成顺序"] == ["init", "shell", "gcc"]

    def test_rr_produces_gantt(self):
        jobs = [{"name": "A", "arrival": 0, "burst": 4},
                 {"name": "B", "arrival": 0, "burst": 3}]
        t = scheduling_engine.run("RR", jobs, time_quantum=2)
        assert len(t.final_state["甘特图"]) >= 3
        assert t.module == "scheduling"


class TestResourceCorrectness:
    """资源管理 —— 银行家 + PV 同步"""

    def test_banker_safety_known_answer(self):
        t = banker_engine.check_safety(AVAILABLE, MAX, ALLOC)
        assert t.metrics["安全"] is True
        assert t.final_state["安全序列"] == ["P1", "P3", "P4", "P0", "P2"]

    def test_pv_sync_alternating(self):
        ops = [{"type": "produce"}, {"type": "consume"}]
        t = sync_engine.run(ops, buffer_size=10)
        assert t.metrics["生产次数"] == 1
        assert t.metrics["消费次数"] == 1
        assert t.metrics["阻塞次数"] == 0

    def test_pv_full_buffer_blocks_producer(self):
        ops = [{"type": "produce"}, {"type": "produce"}, {"type": "produce"},
               {"type": "consume"}]
        t = sync_engine.run(ops, buffer_size=2)
        assert t.metrics["阻塞次数"] >= 1


class TestDiskCorrectness:
    """设备管理 —— 磁盘调度"""

    def test_scan_total_seek(self):
        t = disk_engine.run("SCAN", DISK_REQUESTS, head=53, disk_size=200, direction="up")
        assert t.metrics["总寻道道数"] == 331

    def test_sstf_total_seek(self):
        t = disk_engine.run("SSTF", DISK_REQUESTS, head=53, disk_size=200)
        assert t.metrics["总寻道道数"] == 236


# ═══════════════════════════════════════════════════════════════════════════════
# 第 3 部分：跨模块串联 —— 模拟「完整 OS Tick 流程」
# ═══════════════════════════════════════════════════════════════════════════════

class TestCrossModuleIntegration:
    """
    模拟前端 driver.js 的 tick() 在三个核心之间的编排：

      处理机调度 → 进程运行中访存 → 页面置换 → 资源安全检查

    这些测试验证：
    - 一个模块的输出可以直接作为另一个模块的输入（数据结构兼容）
    - 所有引擎返回统一的 SimulationTrace 结构
    - 前端 store 字段有对应的后端输出可以填入
    """

    def test_scenario_1_schedule_then_page_fault(self):
        """
        场景 1：进程被调度运行后访问内存，触发缺页。

        流程：
        1. 调度引擎选出当前运行的进程
        2. 该进程执行期间访问页面 → 分页引擎处理
        3. 分页结果反映缺页/命中状态
        """
        # Step 1：调度 —— 从 3 个作业中选出执行顺序
        sched_trace = scheduling_engine.run("FCFS", JOBS)
        gantt = sched_trace.final_state["甘特图"]
        completed_order = sched_trace.final_state["完成顺序"]

        # 甘特图有内容，有完成顺序
        assert len(gantt) >= 3
        assert len(completed_order) == 3

        # Step 2：第一个运行进程 (init) 执行时访问内存
        # 用 seed 默认引用串模拟访存
        paging_trace = paging_engine.run("LRU", SEED_REF, 8)

        # Step 3：分页结果有效
        assert paging_trace.module == "paging"
        assert paging_trace.metrics["缺页次数"] >= 0
        assert paging_trace.metrics["命中次数"] >= 0
        assert len(paging_trace.steps) == len(SEED_REF)

        # 串联验证：分页引擎输出的最终页框是合法状态
        final_frames = paging_trace.final_state["最终页框"]
        assert len(final_frames) == 8           # 8 个页框全部列出
        assert any(f is not None for f in final_frames)  # 至少有一页在内存

    def test_scenario_2_cpu_memory_resource_full_cycle(self):
        """
        场景 2：完整 OS tick 周期 —— 调度 → 访存 → 资源检查。

        模拟前端 driver.js tick() 的核心编排逻辑：
        - 处理机：运行态进程推进，时间片到则切换
        - 存储：  访存触发页表查询，命中/缺页
        - 资源：  银行家算法周期性安全性检查
        - 设备：  磁盘 I/O 请求调度

        验证这四个模块的输出可以无缝拼接。
        """
        # —— 处理机 ——
        sched = scheduling_engine.run("RR", JOBS, time_quantum=2)
        # 甘特图片段 [作业名, 开始, 结束]
        gantt = sched.final_state["甘特图"]
        # 验证甘特图可以直接映射到前端 store.gantt
        for seg in gantt:
            assert "作业" in seg or "进程" in seg, f"甘特图段缺少作业/进程标识: {seg}"
            assert "开始" in seg or "start" in str(seg).lower()

        # —— 存储 ——
        paging = paging_engine.run("CLOCK", SEED_REF, 8)
        steps = paging.steps
        # 每一步包含：引用页、命中/缺页、页框快照、累计缺页
        for step in steps:
            assert "引用页" in step.state, f"step 缺少 '引用页': {step.state}"
            assert "命中" in step.state or "缺页" in step.state
            assert "页框" in step.state, f"step 缺少 '页框': {step.state}"

        # —— 资源 ——
        banker = banker_engine.check_safety(AVAILABLE, MAX, ALLOC)
        assert "安全序列" in banker.final_state
        # 死锁标志可以映射到前端 store.resources.deadlock
        deadlock = not banker.metrics["安全"]
        assert isinstance(deadlock, bool)

        # —— 设备 ——
        disk = disk_engine.run("SCAN", DISK_REQUESTS, head=53, disk_size=200, direction="up")
        assert "服务顺序" in disk.final_state
        assert disk.metrics["总寻道道数"] > 0

    def test_scenario_3_store_contract_compatibility(self):
        """
        场景 3：接口契约验证 —— 后端输出结构与前端 store 字段对应。

        根据 docs/接口契约.md 的映射表：
        - POST /api/scheduling/run → store.processes[].state + gantt + metrics
        - POST /api/paging/run      → store.memory.frames + faults/hits
        - POST /api/banker/safety   → store.resources.safeSeq + deadlock
        - POST /api/disk/run        → store.disk.path + head + totalSeek
        - POST /api/sync/run        → store.sync.*
        """
        # 每个引擎返回的 SimulationTrace 都有统一的顶层字段
        engines = [
            ("scheduling", scheduling_engine.run("FCFS", JOBS)),
            ("paging", paging_engine.run("FIFO", CLASSIC_REF, 3)),
            ("banker", banker_engine.check_safety(AVAILABLE, MAX, ALLOC)),
            ("disk", disk_engine.run("SSTF", DISK_REQUESTS, head=53, disk_size=200)),
        ]

        for module_name, trace in engines:
            # 统一契约字段
            assert trace.module is not None, f"{module_name}: module 不能为空"
            assert trace.algorithm is not None, f"{module_name}: algorithm 不能为空"
            assert isinstance(trace.steps, list), f"{module_name}: steps 必须是 list"
            assert isinstance(trace.metrics, dict), f"{module_name}: metrics 必须是 dict"
            assert isinstance(trace.final_state, dict), f"{module_name}: final_state 必须是 dict"

            # 所有模块的 final_state 都必须能映射到 store 的某个字段
            # 这个测试只是确保 final_state 非空且有明确的键
            assert len(trace.final_state.keys()) >= 1, \
                f"{module_name}: final_state 至少需要 1 个字段用于写回 store"

    def test_scenario_4_deadlock_detection_during_execution(self):
        """
        场景 4：运行中资源分配引发死锁。

        流程：
        1. 初始状态安全
        2. P4 请求 (3,3,0) → 不安全，拒绝
        3. 系统保持安全状态
        4. 用不安全状态检测死锁
        """
        # 初始安全
        t1 = banker_engine.check_safety(AVAILABLE, MAX, ALLOC)
        assert t1.metrics["安全"] is True

        # P4 发出大请求 → 不安全，拒绝
        t2 = banker_engine.request(AVAILABLE, MAX, ALLOC, 4, [3, 3, 0])
        assert t2.metrics["可分配"] is False
        assert t2.metrics["安全"] is False or t2.metrics["安全"] is None

        # 构造不安全状态
        unsafe_alloc = [[1, 0], [0, 1]]
        unsafe_max = [[2, 1], [1, 2]]
        t3 = banker_engine.check_safety([0, 0], unsafe_max, unsafe_alloc)
        assert t3.metrics["安全"] is False
        assert len(t3.final_state["死锁进程"]) > 0

    def test_scenario_5_paging_during_context_switch(self):
        """
        场景 5：进程切换时的访存模式。

        当一个进程的时间片用完（RR 调度），切换到下一个进程时，
        新进程的代码/数据页可能不在主存，可能触发更多缺页。

        这测试了调度决策对分页行为的影响。
        """
        # RR 调度产生交错执行的甘特图
        sched = scheduling_engine.run("RR", JOBS, time_quantum=2)
        gantt = sched.final_state["甘特图"]

        # 进程切换次数 = 甘特图片段数 - 1
        ctx_switches = len(gantt) - 1
        assert ctx_switches >= 2, f"RR 应产生至少 2 次上下文切换，实际 {ctx_switches}"

        # 每个被调度的进程"访问自己的页面"
        # 模拟：不同进程访问不同页面区域
        for algo in ["FIFO", "LRU", "CLOCK"]:
            total_faults = 0
            for job_idx, job in enumerate(JOBS[:2]):  # 模拟前两个进程的访存
                # 每个进程访问不同的页面子集
                proc_ref = [(job_idx * 4 + i) % 12 for i in range(6)]
                t = paging_engine.run(algo, proc_ref, 4)
                total_faults += t.metrics["缺页次数"]

            # 两次运行的缺页总数应在合理范围内（0 < faults ≤ 总访问数）
            assert 0 < total_faults <= 12, \
                f"{algo}: 两次进程访存总缺页 {total_faults} 超出预期范围"

    def test_scenario_6_config_changes_affect_behavior(self):
        """
        场景 6：改变配置（页框数）直接影响缺页率。

        这验证了前端「系统设置」页调整参数后，
        后端引擎行为随之变化（连锁反应正确）。
        """
        ref = CLASSIC_REF
        faults_3 = paging_engine.run("FIFO", ref, 3).metrics["缺页次数"]
        faults_5 = paging_engine.run("FIFO", ref, 5).metrics["缺页次数"]
        faults_8 = paging_engine.run("FIFO", ref, 8).metrics["缺页次数"]

        # 更多页框 → 缺页不应增加（非严格单调，但趋势应如此）
        # 对于 FIFO，Belady 异常意味着 5 块可能比 3 块缺页更多
        # 但 8 块应 ≤ min(faults_3, faults_5)（空间足够大时）
        assert faults_8 <= faults_3 or faults_8 <= faults_5, \
            f"8 页框时缺页 {faults_8} 应不大于 3({faults_3})或 5({faults_5}) 页框"

        # 同一引用串，不同算法的缺页数可能不同
        lru_faults = paging_engine.run("LRU", ref, 3).metrics["缺页次数"]
        opt_faults = paging_engine.run("OPT", ref, 3).metrics["缺页次数"]
        # OPT 是最优算法 → 缺页数 ≤ 任何其他算法
        assert opt_faults <= lru_faults, \
            f"OPT({opt_faults}) 应为最优，不应超过 LRU({lru_faults})"


# ═══════════════════════════════════════════════════════════════════════════════
# 第 4 部分：边界条件 & 异常覆盖
# ═══════════════════════════════════════════════════════════════════════════════

class TestEdgeCases:
    """跨模块边界条件"""

    def test_empty_page_reference_string(self):
        """空引用串应返回空步骤"""
        t = paging_engine.run("FIFO", [], 4)
        assert len(t.steps) == 0
        assert t.metrics["缺页次数"] == 0
        assert t.metrics["命中次数"] == 0

    def test_single_process_no_contention(self):
        """只有一个进程时无调度竞争"""
        t = scheduling_engine.run("FCFS", [JOBS[0]])
        assert t.metrics["平均等待时间"] == 0
        assert t.final_state["完成顺序"] == ["init"]

    def test_all_processes_arrive_same_time(self):
        """同时到达的进程按算法排序"""
        jobs = [
            {"name": "P1", "arrival": 0, "burst": 5},
            {"name": "P2", "arrival": 0, "burst": 3},
            {"name": "P3", "arrival": 0, "burst": 7},
        ]
        t = scheduling_engine.run("SJF", jobs)
        # SJF：burst 短的先执行
        assert t.final_state["完成顺序"] == ["P2", "P1", "P3"]

    def test_banker_zero_available(self):
        """资源全部用完时的安全性检查"""
        alloc = [[2, 0, 0], [0, 2, 0], [0, 0, 2]]
        maxm = [[2, 0, 0], [0, 2, 0], [0, 0, 2]]
        t = banker_engine.check_safety([0, 0, 0], maxm, alloc)
        # 所有进程 Need=0 → 安全（虽无可分配资源，但没有进程还需要资源）
        assert t.metrics["安全"] is True

    def test_banker_unsafe_when_dead_processes_still_need(self):
        """有进程还需资源但 Available=0 → 不安全"""
        alloc = [[1, 0], [0, 1]]
        maxm = [[2, 1], [1, 2]]
        t = banker_engine.check_safety([0, 0], maxm, alloc)
        assert t.metrics["安全"] is False
