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


def test_average_seek_is_total_over_request_count():
    t = run("FCFS")
    assert t.metrics["平均寻道长度"] == round(640 / 8, 2)


def test_steps_have_one_entry_per_served_request():
    t = run("SSTF")
    # 每个服务的请求对应一步
    assert len(t.steps) == len(REQUESTS)
    assert t.module == "disk"
    assert t.algorithm == "SSTF"
