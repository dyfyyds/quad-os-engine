"""银行家算法（资源分配 / 死锁避免）引擎。

- check_safety(): 安全性算法 —— 给定 Available/Max/Allocation 判断是否安全并给出安全序列。
- request():      资源请求算法 —— 试探分配 + 安全性检查，决定立即分配 / 等待 / 拒绝。
  use_banker=False 时退化为「随机分配」(只看 Available，不做安全检查，可能死锁) 用于对照。
"""
from __future__ import annotations

from app.schemas.common import SimulationStep, SimulationTrace


def _need(maxm, alloc):
    return [[maxm[i][j] - alloc[i][j] for j in range(len(maxm[0]))] for i in range(len(maxm))]


def _le(a, b):
    return all(x <= y for x, y in zip(a, b))


def _safety(available, alloc, need):
    """多趟扫描安全性算法，返回 (safe, sequence, steps, work)。"""
    n, m = len(alloc), len(available)
    work = list(available)
    finish = [False] * n
    sequence: list[str] = []
    steps: list[SimulationStep] = []

    changed = True
    while changed:
        changed = False
        for i in range(n):
            if not finish[i] and _le(need[i], work):
                before = list(work)
                for j in range(m):
                    work[j] += alloc[i][j]
                finish[i] = True
                sequence.append(f"P{i}")
                changed = True
                steps.append(
                    SimulationStep(
                        index=len(sequence) - 1,
                        description=f"P{i}：Need{need[i]} ≤ Work{before}，可执行；回收后 Work = {list(work)}",
                        state={"Work前": before, "Work后": list(work), "选中进程": f"P{i}",
                               "已完成": sequence.copy()},
                        highlight={"进程": f"P{i}"},
                    )
                )

    safe = all(finish)
    deadlock = [f"P{i}" for i in range(n) if not finish[i]]
    return safe, sequence, steps, deadlock


def check_safety(available, maxm, alloc):
    need = _need(maxm, alloc)
    safe, sequence, steps, deadlock = _safety(available, alloc, need)
    metrics = {"安全": safe, "安全序列": sequence if safe else None}
    final_state = {
        "Available": list(available),
        "Max": maxm,
        "Allocation": alloc,
        "Need": need,
        "安全序列": sequence if safe else [],
        "死锁进程": deadlock,
    }
    return SimulationTrace(
        module="banker",
        algorithm="银行家-安全性",
        input_echo={"available": available, "max": maxm, "allocation": alloc},
        steps=steps,
        metrics=metrics,
        final_state=final_state,
    )


def _reject(reason, need, available):
    return SimulationTrace(
        module="banker",
        algorithm="银行家-请求",
        steps=[],
        metrics={"可分配": False, "原因": reason, "安全": False},
        final_state={"Need": need, "Available": list(available)},
    )


def request(available, maxm, alloc, pid, req, use_banker=True):
    need = _need(maxm, alloc)
    m = len(available)

    if not _le(req, need[pid]):
        return _reject(f"请求 {req} 超过进程 P{pid} 的最大需求 Need={need[pid]}", need, available)
    if not _le(req, available):
        return _reject(f"资源不足，请求 {req} > 可用 {list(available)}，进程 P{pid} 必须等待", need, available)

    new_avail = [available[j] - req[j] for j in range(m)]
    new_alloc = [list(row) for row in alloc]
    new_alloc[pid] = [alloc[pid][j] + req[j] for j in range(m)]
    new_need = _need(maxm, new_alloc)

    if not use_banker:
        return SimulationTrace(
            module="banker",
            algorithm="随机分配",
            steps=[],
            metrics={"可分配": True, "原因": "随机算法：可用资源充足即分配（未做安全检查，可能死锁）",
                     "安全": None},
            final_state={"Available": new_avail, "Allocation": new_alloc, "Need": new_need},
        )

    safe, sequence, steps, deadlock = _safety(new_avail, new_alloc, new_need)
    reason = (f"试探分配后系统安全，立即分配。安全序列 {sequence}" if safe
              else "试探分配后系统进入不安全状态，拒绝本次请求")
    return SimulationTrace(
        module="banker",
        algorithm="银行家-请求",
        input_echo={"pid": pid, "request": req},
        steps=steps,
        metrics={"可分配": safe, "原因": reason, "安全": safe},
        final_state={
            "Available": new_avail if safe else list(available),
            "Allocation": new_alloc if safe else alloc,
            "Need": new_need if safe else need,
            "安全序列": sequence if safe else [],
            "死锁进程": deadlock,
        },
    )
