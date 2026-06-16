"""银行家算法引擎已知答案校验（经典 Silberschatz 例子）。

5 进程 × 3 资源；Available=(3,3,2)。
安全序列：P1, P3, P4, P0, P2。
"""
from app.engines import banker_engine

AVAILABLE = [3, 3, 2]
MAX = [[7, 5, 3], [3, 2, 2], [9, 0, 2], [2, 2, 2], [4, 3, 3]]
ALLOC = [[0, 1, 0], [2, 0, 0], [3, 0, 2], [2, 1, 1], [0, 0, 2]]


def test_initial_state_is_safe():
    t = banker_engine.check_safety(AVAILABLE, MAX, ALLOC)
    assert t.metrics["安全"] is True
    assert t.final_state["安全序列"] == ["P1", "P3", "P4", "P0", "P2"]


def test_need_matrix():
    t = banker_engine.check_safety(AVAILABLE, MAX, ALLOC)
    assert t.final_state["Need"][0] == [7, 4, 3]
    assert t.final_state["Need"][1] == [1, 2, 2]
    assert t.module == "banker"


def test_request_granted_when_result_safe():
    t = banker_engine.request(AVAILABLE, MAX, ALLOC, 1, [1, 0, 2])
    assert t.metrics["可分配"] is True


def test_request_denied_when_result_unsafe():
    t = banker_engine.request(AVAILABLE, MAX, ALLOC, 4, [3, 3, 0])
    assert t.metrics["可分配"] is False


def test_request_exceeding_need_is_rejected():
    # P1 Need=(1,2,2)，请求 A 维度 2 > 1
    t = banker_engine.request(AVAILABLE, MAX, ALLOC, 1, [2, 0, 0])
    assert t.metrics["可分配"] is False
    assert "超过" in t.metrics["原因"]


def test_unsafe_state_detected():
    # 人为构造不安全：Available 全 0，且各进程仍有 Need
    alloc = [[1, 0], [0, 1]]
    maxm = [[2, 1], [1, 2]]
    t = banker_engine.check_safety([0, 0], maxm, alloc)
    assert t.metrics["安全"] is False
    assert t.final_state["死锁进程"]
