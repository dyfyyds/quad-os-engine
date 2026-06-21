"""数字孪生整拍引擎：纯函数 tick(state) -> (state, events)。

忠实移植自 frontend/src/mock/localTick.js（前端离线兜底引擎）：顺序、判定、
事件文案、数值格式逐一对齐，由 backend/tests/test_twin_parity.py 锁定 30 拍一致。

> Phase 1 为保证 exact parity，本引擎与实验页引擎（paging/banker/...）暂有重复逻辑；
> Phase 3 审计时再把「前端本地 / 后端孪生 / 后端实验页」三者统一为一套语义并去重。
"""
from __future__ import annotations

import math
import re
from decimal import Decimal, ROUND_HALF_UP

from app.engines.rng import Mulberry32

JOB_NAMES = ["gcc", "vim", "sync", "cron", "http", "db"]
DISK_BUSY_WINDOW = 10
IO_PROB = {
    "vim": 0.25, "http": 0.20, "db": 0.25, "sync": 0.15,
    "cron": 0.03, "gcc": 0.03, "init": 0.01, "shell": 0.05,
    "logger": 0.10, "daemon": 0.08, "default": 0.08,
}
INF = float("inf")
_PNUM = re.compile(r"^P(\d+)$")


# —— 与 JS 数值语义对齐的工具 ——
def _round(x):
    """JS Math.round（非负数）：floor(x + 0.5)。"""
    return int(math.floor(x + 0.5))


