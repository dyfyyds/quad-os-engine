"""作业/进程调度引擎。

非抢占：FCFS / SJF / HRRN / PRIORITY；抢占：RR（时间片轮转）。
作业输入：{name, arrival(到达), burst(服务), priority(可选, 1=最高)}。
"""
from __future__ import annotations

from app.schemas.common import SimulationStep, SimulationTrace

NONPREEMPTIVE = ["FCFS", "SJF", "HRRN", "PRIORITY"]
ALGORITHMS = NONPREEMPTIVE + ["RR"]


def _key(algo, j, time):
    if algo == "FCFS":
        return (j["arrival"], j["_idx"])
    if algo == "SJF":
        return (j["burst"], j["arrival"], j["_idx"])
    if algo == "HRRN":
        wait = max(0, time - j["arrival"])
        rr = (wait + j["burst"]) / j["burst"]
        return (-rr, j["_idx"])
    if algo == "PRIORITY":
        pr = j["priority"] if j.get("priority") is not None else 0
        return (pr, j["arrival"], j["_idx"])
    raise ValueError(algo)


def _finalize(job, finish):
    job["完成时间"] = finish
    job["周转时间"] = finish - job["arrival"]
    job["带权周转时间"] = round(job["周转时间"] / job["burst"], 2)
    job["等待时间"] = job["周转时间"] - job["burst"]


def _nonpreemptive(jobs, algo):
    remaining = [dict(j) for j in jobs]
    time = 0
    gantt, done = [], []
    while remaining:
        available = [j for j in remaining if j["arrival"] <= time]
        if not available:
            time = min(j["arrival"] for j in remaining)
            available = [j for j in remaining if j["arrival"] <= time]
        chosen = min(available, key=lambda j: _key(algo, j, time))
        start = max(time, chosen["arrival"])
        finish = start + chosen["burst"]
        gantt.append({"作业": chosen["name"], "开始": start, "结束": finish})
        _finalize(chosen, finish)
        done.append(chosen)
        remaining.remove(chosen)
        time = finish
    return gantt, done


def _round_robin(jobs, q):
    pool = sorted((dict(j, remaining=j["burst"]) for j in jobs),
                  key=lambda j: (j["arrival"], j["_idx"]))
    time = 0
    i = 0
    queue, gantt, done = [], [], []

    def enqueue(upto):
        nonlocal i
        while i < len(pool) and pool[i]["arrival"] <= upto:
            queue.append(pool[i])
            i += 1

    enqueue(time)
    if not queue and pool:
        time = pool[0]["arrival"]
        enqueue(time)

    while queue:
        job = queue.pop(0)
        run = min(q, job["remaining"])
        start, finish = time, time + run
        gantt.append({"作业": job["name"], "开始": start, "结束": finish})
        job["remaining"] -= run
        time = finish
        enqueue(time)                 # 本时间片内到达的新作业先入队
        if job["remaining"] > 0:
            queue.append(job)         # 再把未完成作业排到队尾
        else:
            _finalize(job, finish)
            done.append(job)
    return gantt, done


def run(algorithm, jobs, time_quantum=None):
    algo = algorithm.upper()
    if algo not in ALGORITHMS:
        raise ValueError(f"未知调度算法: {algorithm}")

    norm = [
        {"name": j["name"], "arrival": j.get("arrival", 0), "burst": j["burst"],
         "priority": j.get("priority"), "_idx": i}
        for i, j in enumerate(jobs)
    ]

    if algo == "RR":
        gantt, done = _round_robin(norm, time_quantum or 1)
    else:
        gantt, done = _nonpreemptive(norm, algo)

    n = len(done)
    makespan = max(j["完成时间"] for j in done)
    busy = sum(j["burst"] for j in done)
    metrics = {
        "平均周转时间": round(sum(j["周转时间"] for j in done) / n, 2),
        "平均带权周转时间": round(sum(j["带权周转时间"] for j in done) / n, 2),
        "平均等待时间": round(sum(j["等待时间"] for j in done) / n, 2),
        "CPU利用率": round(busy / makespan, 2) if makespan else 0,
    }

    finish_order = [j["name"] for j in sorted(done, key=lambda j: (j["完成时间"], j["_idx"]))]
    detail = [
        {"作业": j["name"], "到达": j["arrival"], "服务": j["burst"], "完成": j["完成时间"],
         "周转": j["周转时间"], "带权周转": j["带权周转时间"], "等待": j["等待时间"]}
        for j in sorted(done, key=lambda j: j["_idx"])
    ]

    steps = [
        SimulationStep(
            index=k,
            description=f"时刻 {seg['开始']}：作业 {seg['作业']} 占用 CPU，执行至 {seg['结束']}",
            state={"已完成甘特": gantt[: k + 1], "当前作业": seg["作业"], "时刻": seg["结束"]},
            highlight={"作业": seg["作业"]},
        )
        for k, seg in enumerate(gantt)
    ]

    return SimulationTrace(
        module="scheduling",
        algorithm=algo,
        input_echo={"jobs": jobs, "time_quantum": time_quantum},
        steps=steps,
        metrics=metrics,
        final_state={"完成顺序": finish_order, "甘特图": gantt, "作业明细": detail},
    )
