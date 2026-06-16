"""磁盘调度引擎已知答案校验。

经典例子（Silberschatz）：请求序列 98,183,37,122,14,124,65,67，
初始磁头 53，磁道范围 0..199，初始方向递增。
"""
from app.engines import disk_engine

REQUESTS = [98, 183, 37, 122, 14, 124, 65, 67]
HEAD = 53
DISK_SIZE = 200  # 磁道 0..199


def run(algorithm, direction="up"):
    return disk_engine.run(
        algorithm=algorithm,
        requests=REQUESTS,
        head=HEAD,
        disk_size=DISK_SIZE,
        direction=direction,
    )


def served_order(trace):
    return trace.final_state["服务顺序"]


# ========== 移臂调度：旧接口兼容 ==========

def test_fcfs_total_seek_and_order():
    t = run("FCFS")
    assert t.metrics["总寻道道数"] == 640
    assert served_order(t) == REQUESTS


def test_sstf_total_seek_and_order():
    t = run("SSTF")
    assert t.metrics["总寻道道数"] == 236
    assert served_order(t) == [65, 67, 37, 14, 98, 122, 124, 183]


def test_scan_up_total_seek_and_order():
    t = run("SCAN")
    assert t.metrics["总寻道道数"] == 331
    assert served_order(t) == [65, 67, 98, 122, 124, 183, 37, 14]


def test_look_up_total_seek_and_order():
    t = run("LOOK")
    assert t.metrics["总寻道道数"] == 299
    assert served_order(t) == [65, 67, 98, 122, 124, 183, 37, 14]


def test_cscan_up_total_seek_and_order():
    t = run("C-SCAN")
    assert t.metrics["总寻道道数"] == 382
    assert served_order(t) == [65, 67, 98, 122, 124, 183, 14, 37]


def test_clook_up_total_seek_and_order():
    t = run("C-LOOK")
    assert t.metrics["总寻道道数"] == 322
    assert served_order(t) == [65, 67, 98, 122, 124, 183, 14, 37]


def test_fscan_scan_equivalent():
    """F-SCAN（冻结队列扫描）行为等同 SCAN，应到物理端点。"""
    t_fscan = run("F-SCAN")
    t_scan = run("SCAN")
    assert t_fscan.metrics["总寻道道数"] == t_scan.metrics["总寻道道数"]
    assert served_order(t_fscan) == served_order(t_scan)


def test_nscan_same_direction():
    """N-SCAN 沿当前方向扫描，不到物理端点，结果与 LOOK(up) 一致。"""
    t_nscan = run("N-SCAN")
    t_look = run("LOOK")
    assert t_nscan.metrics["总寻道道数"] == t_look.metrics["总寻道道数"]
    assert served_order(t_nscan) == served_order(t_look)


def test_scan_seeks_more_than_look():
    """SCAN 到达端点再折返，寻道应 >= LOOK。"""
    t_scan = run("SCAN")
    t_look = run("LOOK")
    assert t_scan.metrics["总寻道道数"] >= t_look.metrics["总寻道道数"]


def test_average_seek_is_total_over_request_count():
    t = run("FCFS")
    assert t.metrics["平均寻道长度"] == round(640 / 8, 2)


def test_steps_have_one_entry_per_served_request():
    t = run("SSTF")
    # 每个服务的请求对应一步
    assert len(t.steps) == len(REQUESTS)
    assert t.module == "disk"
    assert t.algorithm == "SSTF"


# ========== 高级模拟（移臂 + 旋转 + 传输）==========

IO_REQUESTS = [
    {"进程名": "P1", "柱面号": 98, "磁道号": 2, "物理记录号": 3},
    {"进程名": "P2", "柱面号": 183, "磁道号": 1, "物理记录号": 5},
    {"进程名": "P3", "柱面号": 37, "磁道号": 3, "物理记录号": 2},
    {"进程名": "P4", "柱面号": 122, "磁道号": 0, "物理记录号": 7},
    {"进程名": "P5", "柱面号": 14, "磁道号": 2, "物理记录号": 4},
]


def test_simulate_fcfs_returns_correct_metrics():
    t = disk_engine.simulate("FCFS", IO_REQUESTS, head=53, current_record=0)
    assert t.module == "disk"
    assert t.algorithm == "FCFS"
    assert t.metrics["请求总数"] == 5
    assert t.metrics["总寻道道数"] > 0
    assert len(t.steps) == 5


def test_simulate_sstf_fewer_seeks_than_fcfs():
    t_fcfs = disk_engine.simulate("FCFS", IO_REQUESTS, head=53, current_record=0)
    t_sstf = disk_engine.simulate("SSTF", IO_REQUESTS, head=53, current_record=0)
    assert t_sstf.metrics["总寻道道数"] <= t_fcfs.metrics["总寻道道数"]


def test_simulate_rotation_is_nonnegative():
    t = disk_engine.simulate("SCAN", IO_REQUESTS, head=53, current_record=0,
                             geometry={"records_per_track": 8})
    for step in t.steps:
        assert step.state["旋转距离"] >= 0


def test_simulate_service_time_includes_all_components():
    t = disk_engine.simulate("LOOK", IO_REQUESTS, head=53, current_record=0)
    for step in t.steps:
        st = step.state
        expected = st["寻道时间"] + st["旋转时间"] + st["传输时间"]
        assert abs(st["服务时间"] - expected) < 0.01


def test_simulate_geometry_clamp_records():
    """请求中的记录号超出几何范围应被 clamp。"""
    reqs = [{"进程名": "X", "柱面号": 50, "磁道号": 0, "物理记录号": 999}]
    t = disk_engine.simulate("FCFS", reqs, head=0,
                             geometry={"records_per_track": 8})
    # 记录号应被 clamp 到 max_record=7
    assert t.steps[0].state["目标记录"] <= 7


# ========== 基准对比 ==========

def test_benchmark_returns_all_algorithms():
    results = disk_engine.benchmark(IO_REQUESTS, head=53, current_record=0)
    assert "FCFS" in results
    assert "SSTF" in results
    assert "SCAN" in results
    assert "LOOK" in results
    assert "F-SCAN" in results
    assert "N-SCAN" in results


def test_benchmark_subset():
    results = disk_engine.benchmark(IO_REQUESTS, head=53,
                                    algorithms=["FCFS", "SSTF"])
    assert len(results) == 2
    assert "FCFS" in results
    assert "SSTF" in results


# ========== 错误处理 ==========

def test_unknown_algorithm_raises():
    try:
        disk_engine.run("BOGUS", [1, 2], head=0)
        assert False, "应抛出 ValueError"
    except ValueError:
        pass


def test_simulate_unknown_algorithm_raises():
    try:
        disk_engine.simulate("BOGUS", IO_REQUESTS, head=0)
        assert False, "应抛出 ValueError"
    except ValueError:
        pass


# ========== DiskGeometry 辅助 ==========

def test_disk_geometry_rotation_per_record():
    g = disk_engine.DiskGeometry(records_per_track=8, rotation_per_rev=8.0)
    assert g.rotation_per_record == 1.0


def test_disk_geometry_properties():
    g = disk_engine.DiskGeometry(cylinders=200, tracks_per_cylinder=4, records_per_track=8)
    assert g.max_cylinder == 199
    assert g.max_track == 3
    assert g.max_record == 7
