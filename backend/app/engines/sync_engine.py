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
    s1 = n          # 空闲信号量
    s2 = 0          # 产品信号量
    mutex = 1       # 互斥信号量
    count = 0       # 缓冲区实际占用
    empty_q: list[str] = []   # 阻塞在 s1 上的生产者
    full_q: list[str] = []    # 阻塞在 s2 上的消费者
    mutex_q: list[str] = []   # 阻塞在 mutex 上的进程
    lock_owner: str | None = None

    process_roles: dict[str, str] = {}

    stat = {"produced": 0, "consumed": 0, "blocked": 0}
    steps: list[SimulationStep] = []

    def wake_producer(p_proc, notes_list):
        nonlocal count, s2, mutex, lock_owner
        notes_list.append(f"被唤醒生产者 {p_proc} 获得空闲槽")
        # 尝试 P(mutex)
        mutex -= 1
        if mutex < 0:
            mutex_q.append(p_proc)
            notes_list.append(f"P(mutex) 后 mutex={mutex}<0，{p_proc} 进入互斥锁阻塞队列")
        else:
            lock_owner = p_proc
            notes_list.append(f"{p_proc} 获得锁进入临界区，放入产品")
            count += 1
            stat["produced"] += 1
            # V(mutex)
            mutex += 1
            lock_owner = None
            if mutex <= 0 and mutex_q:
                next_w = mutex_q.pop(0)
                notes_list.append(f"V(mutex) 释放锁，唤醒互斥队列进程 {next_w}")
                wake_mutex(next_w, notes_list)
            # V(s2)
            s2 += 1
            if s2 <= 0 and full_q:
                next_c = full_q.pop(0)
                notes_list.append(f"V(s2) 唤醒消费者 {next_c}")
                wake_consumer(next_c, notes_list)

    def wake_consumer(c_proc, notes_list):
        nonlocal count, s1, mutex, lock_owner
        notes_list.append(f"被唤醒消费者 {c_proc} 获得产品")
        # 尝试 P(mutex)
        mutex -= 1
        if mutex < 0:
            mutex_q.append(c_proc)
            notes_list.append(f"P(mutex) 后 mutex={mutex}<0，{c_proc} 进入互斥锁阻塞队列")
        else:
            lock_owner = c_proc
            notes_list.append(f"{c_proc} 获得锁进入临界区，取出产品")
            count -= 1
            stat["consumed"] += 1
            # V(mutex)
            mutex += 1
            lock_owner = None
            if mutex <= 0 and mutex_q:
                next_w = mutex_q.pop(0)
                notes_list.append(f"V(mutex) 释放锁，唤醒互斥队列进程 {next_w}")
                wake_mutex(next_w, notes_list)
            # V(s1)
            s1 += 1
            if s1 <= 0 and empty_q:
                next_p = empty_q.pop(0)
                notes_list.append(f"V(s1) 唤醒生产者 {next_p}")
                wake_producer(next_p, notes_list)

    def wake_mutex(m_proc, notes_list):
        nonlocal count, s1, s2, mutex, lock_owner
        notes_list.append(f"互斥队列进程 {m_proc} 被唤醒并获得互斥锁")
        lock_owner = m_proc
        
        role = process_roles.get(m_proc)
        if role is None:
            is_prod = "producer" in m_proc.lower() or "生产者" in m_proc.lower() or "logger" in m_proc.lower() or "daemon" in m_proc.lower()
            role = "produce" if is_prod else "consume"
            
        if role == "produce":
            count += 1
            stat["produced"] += 1
            notes_list.append(f"生产者 {m_proc} 放入产品，缓冲区占用 {count}")
            # V(mutex)
            mutex += 1
            lock_owner = None
            if mutex <= 0 and mutex_q:
                next_w = mutex_q.pop(0)
                notes_list.append(f"V(mutex) 释放锁，唤醒互斥队列进程 {next_w}")
                wake_mutex(next_w, notes_list)
            # V(s2)
            s2 += 1
            if s2 <= 0 and full_q:
                next_c = full_q.pop(0)
                notes_list.append(f"V(s2) 唤醒消费者 {next_c}")
                wake_consumer(next_c, notes_list)
        else:
            count -= 1
            stat["consumed"] += 1
            notes_list.append(f"消费者 {m_proc} 取出产品，缓冲区占用 {count}")
            # V(mutex)
            mutex += 1
            lock_owner = None
            if mutex <= 0 and mutex_q:
                next_w = mutex_q.pop(0)
                notes_list.append(f"V(mutex) 释放锁，唤醒互斥队列进程 {next_w}")
                wake_mutex(next_w, notes_list)
            # V(s1)
            s1 += 1
            if s1 <= 0 and empty_q:
                next_p = empty_q.pop(0)
                notes_list.append(f"V(s1) 唤醒生产者 {next_p}")
                wake_producer(next_p, notes_list)

    for idx, op in enumerate(operations):
        typ = op["type"]
        proc = op.get("proc") or (f"生产者{idx}" if typ == "produce" else f"消费者{idx}")
        process_roles[proc] = typ
        notes: list[str] = []

        if typ == "produce":
            s1 -= 1                   # P(s1)
            if s1 < 0:
                empty_q.append(proc)
                stat["blocked"] += 1
                notes.append(f"P(s1) 后 s1={s1}<0，{proc} 阻塞（缓冲区满）")
            else:
                # P(mutex)
                mutex -= 1
                if mutex < 0:
                    mutex_q.append(proc)
                    stat["blocked"] += 1
                    notes.append(f"P(mutex) 后 mutex={mutex}<0，{proc} 进入互斥锁阻塞队列")
                else:
                    lock_owner = proc
                    count += 1
                    stat["produced"] += 1
                    notes.append(f"{proc} 生产一件，缓冲区占用 {count}")
                    # V(mutex)
                    mutex += 1
                    lock_owner = None
                    if mutex <= 0 and mutex_q:
                        next_w = mutex_q.pop(0)
                        notes.append(f"V(mutex) 释放锁，唤醒互斥队列进程 {next_w}")
                        wake_mutex(next_w, notes)
                    # V(s2)
                    s2 += 1
                    if s2 <= 0 and full_q:
                        next_c = full_q.pop(0)
                        notes.append(f"V(s2) 唤醒消费者 {next_c}")
                        wake_consumer(next_c, notes)
        else:                         # consume
            s2 -= 1                   # P(s2)
            if s2 < 0:
                full_q.append(proc)
                stat["blocked"] += 1
                notes.append(f"P(s2) 后 s2={s2}<0，{proc} 阻塞（缓冲区空）")
            else:
                # P(mutex)
                mutex -= 1
                if mutex < 0:
                    mutex_q.append(proc)
                    stat["blocked"] += 1
                    notes.append(f"P(mutex) 后 mutex={mutex}<0，{proc} 进入互斥锁阻塞队列")
                else:
                    lock_owner = proc
                    count -= 1
                    stat["consumed"] += 1
                    notes.append(f"{proc} 消费一件，缓冲区占用 {count}")
                    # V(mutex)
                    mutex += 1
                    lock_owner = None
                    if mutex <= 0 and mutex_q:
                        next_w = mutex_q.pop(0)
                        notes.append(f"V(mutex) 释放锁，唤醒互斥队列进程 {next_w}")
                        wake_mutex(next_w, notes)
                    # V(s1)
                    s1 += 1
                    if s1 <= 0 and empty_q:
                        next_p = empty_q.pop(0)
                        notes.append(f"V(s1) 唤醒生产者 {next_p}")
                        wake_producer(next_p, notes)

        steps.append(
            SimulationStep(
                index=idx,
                description=f"[{proc}] " + "；".join(notes),
                state={
                    "s1_空闲": s1, "s2_产品": s2, "mutex_互斥": mutex,
                    "缓冲区占用": count, "缓冲区容量": n,
                    "生产者阻塞队列": empty_q.copy(), "消费者阻塞队列": full_q.copy(),
                    "互斥阻塞队列": mutex_q.copy(), "锁持有者": lock_owner,
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
        "mutex_互斥": mutex,
    }
    final_state = {
        "缓冲区容量": n, "缓冲区占用": count,
        "生产者阻塞队列": empty_q, "消费者阻塞队列": full_q, "互斥阻塞队列": mutex_q,
        "s1_空闲": s1, "s2_产品": s2, "mutex_互斥": mutex, "锁持有者": lock_owner,
    }
    return SimulationTrace(
        module="sync",
        algorithm="PV-生产者消费者",
        input_echo={"operations": operations, "buffer_size": n},
        steps=steps,
        metrics=metrics,
        final_state=final_state,
    )
