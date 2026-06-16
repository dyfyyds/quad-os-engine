"""作业/进程调度引擎已知答案校验。

作业集（到达, 服务, 优先级[1=最高]）：
A(0,4,3)  B(1,3,1)  C(2,5,4)  D(3,2,2)
手算：
- FCFS 完成序 A,B,C,D，平均周转 7.75，平均等待 4.25
- SJF  完成序 A,D,B,C，平均周转 6.75
- HRRN 完成序 A,B,D,C，平均周转 7.0
- 优先级 完成序 A,B,D,C
RR（全部 0 时刻到达，A=4 B=3 C=3，时间片=2）：平均周转 9.0，完成序 A,B,C
"""
from app.engines import scheduling_engine

JOBS = [
    {"name": "A", "arrival": 0, "burst": 4, "priority": 3},
    {"name": "B", "arrival": 1, "burst": 3, "priority": 1},
    {"name": "C", "arrival": 2, "burst": 5, "priority": 4},
    {"name": "D", "arrival": 3, "burst": 2, "priority": 2},
]


def test_fcfs():
    t = scheduling_engine.run("FCFS", JOBS)
    assert t.final_state["完成顺序"] == ["A", "B", "C", "D"]
    assert t.metrics["平均周转时间"] == 7.75
    assert t.metrics["平均等待时间"] == 4.25


def test_sjf():
    t = scheduling_engine.run("SJF", JOBS)
    assert t.final_state["完成顺序"] == ["A", "D", "B", "C"]
    assert t.metrics["平均周转时间"] == 6.75


def test_hrrn():
    t = scheduling_engine.run("HRRN", JOBS)
    assert t.final_state["完成顺序"] == ["A", "B", "D", "C"]
    assert t.metrics["平均周转时间"] == 7.0


def test_priority_nonpreemptive():
    t = scheduling_engine.run("PRIORITY", JOBS)
    assert t.final_state["完成顺序"] == ["A", "B", "D", "C"]


def test_round_robin():
    jobs = [
        {"name": "A", "arrival": 0, "burst": 4},
        {"name": "B", "arrival": 0, "burst": 3},
        {"name": "C", "arrival": 0, "burst": 3},
    ]
    t = scheduling_engine.run("RR", jobs, time_quantum=2)
    assert t.final_state["完成顺序"] == ["A", "B", "C"]
    assert t.metrics["平均周转时间"] == 9.0


def test_trace_shape():
    t = scheduling_engine.run("FCFS", JOBS)
    assert t.module == "scheduling"
    assert len(t.final_state["甘特图"]) >= 4
    assert len(t.final_state["作业明细"]) == 4
