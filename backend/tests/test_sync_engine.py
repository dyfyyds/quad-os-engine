"""进程同步引擎（PV 操作 / 生产者-消费者）已知答案校验。

信号量：s1=空闲缓冲区(初值=容量)，s2=产品数(初值=0)。
生产者：P(s1) → 放入 → V(s2)；消费者：P(s2) → 取出 → V(s1)。
"""
from app.engines import sync_engine


def ops(*seq):
    return [{"type": t} for t in seq]


def test_alternating_never_blocks():
    t = sync_engine.run(ops("produce", "consume", "produce", "consume"), buffer_size=10)
    assert t.metrics["生产次数"] == 2
    assert t.metrics["消费次数"] == 2
    assert t.metrics["阻塞次数"] == 0
    assert t.metrics["缓冲区占用"] == 0


def test_full_buffer_blocks_then_resumes():
    # 容量 2：连续生产 3 次（第 3 次阻塞），再消费 1 次唤醒它
    t = sync_engine.run(ops("produce", "produce", "produce", "consume"), buffer_size=2)
    assert t.metrics["生产次数"] == 3      # 被阻塞的生产者被唤醒后完成
    assert t.metrics["消费次数"] == 1
    assert t.metrics["阻塞次数"] == 1
    assert t.metrics["缓冲区占用"] == 2
    assert t.metrics["s1_空闲"] == 0
    assert t.metrics["s2_产品"] == 2


def test_empty_buffer_blocks_consumer():
    t = sync_engine.run(ops("consume"), buffer_size=10)
    assert t.metrics["消费次数"] == 0
    assert t.metrics["阻塞次数"] == 1
    assert t.metrics["s2_产品"] == -1


def test_trace_shape():
    o = ops("produce", "consume")
    t = sync_engine.run(o, buffer_size=10)
    assert t.module == "sync"
    assert len(t.steps) == len(o)


def test_custom_process_names_role_deduction():
    operations = [
        {"type": "produce", "proc": "P1"},
        {"type": "produce", "proc": "P1"},
        {"type": "produce", "proc": "P1"},
        {"type": "consume", "proc": "C1"},
    ]
    t = sync_engine.run(operations, buffer_size=2)
    assert t.metrics["生产次数"] == 3
    assert t.metrics["消费次数"] == 1
    assert t.metrics["阻塞次数"] == 1