def _fix2(x):
    """JS Number(x.toFixed(2))（非负数，半进上，作用于精确 double 值）。"""
    return float(Decimal(x).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def _arr(a):
    """JS 模板字符串里数组转字符串：逗号连接、无空格。"""
    return ",".join(str(x) for x in a)


# —— 小工具 ——
def _running(state):
    return next((p for p in state["processes"] if p["state"] == "运行"), None)


def _clamp_index(n, length):
    return (((n % length) + length) % length) if length else 0


def _vec_le(a, b):
    return all(x <= b[j] for j, x in enumerate(a))


def _calc_need(maxm, alloc):
    return [[maxm[i][j] - alloc[i][j] for j in range(len(row))] for i, row in enumerate(maxm)]


def _translate_names(state, lst):
    out = []
    procs = state["processes"]
    for name in (lst or []):
        m = _PNUM.match(str(name))
        if m:
            idx = int(m.group(1))
            nm = procs[idx]["name"] if 0 <= idx < len(procs) else None
            out.append(nm or name)
        else:
            out.append(name)
    return out


def _find_frame_owner(state, slot):
    for p in state["processes"]:
        pt = p.get("pageTable")
        if pt:
            for row in pt:
                if row["标志"] == 1 and row["主存块号"] == slot:
                    return p, row
    return None, None


def _get_io_prob(name):
    prefix = re.sub(r"\d+$", "", name)
    return IO_PROB.get(prefix, IO_PROB["default"])


def _seed_scheduler(state):
    ready = sorted(
        (p for p in state["processes"] if p["state"] == "就绪"),
        key=lambda p: (p["arrival"], p["pid"]),
    )
    state["scheduler"]["rrQueue"] = [p["pid"] for p in ready]
    run = _running(state)
    state["scheduler"]["currentPid"] = run["pid"] if run else None
    state["scheduler"]["quantumUsed"] = 0


# ———————————————————————— 处理机 ————————————————————————
def _apply_cpu(state, push):
    time = state["clock"]
    sch = state["scheduler"]
    procs = state["processes"]
    disk = state["disk"]
    cfg = state["config"]

    # —— I/O 完成协调器 ——
    queue_names = set(r["进程名"] for r in disk["queue"])
    just_unblocked = set()
    for i in range(len(disk["ioBlocked"]) - 1, -1, -1):
        name = disk["ioBlocked"][i]
        if name not in queue_names:
            disk["ioBlocked"].pop(i)
            proc = next((p for p in procs if p["name"] == name), None)
            if proc and proc["state"] == "阻塞":
                proc["state"] = "就绪"
                proc["blockedReason"] = ""
                proc["pageWaitingFor"] = None
                proc["blockedAt"] = None
                just_unblocked.add(name)
                push("I/O完成", "device", "info", f"{name} I/O 完成 → 解除阻塞，重新加入就绪队列")
                if cfg["schedAlgo"] == "RR" and proc["pid"] not in sch["rrQueue"]:
                    sch["rrQueue"].append(proc["pid"])

    # 第一轮：完成回收 / 新建→就绪
    for p in procs:
        if p["ran"] >= p["burst"] and p["burst"] > 0:
            if p["state"] != "完成":
                p["state"] = "完成"
                if p.get("finishTime") is None:
                    p["finishTime"] = time - 1
                push("进程完成", "processor", "info", f"{p['name']}(P{p['pid']}) 服务时间用尽，周转 {p['finishTime'] - p['arrival']}")

                r = state["resources"]
                idx = next((k for k, x in enumerate(procs) if x["pid"] == p["pid"]), -1)
                if idx >= 0:
                    alloc = r["allocation"][idx]
                    if any(v > 0 for v in alloc):
                        r["available"] = [v + alloc[j] for j, v in enumerate(r["available"])]
                        r["allocation"][idx] = [0 for _ in alloc]
                        r["need"][idx] = [0 for _ in r["max"][idx]]
                        push("资源释放", "resource", "info", f"{p['name']} 完成，回收全部持有的资源 [{_arr(alloc)}]")
                        _refresh_banker_safety(state, push, False)

                new_frames = []
                released_frames = []
                for slot, frame_page in enumerate(state["memory"]["frames"]):
                    if frame_page is not None:
                        page_index = next(
                            (k for k, row in enumerate(p["pageTable"]) if row["标志"] == 1 and row["主存块号"] == slot),
                            -1,
                        )
                        if page_index >= 0:
                            released_frames.append((slot, frame_page))
                            p["pageTable"][page_index]["标志"] = 0
                            p["pageTable"][page_index]["主存块号"] = None
                            p["pageTable"][page_index]["访问位"] = 0
                            p["pageTable"][page_index]["修改位"] = 0
                            new_frames.append(None)
                            continue
                    new_frames.append(frame_page)
                state["memory"]["frames"] = new_frames
                if released_frames:
                    detail = "、".join(f"块 {slot}(页 {page})" for slot, page in released_frames)
                    push("内存释放", "memory", "info",
                         f"{p['name']} 完成，统一释放 {len(released_frames)} 个物理页框：{detail}")
                else:
                    push("内存释放", "memory", "info", f"{p['name']} 完成，当前未占用物理页框")
        elif time < p["arrival"]:
            p["state"] = "新建"
        elif p["state"] == "新建" and time >= p["arrival"]:
            p["state"] = "就绪"
            if cfg["schedAlgo"] == "RR" and p["pid"] not in sch["rrQueue"]:
                sch["rrQueue"].append(p["pid"])
            push("作业就绪", "processor", "info", f"{p['name']}(P{p['pid']}) 到达 → 进入就绪队列")

    # 第二轮：时间片 / 抢占
    if cfg["schedAlgo"] == "RR":
        ready_pids = {p["pid"] for p in procs if p["state"] == "就绪"}
        new_queue = [pid for pid in sch["rrQueue"] if pid in ready_pids]
        missing = sorted(
            (p for p in procs if p["state"] == "就绪" and p["pid"] not in new_queue),
            key=lambda p: (p["arrival"], p["pid"])
        )
        for p in missing:
            new_queue.append(p["pid"])
        sch["rrQueue"] = new_queue

    ready_for_sched = [p for p in procs if p["state"] == "就绪"]

    current_running = _running(state)
    if current_running:
        if current_running["ran"] >= current_running["burst"]:
            sch["currentPid"] = None
            sch["quantumUsed"] = 0
        elif cfg["schedAlgo"] == "RR" and sch["quantumUsed"] >= cfg["quantum"]:
            current_running["state"] = "就绪"
            if current_running["pid"] not in sch["rrQueue"]:
                sch["rrQueue"].append(current_running["pid"])
            push("进程抢占", "processor", "info", f"{current_running['name']} 时间片到，让出 CPU 回就绪队列")
            sch["currentPid"] = None
            sch["quantumUsed"] = 0
        elif cfg["schedAlgo"] == "SJF" and ready_for_sched:
            best_ready = min(ready_for_sched, key=lambda p: (p["burst"] - p["ran"], p["arrival"], p["pid"]))
            rem_running = current_running["burst"] - current_running["ran"]
            rem_ready = best_ready["burst"] - best_ready["ran"]
            if rem_ready < rem_running:
                current_running["state"] = "就绪"
                push("进程抢占", "processor", "info", f"发现更短就绪进程 {best_ready['name']}(剩{rem_ready}拍)，{current_running['name']}(剩{rem_running}拍) 被抢占")
                sch["currentPid"] = None
                sch["quantumUsed"] = 0
            else:
                sch["quantumUsed"] += 1
        elif cfg["schedAlgo"] == "PRIORITY" and ready_for_sched:
            best_ready = min(ready_for_sched, key=lambda p: (p["priority"], p["arrival"], p["pid"]))
            if best_ready["priority"] < current_running["priority"]:
                current_running["state"] = "就绪"
                push("进程抢占", "processor", "info", f"发现更高优先级进程 {best_ready['name']}(级{best_ready['priority']})，{current_running['name']}(级{current_running['priority']}) 被抢占")
                sch["currentPid"] = None
                sch["quantumUsed"] = 0
            else:
                sch["quantumUsed"] += 1
        else:
            sch["quantumUsed"] += 1

    # 调度核心
    if not _running(state):
        ready = [p for p in procs if p["state"] == "就绪"]
        if ready:
            chosen = None
            algo = cfg["schedAlgo"]
            if algo == "FCFS":
                chosen = sorted(ready, key=lambda p: (p["arrival"], p["pid"]))[0]
            elif algo == "SJF":
                chosen = sorted(ready, key=lambda p: (p["burst"] - p["ran"], p["arrival"], p["pid"]))[0]
            elif algo == "HRRN":
                def ratio(p):
                    wait = max(0, time - p["arrival"])
                    service = p["burst"]
                    return (wait + service) / max(1, service)
                chosen = sorted(ready, key=lambda p: (-ratio(p), p["pid"]))[0]
            elif algo == "PRIORITY":
                chosen = sorted(ready, key=lambda p: (p["priority"], p["arrival"], p["pid"]))[0]
            elif algo == "RR":
                found_pid = None
                for pid in sch["rrQueue"]:
                    if any(c["pid"] == pid for c in ready):
                        found_pid = pid
                        break
                if found_pid is not None:
                    chosen = next(c for c in ready if c["pid"] == found_pid)
                    sch["rrQueue"] = [pid for pid in sch["rrQueue"] if pid != found_pid]
                else:
                    chosen = sorted(ready, key=lambda p: (p["arrival"], p["pid"]))[0]
            else:
                chosen = ready[0]

            if chosen:
                chosen["state"] = "运行"
                sch["currentPid"] = chosen["pid"]
                # 每次派发都消耗当拍 1 个时间片单位（被抢占后立即重新选中也一样）：
                # dispatch 当拍进程会 ran++，故 quantumUsed 必须从 1 起算，否则该进程多跑 1 拍。
                sch["quantumUsed"] = 1
                push("进程调度", "processor", "info", f"{chosen['name']}(P{chosen['pid']}) 占用 CPU")

    # MMU 上下文切换
    active = _running(state)
    if active:
        state["memory"]["pageTable"] = [dict(row) for row in active["pageTable"]]
        state["memory"]["lastReplace"] = dict(active["lastReplace"])
        state["memory"]["hits"] = active["hits"]
        state["memory"]["faults"] = active["faults"]

    # 指标聚合
    done = [p for p in procs if p["state"] == "完成"]
    state["metrics"]["completed"] = len(done)
    state["metrics"]["readyLen"] = len([p for p in procs if p["state"] == "就绪"])
    state["metrics"]["blockedLen"] = len([p for p in procs if p["state"] == "阻塞"])
    state["metrics"]["throughput"] = _fix2(len(done) / max(1, time))
    turnarounds = [((p.get("finishTime") if p.get("finishTime") is not None else time) - p["arrival"]) for p in done]
    state["metrics"]["avgTurnaround"] = _fix2(sum(turnarounds) / len(turnarounds)) if turnarounds else 0

    return _running(state)


def _on_cpu_disk_request(state, running_proc, rng, push):
    d = state["disk"]
    if len(d["queue"]) >= 8:
        return
    if rng.next() >= _get_io_prob(running_proc["name"]):
        return
    req = _make_request(state)
    if running_proc:
        req["进程名"] = running_proc["name"]
    d["queue"].append(req)
    if running_proc and running_proc["name"] not in d["ioBlocked"]:
        d["ioBlocked"].append(running_proc["name"])
        running_proc["state"] = "阻塞"
        running_proc["blockedReason"] = f"等待磁盘 I/O - 柱面 {req['柱面号']} 磁道 {req['磁道号']} 记录 {req['物理记录号']}"
    push("I/O请求", "device", "info",
         f"{req['进程名']} 发起 I/O → 进入阻塞态：柱面 {req['柱面号']}/磁道 {req['磁道号']}/记录 {req['物理记录号']}")


# ———————————————————————— 存储 ————————————————————————
def _apply_memory_step(state, push):
    rp = _running(state)
    if not rp:
        return
    refs = rp["refString"]
    step_idx = rp["refPtr"] % len(refs)
    page = refs[step_idx]
    rp["refPtr"] += 1
    pt = rp["pageTable"]
    row = pt[page] if 0 <= page < len(pt) else None
    hit = row is not None and row["标志"] == 1
    now = state["clock"]
    block_size = state["config"].get("blockSize") or 128
    unit = (page * 31 + now * 17) % block_size

    if hit:
        rp["hits"] += 1
        row["lastUsed"] = now
        if state["config"].get("pageAlgo") == "CLOCK":
            row["访问位"] = 1
        if ((page + now) % 5) < 2:
            row["修改位"] = 1
        slot = row["主存块号"]
        abs_addr = slot * block_size + unit
        rp["lastReplace"] = {
            "访问页": page, "单元号": unit, "缺页": False,
            "调出页": None, "装入页": None, "装入块": None, "写回": False,
            "绝对地址": abs_addr,
        }
        state["memory"]["hits"] = rp["hits"]
        state["memory"]["refPtr"] = rp["refPtr"]
        state["memory"]["pageTable"] = [dict(r) for r in rp["pageTable"]]
        state["memory"]["lastReplace"] = dict(rp["lastReplace"])
        state["memory"]["tickAccess"] = {
            "clock": now, "pid": rp["pid"], "processName": rp["name"],
            "performed": True, "result": "hit", "page": page, "unit": unit,
        }
        push("访存命中", "memory", "info",
             f"{rp['name']} 访问 [页 {page} 单元 {unit}]，命中物理块 {slot}")
    else:
        exists = any(
            r.get("进程名") == rp["name"] and r.get("isPageFault") and r.get("page") == page
            for r in state["disk"]["queue"]
        )
        if not exists:
            rp["faults"] += 1
            rp["state"] = "阻塞"
            rp["blockedReason"] = f"缺页中断: 等待装入页 {page}"
            rp["pageWaitingFor"] = page
            rp["blockedAt"] = now
            if rp["name"] not in state["disk"]["ioBlocked"]:
                state["disk"]["ioBlocked"].append(rp["name"])
            state["disk"]["queue"].append({
                "进程名": rp["name"],
                "柱面号": (page * 31) % state["disk"]["cylinders"],
                "磁道号": 0,
                "物理记录号": 0,
                "isPageFault": True,
                "page": page,
                "unit": unit,
            })
            rp["lastReplace"] = {
                "访问页": page, "单元号": unit, "缺页": True,
                "调出页": None, "装入页": None, "装入块": None, "写回": False,
                "绝对地址": None,
            }
            state["memory"]["lastReplace"] = dict(rp["lastReplace"])
            state["memory"]["faults"] = rp["faults"]
            state["memory"]["refPtr"] = rp["refPtr"]
            state["memory"]["pageTable"] = [dict(r) for r in rp["pageTable"]]
            state["memory"]["tickAccess"] = {
                "clock": now, "pid": rp["pid"], "processName": rp["name"],
                "performed": True, "result": "fault", "page": page, "unit": unit,
            }
            push("缺页中断", "memory", "warning",
                 f"访问 [页 {page} 单元 {unit}] 缺页 —— 向磁盘队列发送读入请求，{rp['name']} 进入阻塞")


def _load_page_after_disk_io(state, req, push):
    p = next((x for x in state["processes"] if x["name"] == req["进程名"]), None)
    if not p:
        return
    page = req["page"]
    unit = req["unit"] if req.get("unit") is not None else ((page * 31 + state["clock"] * 17) % (state["config"].get("blockSize") or 128))
    algo = state["config"].get("pageAlgo") or "LRU"
    frame_count = state["memory"]["frameCount"]

    frames = state["memory"]["frames"]
    slot = frames.index(None) if None in frames else -1
    evicted = None
    wrote_back = False

    if slot >= 0:
        p["pageTable"][page]["标志"] = 1
        p["pageTable"][page]["主存块号"] = slot
        p["pageTable"][page]["loadTime"] = state["clock"]
        p["pageTable"][page]["lastUsed"] = state["clock"]
        p["pageTable"][page]["访问位"] = 1
        p["pageTable"][page]["修改位"] = page % 2
        frames[slot] = page
    else:
        if algo == "FIFO":
            min_load = INF
            chosen = 0
            for k in range(frame_count):
                _, owner_row = _find_frame_owner(state, k)
                load_time = owner_row["loadTime"] if owner_row else -1
                if load_time < min_load:
                    min_load = load_time
                    chosen = k
            slot = chosen
        elif algo == "CLOCK":
            hand = state["memory"].get("clockPtr") or 0
            found = False
            loops = 0
            while not found and loops < 100:
                _, owner_row = _find_frame_owner(state, hand)
                if not owner_row or owner_row["访问位"] == 0:
                    slot = hand
                    found = True
                else:
                    owner_row["访问位"] = 0
                    hand = (hand + 1) % frame_count
                loops += 1
            state["memory"]["clockPtr"] = (hand + 1) % frame_count
        elif algo == "OPT":
            max_next = -1
            chosen = 0
            for k in range(frame_count):
                owner_proc, owner_row = _find_frame_owner(state, k)
                if not owner_row:
                    chosen = k
                    break
                start = owner_proc["refPtr"]
                refs = owner_proc["refString"]
                next_use = INF
                for idx in range(start, len(refs)):
                    if refs[idx] == owner_row["页号"]:
                        next_use = idx - start
                        break
                if next_use > max_next:
                    max_next = next_use
                    chosen = k
            slot = chosen
        else:  # LRU
            min_used = INF
            chosen = 0
            for k in range(frame_count):
                _, owner_row = _find_frame_owner(state, k)
                last_used = owner_row["lastUsed"] if owner_row else -1
                if last_used < min_used:
                    min_used = last_used
                    chosen = k
            slot = chosen

        owner_proc, owner_row = _find_frame_owner(state, slot)
        if owner_row:
            evicted = owner_row["页号"]
            wrote_back = owner_row["修改位"] == 1
            owner_row["标志"] = 0
            owner_row["主存块号"] = None
            owner_row["访问位"] = 0
            owner_row["修改位"] = 0

        p["pageTable"][page]["标志"] = 1
        p["pageTable"][page]["主存块号"] = slot
        p["pageTable"][page]["loadTime"] = state["clock"]
        p["pageTable"][page]["lastUsed"] = state["clock"]
        p["pageTable"][page]["访问位"] = 1
        p["pageTable"][page]["修改位"] = 0
        frames[slot] = page

    p["lastReplace"] = {
        "访问页": page, "单元号": unit, "缺页": True,
        "调出页": evicted, "装入页": page, "装入块": slot, "写回": wrote_back,
        "绝对地址": slot * (state["config"].get("blockSize") or 128) + unit,
    }
    state["memory"]["pageTable"] = [dict(row) for row in p["pageTable"]]
    state["memory"]["lastReplace"] = dict(p["lastReplace"])
    state["memory"]["faults"] = p["faults"]

    detail = (f"装入物理块 {slot}" if evicted is None
              else f"调出页 {evicted}{'(已修改,写回外存)' if wrote_back else ''}，装入页 {page} → 物理块 {slot}")
    push("缺页装入", "memory", "info", f"缺页处理完成: 页 {page} 已装入 —— {detail}")


# ———————————————————————— 设备 ————————————————————————
def _record_disk_busy(state, process_name, service_time):
    d = state["disk"]
    normalized = max(1, int(service_time) if service_time else 1)
    start = max(state["clock"], d.get("busyUntil") or 0)
    end = start + normalized
    d["busyUntil"] = end
    d["busyLog"].append({"start": start, "end": end, "serviceTime": normalized, "processName": process_name})
    keep_from = state["clock"] - DISK_BUSY_WINDOW * 3
    d["busyLog"] = [seg for seg in d["busyLog"] if seg["end"] >= keep_from]


def _recompute_disk_busy_rate(state):
    d = state["disk"]
    window_end = state["clock"]
    window_start = window_end - DISK_BUSY_WINDOW
    busy_time = 0
    for seg in d["busyLog"]:
        overlap = max(0, min(seg["end"], window_end) - max(seg["start"], window_start))
        busy_time += overlap
    d["busyRate"] = min(100, _round((busy_time / DISK_BUSY_WINDOW) * 100))
    d["busyLog"] = [seg for seg in d["busyLog"] if seg["end"] >= window_start]


def _serve_disk(state, push):
    d = state["disk"]
    if not d["queue"] or d.get("activeRequest"):
        return

    chosen_idx = 0
    algo = state["config"]["diskAlgo"]
    seek = 0
    head = d["head"]
    q = d["queue"]

    if algo == "SSTF":
        min_dist = INF
        for idx, r in enumerate(q):
            dist = abs(r["柱面号"] - head)
            if dist < min_dist:
                min_dist = dist
                chosen_idx = idx
        seek = abs(q[chosen_idx]["柱面号"] - head)
    elif algo == "LOOK":
        direction = d["direction"] or 1
        best_idx = -1
        best_dist = INF
        for idx, r in enumerate(q):
            dist = r["柱面号"] - head
            if (direction > 0 and dist >= 0) or (direction < 0 and dist <= 0):
                ad = abs(dist)
                if ad < best_dist:
                    best_dist = ad
                    best_idx = idx
        if best_idx >= 0:
            chosen_idx = best_idx
        else:
            d["direction"] = -direction
            min_dist = INF
            for idx, r in enumerate(q):
                dist = abs(r["柱面号"] - head)
                if dist < min_dist:
                    min_dist = dist
                    chosen_idx = idx
        seek = abs(q[chosen_idx]["柱面号"] - head)
    elif algo == "SCAN":
        direction = d["direction"] or 1
        best_idx = -1
        best_dist = INF
        for idx, r in enumerate(q):
            dist = r["柱面号"] - head
            if (direction > 0 and dist >= 0) or (direction < 0 and dist <= 0):
                ad = abs(dist)
                if ad < best_dist:
                    best_dist = ad
                    best_idx = idx
        if best_idx >= 0:
            chosen_idx = best_idx
            seek = abs(q[chosen_idx]["柱面号"] - head)
        else:
            d["direction"] = -direction
            min_dist = INF
            for idx, r in enumerate(q):
                dist = abs(r["柱面号"] - head)
                if dist < min_dist:
                    min_dist = dist
                    chosen_idx = idx
            target = q[chosen_idx]["柱面号"]
            if direction > 0:
                seek = (d["cylinders"] - 1 - head) + (d["cylinders"] - 1 - target)
            else:
                seek = head + target
    elif algo == "C-LOOK":
        d["direction"] = 1
        best_idx = -1
        best_val = INF
        for idx, r in enumerate(q):
            if r["柱面号"] >= head and r["柱面号"] < best_val:
                best_val = r["柱面号"]
                best_idx = idx
        if best_idx >= 0:
            chosen_idx = best_idx
            seek = abs(q[chosen_idx]["柱面号"] - head)
        else:
            min_val = INF
            min_idx = 0
            for idx, r in enumerate(q):
                if r["柱面号"] < min_val:
                    min_val = r["柱面号"]
                    min_idx = idx
            chosen_idx = min_idx
            seek = head - q[chosen_idx]["柱面号"]
    elif algo == "C-SCAN":
        d["direction"] = 1
        best_idx = -1
        best_val = INF
        for idx, r in enumerate(q):
            if r["柱面号"] >= head and r["柱面号"] < best_val:
                best_val = r["柱面号"]
                best_idx = idx
        if best_idx >= 0:
            chosen_idx = best_idx
            seek = abs(q[chosen_idx]["柱面号"] - head)
        else:
            min_val = INF
            min_idx = 0
            for idx, r in enumerate(q):
                if r["柱面号"] < min_val:
                    min_val = r["柱面号"]
                    min_idx = idx
            chosen_idx = min_idx
            seek = (d["cylinders"] - 1 - head) + q[chosen_idx]["柱面号"]
    else:
        chosen_idx = 0
        seek = abs(q[chosen_idx]["柱面号"] - head)

    req = q[chosen_idx]
    service_time = max(2, _round(seek / 10) + 1)

    old_head = d["head"]
    d["head"] = req["柱面号"]
    if algo in ("C-SCAN", "C-LOOK"):
        d["direction"] = 1
    else:
        d["direction"] = 1 if req["柱面号"] >= old_head else -1
    d["path"].append(d["head"])
    if len(d["path"]) > 30:
        d["path"].pop(0)

    d["activeRequest"] = {
        **req, "seek": seek, "serviceTime": service_time,
        "startTime": state["clock"], "finishTime": state["clock"] + service_time,
    }

    _record_disk_busy(state, req["进程名"], service_time)
    push("设备调度", "device", "info",
         f"本地磁盘选中 {req['进程名']} 请求 (柱面 {req['柱面号']})，开始移动磁头，预计耗时 {service_time} 拍")


def _make_request(state):
    d = state["disk"]
    running = _running(state)
    pid = (running["pid"] if running else None) or state.get("nextPid") or 1
    t = state["clock"]
    return {
        "进程名": (running["name"] if running else None) or f"job{pid}",
        "柱面号": (pid * 37 + t * 11 + d["served"] * 5) % d["cylinders"],
        "磁道号": (pid + t + len(d["queue"])) % d["tracksPerCyl"],
        "物理记录号": (pid * 3 + t + d["currentRecord"]) % d["recordsPerTrack"],
    }


# ———————————————————————— 资源：银行家 ————————————————————————
def _local_safety(state, available, maxm, allocation):
    n = len(allocation)
    m = len(available)
    need = _calc_need(maxm, allocation)
    work = list(available)
    finish = [False] * n
    seq = []
    changed = True
    while changed:
        changed = False
        for i in range(n):
            if not finish[i] and _vec_le(need[i], work):
                for j in range(m):
                    work[j] += allocation[i][j]
                finish[i] = True
                procs = state["processes"]
                seq.append(procs[i]["name"] if (0 <= i < len(procs) and procs[i].get("name")) else f"P{i}")
                changed = True
    safe = all(finish)
    procs = state["processes"]
    deadlock = [
        (procs[i]["name"] if (0 <= i < len(procs) and procs[i].get("name")) else f"P{i}")
        for i in range(n) if not finish[i]
    ]
    return {
        "metrics": {"安全": safe, "安全序列": seq if safe else None},
        "final_state": {
            "Available": list(available), "Max": maxm, "Allocation": allocation, "Need": need,
            "安全序列": seq if safe else [], "死锁进程": deadlock,
        },
    }


def _local_banker_request(state, r, pid, req):
    need = r["need"]
    if not _vec_le(req, need[pid]):
        return {"metrics": {"可分配": False, "原因": "请求超过进程最大需求", "安全": False},
                "final_state": {"Need": need, "Available": list(r["available"])}}
    if not _vec_le(req, r["available"]):
        return {"metrics": {"可分配": False, "原因": f"资源不足，请求 {_arr(req)} > 可用 {_arr(r['available'])}，须等待", "安全": False},
                "final_state": {"Need": need, "Available": list(r["available"])}}
    new_avail = [v - req[j] for j, v in enumerate(r["available"])]
    new_alloc = [([v + req[j] for j, v in enumerate(row)] if i == pid else list(row)) for i, row in enumerate(r["allocation"])]
    safety = _local_safety(state, new_avail, r["max"], new_alloc)
    safe = safety["metrics"]["安全"]
    return {
        "metrics": {"可分配": safe, "原因": ("试探分配后系统安全，立即分配" if safe else "试探分配后进入不安全状态，拒绝本次请求"), "安全": safe},
        "final_state": {
            "Available": new_avail if safe else list(r["available"]),
            "Allocation": new_alloc if safe else r["allocation"],
            "Need": safety["final_state"]["Need"] if safe else need,
            "安全序列": safety["final_state"]["安全序列"] if safe else [],
            "死锁进程": safety["final_state"]["死锁进程"],
        },
    }


def _refresh_banker_safety(state, push, announce=True):
    r = state["resources"]
    trace = _local_safety(state, r["available"], r["max"], r["allocation"])
    safe = trace["metrics"]["安全"]
    r["safeSeq"] = _translate_names(state, trace["final_state"]["安全序列"] or [])
    r["deadlock"] = not safe
    if announce:
        if safe:
            push("安全性检查", "resource", "info", f"银行家安全性检查通过，安全序列 {','.join(r['safeSeq'])}")
        else:
            push("死锁告警", "resource", "danger",
                 f"系统不安全！死锁挂起进程 {','.join(_translate_names(state, trace['final_state']['死锁进程'] or []))}")


def _serve_banker_request(state, proc, push):
    if not proc:
        return
    r = state["resources"]
    procs = state["processes"]
    n = len(r["allocation"])
    i = next((k for k, x in enumerate(procs) if x["pid"] == proc["pid"]), -1)
    if i < 0:
        return
    phase = state["clock"] // 5

    if phase % 3 == 0:
        release_idx = _clamp_index(phase, n)
        alloc = r["allocation"][release_idx]
        owner_proc = procs[release_idx] if 0 <= release_idx < len(procs) else None
        if owner_proc and owner_proc["state"] != "完成" and owner_proc["state"] != "新建" and any(v > 0 for v in alloc):
            rel = [(1 if (v > 0 and (phase + j) % 2 == 0) else 0) for j, v in enumerate(alloc)]
            if any(v > 0 for v in rel):
                r["available"] = [v + rel[j] for j, v in enumerate(r["available"])]
                r["allocation"] = [([v - rel[j] for j, v in enumerate(row)] if ri == release_idx else row)
                                   for ri, row in enumerate(r["allocation"])]
                r["need"] = _calc_need(r["max"], r["allocation"])
                push("资源释放", "resource", "info", f"{owner_proc['name']} 释放资源 [{_arr(rel)}]，回收至可用资源池")
                _refresh_banker_safety(state, push, False)
                return

    need = r["need"][i]
    aggressive = (phase % 4 == 0)
    request = []
    for j, nd in enumerate(need):
        if nd <= 0:
            request.append(0)
        elif aggressive and j == phase % len(need):
            request.append(nd + 1)
        else:
            hi = min(nd, r["available"][j])
            request.append(1 if (hi > 0 and (phase + j) % 2 == 0) else 0)
    if all(v == 0 for v in request):
        j = next((idx for idx, nd in enumerate(need) if nd > 0 and r["available"][idx] > 0), -1)
        if j >= 0:
            request[j] = 1
    if all(v == 0 for v in request):
        return

    trace = _local_banker_request(state, r, i, request)
    fs = trace.get("final_state") or {}
    if trace["metrics"]["可分配"]:
        r["available"] = fs["Available"]
        r["allocation"] = fs["Allocation"]
        r["need"] = fs["Need"]
        r["safeSeq"] = _translate_names(state, fs.get("安全序列") or r["safeSeq"])
        r["deadlock"] = False
        push("资源分配", "resource", "info", f"{proc['name']} 申请 [{_arr(request)}] 获准，安全序列 {','.join(r['safeSeq'])}")
    else:
        push("资源请求", "resource", "warning",
             f"{proc['name']} 申请 [{_arr(request)}] 未获准：{trace['metrics'].get('原因') or '不安全 / 资源不足'}")
        r["safeSeq"] = _translate_names(state, fs.get("安全序列") or [])
        if len(fs.get("死锁进程") or []) > 0:
            r["deadlock"] = True


# ———————————————————————— 同步：PV ————————————————————————
def _pv_wake_consumer(s, state, w):
    p = next((x for x in state["processes"] if x["name"] == w), None)
    if p:
        p["state"] = "就绪"
        p["blockedReason"] = ""
        p["syncPhase"] = 1
        if state["config"]["schedAlgo"] == "RR" and p["pid"] not in state["scheduler"]["rrQueue"]:
            state["scheduler"]["rrQueue"].append(p["pid"])


def _pv_wake_producer(s, state, w):
    p = next((x for x in state["processes"] if x["name"] == w), None)
    if p:
        p["state"] = "就绪"
        p["blockedReason"] = ""
        p["syncPhase"] = 1
        if state["config"]["schedAlgo"] == "RR" and p["pid"] not in state["scheduler"]["rrQueue"]:
            state["scheduler"]["rrQueue"].append(p["pid"])


def _pv_wake_mutex(s, state, w):
    p = next((x for x in state["processes"] if x["name"] == w), None)
    if p:
        p["state"] = "就绪"
        p["blockedReason"] = ""
        p["syncPhase"] = 2
        s["lockOwner"] = p["name"]
        if state["config"]["schedAlgo"] == "RR" and p["pid"] not in state["scheduler"]["rrQueue"]:
            state["scheduler"]["rrQueue"].append(p["pid"])


def _pv_produce(s, proc, state, proc_obj, push):
    if proc_obj["syncPhase"] == 0:
        s["s1"] -= 1
        if s["s1"] < 0:
            s["prodBlocked"].append(proc)
            push("生产阻塞", "resource", "warning", f"P(s1) 缓冲区满，生产者 {proc} 挂起等待空闲槽")
            proc_obj["state"] = "阻塞"
            proc_obj["blockedReason"] = "PV同步阻塞: 等待空闲槽 (s1)"
            return
        proc_obj["syncPhase"] = 1
    if proc_obj["syncPhase"] == 1:
        s["mutex"] -= 1
        if s["mutex"] < 0:
            s["mutexBlocked"].append(proc)
            push("互斥阻塞", "resource", "warning", f"P(mutex) 临界区已被占用，生产者 {proc} 挂起等待锁")
            proc_obj["state"] = "阻塞"
            proc_obj["blockedReason"] = "PV互斥阻塞: 等待临界锁 (mutex)"
            return
        s["lockOwner"] = proc
        proc_obj["syncPhase"] = 2
    if proc_obj["syncPhase"] == 2:
        s["buffer"] += 1
        s["produced"] += 1
        push("生产写入", "resource", "info", f"生产者 {proc} 获锁进入临界区，放入产品，缓冲区占用 {s['buffer']}")
        s["mutex"] += 1
        s["lockOwner"] = None
        if s["mutex"] <= 0 and s["mutexBlocked"]:
            next_w = s["mutexBlocked"].pop(0)
            push("互斥唤醒", "resource", "info", f"V(mutex) 释放锁，唤醒互斥队列进程 {next_w}")
            _pv_wake_mutex(s, state, next_w)
        s["s2"] += 1
        if s["s2"] <= 0 and s["consBlocked"]:
            next_c = s["consBlocked"].pop(0)
            push("同步唤醒", "resource", "info", f"V(s2) 产生新产品，唤醒等待消费者 {next_c}")
            _pv_wake_consumer(s, state, next_c)
        proc_obj["syncPhase"] = 0


def _pv_consume(s, proc, state, proc_obj, push):
    if proc_obj["syncPhase"] == 0:
        s["s2"] -= 1
        if s["s2"] < 0:
            s["consBlocked"].append(proc)
            push("消费阻塞", "resource", "warning", f"P(s2) 缓冲区空，消费者 {proc} 挂起等待产品")
            proc_obj["state"] = "阻塞"
            proc_obj["blockedReason"] = "PV同步阻塞: 等待产品 (s2)"
            return
        proc_obj["syncPhase"] = 1
    if proc_obj["syncPhase"] == 1:
        s["mutex"] -= 1
        if s["mutex"] < 0:
            s["mutexBlocked"].append(proc)
            push("互斥阻塞", "resource", "warning", f"P(mutex) 临界区已被占用，消费者 {proc} 挂起等待锁")
            proc_obj["state"] = "阻塞"
            proc_obj["blockedReason"] = "PV互斥阻塞: 等待临界锁 (mutex)"
            return
        s["lockOwner"] = proc
        proc_obj["syncPhase"] = 2
    if proc_obj["syncPhase"] == 2:
        s["buffer"] -= 1
        s["consumed"] += 1
        push("消费取出", "resource", "info", f"消费者 {proc} 获锁进入临界区，取出产品，缓冲区占用 {s['buffer']}")
        s["mutex"] += 1
        s["lockOwner"] = None
        if s["mutex"] <= 0 and s["mutexBlocked"]:
            next_w = s["mutexBlocked"].pop(0)
            push("互斥唤醒", "resource", "info", f"V(mutex) 释放锁，唤醒互斥队列进程 {next_w}")
            _pv_wake_mutex(s, state, next_w)
        s["s1"] += 1
        if s["s1"] <= 0 and s["prodBlocked"]:
            next_p = s["prodBlocked"].pop(0)
            push("同步唤醒", "resource", "info", f"V(s1) 释放空闲槽，唤醒等待生产者 {next_p}")
            _pv_wake_producer(s, state, next_p)
        proc_obj["syncPhase"] = 0


def _is_producer(proc):
    if not proc:
        return False
    name = proc["name"].lower()
    return "logger" in name or "daemon" in name or "producer" in name


def _is_consumer(proc):
    if not proc:
        return False
    name = proc["name"].lower()
    return "shell" in name or "consumer" in name


# ———————————————————————— 到达 + 指标 ————————————————————————
def _add_deterministic_arrival(state, t, rng, push):
    pid = state["nextPid"]
    state["nextPid"] += 1
    name = f"{JOB_NAMES[_clamp_index(pid, len(JOB_NAMES))]}{pid}"
    ref_string = list(state["memory"]["refString"])
    max_page = max(ref_string)
    page_table = []
    for pg in range(max_page + 1):
        page_table.append({
            "页号": pg, "标志": 0, "主存块号": None, "访问位": 0, "修改位": 0,
            "外存地址": "0" + str(11 + pg).rjust(2, "0"), "loadTime": -1, "lastUsed": -1,
        })
    state["processes"].append({
        "pid": pid, "name": name, "state": "就绪", "arrival": t,
        "burst": 4 + ((pid + t) % 7), "ran": 0, "priority": 1 + ((pid + t) % 4),
        "blockedReason": "", "pageWaitingFor": None, "blockedAt": None,
        "refString": ref_string, "refPtr": 0, "hits": 0, "faults": 0,
        "pageTable": page_table,
        "lastReplace": {"访问页": None, "缺页": False, "调出页": None, "装入页": None, "装入块": None, "写回": False},
    })
    state["resources"]["max"].append([rng.randint(1, 4), rng.randint(1, 4), rng.randint(1, 3)])
    state["resources"]["allocation"].append([0, 0, 0])
    new_idx = len(state["resources"]["max"]) - 1
    state["resources"]["need"].append(
        [state["resources"]["max"][new_idx][j] - state["resources"]["allocation"][new_idx][j] for j in range(3)]
    )
    push("作业到达", "processor", "info", f"新作业 {name} 到达并加入就绪队列")


def _recompute_runtime_metrics(state):
    used = len([x for x in state["memory"]["frames"] if x is not None])
    refs = state["memory"]["faults"] + state["memory"]["hits"]
    busy = sum(max(0, seg["结束"] - seg["开始"]) for seg in state["gantt"])
    completed = [p for p in state["processes"] if p["state"] == "完成"]
    _recompute_disk_busy_rate(state)

    state["metrics"]["cpuUtil"] = _round((busy / state["clock"]) * 100) if state["clock"] else 0
    state["metrics"]["memUtil"] = _round((used / max(1, state["memory"]["capacity"])) * 100)
    state["metrics"]["diskQueueLen"] = len(state["disk"]["queue"])
    state["metrics"]["faultRate"] = _round((state["memory"]["faults"] / refs) * 100) if refs else 0
    state["metrics"]["readyLen"] = len([p for p in state["processes"] if p["state"] == "就绪"])
    state["metrics"]["blockedLen"] = len([p for p in state["processes"] if p["state"] == "阻塞"])
    state["metrics"]["completed"] = len(completed)
    state["metrics"]["throughput"] = _fix2(len(completed) / max(1, state["clock"]))


# ———————————————————————— 主整拍 ————————————————————————
def tick(state, rng=None):
    """推进一拍：返回 (state, events)。state 原地推进并返回（与 JS localTick 一致）。"""
    events = []
    rng = Mulberry32(state["rngState"])

    def push(typ, core, level, desc):
        events.append({"type": typ, "core": core, "level": level, "desc": desc})

    state["clock"] += 1
    t = state["clock"]

    if t == 1:
        _seed_scheduler(state)

    if state["config"].get("processAutoArrival") and t % 7 == 0:
        _add_deterministic_arrival(state, t, rng, push)

    disk = state["disk"]
    if disk.get("activeRequest"):
        if t >= disk["activeRequest"]["finishTime"]:
            req = disk["activeRequest"]
            g_idx = next((k for k, r in enumerate(disk["queue"]) if r["进程名"] == req["进程名"] and r["柱面号"] == req["柱面号"]), -1)
            if g_idx >= 0:
                disk["queue"].pop(g_idx)
            if req.get("isPageFault"):
                _load_page_after_disk_io(state, req, push)
            disk["served"] += 1
            disk["servedLog"].insert(0, {**req, "寻道": req["seek"], "服务时间": req["serviceTime"], "ts": t})
            if len(disk["servedLog"]) > 8:
                disk["servedLog"].pop()
            push("设备完成", "device", "info", f"{req['进程名']} I/O 服务完成 (柱面 {req['柱面号']})")
            disk["activeRequest"] = None

    if not disk.get("activeRequest") and len(disk["queue"]) > 0:
        _serve_disk(state, push)

    running = _apply_cpu(state, push)

    # 访存是本拍指令提交前的检查。缺页时指令尚未完成，不能增加 ran 或甘特图执行时间。
    if running and running["state"] == "运行" and running["ran"] < running["burst"]:
        state["memory"]["tickAccess"] = {
            "clock": t, "pid": running["pid"], "processName": running["name"],
            "performed": False, "result": "none", "page": None, "unit": None,
        }
        if rng.next() < 0.4:
            _apply_memory_step(state, push)
        else:
            push("未访存", "memory", "info", f"{running['name']} 本拍未进行访存（40% 概率未触发）")
    else:
        state["memory"]["tickAccess"] = {
            "clock": t, "pid": None, "processName": None,
            "performed": False, "result": "idle", "page": None, "unit": None,
        }

    if running and running["state"] == "运行":
        if running["ran"] < running["burst"]:
            running["ran"] = min(running["burst"], running["ran"] + 1)
            gantt = state["gantt"]
            last = gantt[-1] if gantt else None
            if last and last["作业"] == running["name"] and last["结束"] == t - 1:
                last["结束"] = t
            else:
                gantt.append({"作业": running["name"], "开始": t - 1, "结束": t})
            if running["ran"] >= running["burst"]:
                running["finishTime"] = t
    else:
        gantt = state["gantt"]
        last = gantt[-1] if gantt else None
        if last and last["作业"] == "空闲" and last["结束"] == t - 1:
            last["结束"] = t
        else:
            gantt.append({"作业": "空闲", "开始": t - 1, "结束": t})

    if running and running["state"] == "运行" and running["ran"] < running["burst"] and t % 6 == 0:
        _on_cpu_disk_request(state, running, rng, push)
    if running and running["state"] == "运行" and running["ran"] < running["burst"] and t % 5 == 0:
        _serve_banker_request(state, running, push)
    if running and running["state"] == "运行" and running["ran"] < running["burst"] and t % 3 == 0:
        if _is_producer(running):
            _pv_produce(state["sync"], running["name"], state, running, push)
        elif _is_consumer(running):
            _pv_consume(state["sync"], running["name"], state, running, push)

    _recompute_runtime_metrics(state)

    state["rngState"] = rng.state & 0xFFFFFFFF
    return state, events
