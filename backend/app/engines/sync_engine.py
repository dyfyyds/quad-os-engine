"""进程同步引擎：PV 操作信号量机制 + 有界缓冲区生产者-消费者（实习六）。

计数信号量语义：
  P(s): s -= 1; 若 s < 0 则调用进程阻塞，入 s 的等待队列。
  V(s): s += 1; 若 s <= 0 则唤醒 s 等待队列中的一个进程，使其继续执行。

生产者：P(s1=空闲) → 放入缓冲 → V(s2=产品)
消费者：P(s2=产品) → 取出缓冲 → V(s1=空闲)
被阻塞的生产者/消费者被唤醒后，继续完成其后半段（放入/取出 + 对应 V 操作）。
"""
from __future__ import annotations

from app.schemas.common import SimulationStep, SimulationTrace


def run(operations, buffer_size):
    n = buffer_size
    s1 = n          # 空闲缓冲区
    s2 = 0          # 产品数
    count = 0       # 缓冲区实际占用
    empty_q: list[str] = []   # 阻塞在 s1 上的生产者
    full_q: list[str] = []    # 阻塞在 s2 上的消费者

    stat = {"produced": 0, "consumed": 0, "blocked": 0}
    steps: list[SimulationStep] = []

    def wake_producer(notes):
        nonlocal count, s2
        count += 1
        stat["produced"] += 1
        s2 += 1                       # V(s2)
        if s2 <= 0 and full_q:
            w = full_q.pop(0)
            notes.append(f"V(s2) 唤醒消费者 {w}")
            wake_consumer(notes)

    def wake_consumer(notes):
        nonlocal count, s1
        count -= 1
        stat["consumed"] += 1
        s1 += 1                       # V(s1)
        if s1 <= 0 and empty_q:
            w = empty_q.pop(0)
            notes.append(f"V(s1) 唤醒生产者 {w}")
            wake_producer(notes)

    for idx, op in enumerate(operations):
        typ = op["type"]
        proc = op.get("proc") or (f"生产者{idx}" if typ == "produce" else f"消费者{idx}")
        notes: list[str] = []

        if typ == "produce":
            s1 -= 1                   # P(s1)
            if s1 < 0:
                empty_q.append(proc)
                stat["blocked"] += 1
                notes.append(f"P(s1) 后 s1={s1}<0，{proc} 阻塞（缓冲区满）")
            else:
                count += 1
                stat["produced"] += 1
                s2 += 1               # V(s2)
                if s2 <= 0 and full_q:
                    w = full_q.pop(0)
                    notes.append(f"V(s2) 唤醒消费者 {w}")
                    wake_consumer(notes)
                notes.append(f"{proc} 生产一件，缓冲区占用 {count}")
        else:                         # consume
            s2 -= 1                   # P(s2)
            if s2 < 0:
                full_q.append(proc)
                stat["blocked"] += 1
                notes.append(f"P(s2) 后 s2={s2}<0，{proc} 阻塞（缓冲区空）")
            else:
                count -= 1
                stat["consumed"] += 1
                s1 += 1               # V(s1)
                if s1 <= 0 and empty_q:
                    w = empty_q.pop(0)
                    notes.append(f"V(s1) 唤醒生产者 {w}")
                    wake_producer(notes)
                notes.append(f"{proc} 消费一件，缓冲区占用 {count}")

        steps.append(
            SimulationStep(
                index=idx,
                description=f"[{proc}] " + "；".join(notes),
                state={
                    "s1_空闲": s1, "s2_产品": s2, "缓冲区占用": count, "缓冲区容量": n,
                    "生产者阻塞队列": empty_q.copy(), "消费者阻塞队列": full_q.copy(),
                    "已生产": stat["produced"], "已消费": stat["consumed"],
                },
                highlight={"操作": typ, "进程": proc},
            )
        )

    metrics = {
        "生产次数": stat["produced"],
        "消费次数": stat["consumed"],
        "阻塞次数": stat["blocked"],
        "缓冲区占用": count,
        "s1_空闲": s1,
        "s2_产品": s2,
    }
    final_state = {
        "缓冲区容量": n, "缓冲区占用": count,
        "生产者阻塞队列": empty_q, "消费者阻塞队列": full_q,
        "s1_空闲": s1, "s2_产品": s2,
    }
    return SimulationTrace(
        module="sync",
        algorithm="PV-生产者消费者",
        input_echo={"operations": operations, "buffer_size": n},
        steps=steps,
        metrics=metrics,
        final_state=final_state,
    )
