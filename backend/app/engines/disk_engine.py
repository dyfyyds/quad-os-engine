"""磁盘调度（移臂调度）引擎。

实现 FCFS / SSTF / SCAN / C-SCAN / LOOK / C-LOOK 六种算法。

约定：
- 磁道范围 [0, disk_size-1]，初始方向 direction ∈ {"up", "down"}。
- SCAN  到达磁盘物理端点后折返；LOOK 到达最远请求后折返。
- C-SCAN / C-LOOK 单向服务，到头后快速返回另一端继续。
- 总寻道道数 = 磁头实际移动距离之和（含折返 / 返回移动）。
"""
from __future__ import annotations

from app.schemas.common import SimulationStep, SimulationTrace

ALGORITHMS = ["FCFS", "SSTF", "SCAN", "C-SCAN", "LOOK", "C-LOOK"]


def _waypoints(algorithm, requests, head, disk_size, direction):
    """返回磁头依次到达的点 [(position, is_request), ...]（不含起始磁头）。

    is_request=False 表示该点是端点折返 / 返回移动，不对应任何请求。
    """
    algo = algorithm.upper()
    max_track = disk_size - 1
    min_track = 0

    if algo == "FCFS":
        return [(r, True) for r in requests]

    if algo == "SSTF":
        wps = []
        remaining = list(requests)
        pos = head
        while remaining:
            nxt = min(remaining, key=lambda r: (abs(r - pos), r))
            wps.append((nxt, True))
            remaining.remove(nxt)
            pos = nxt
        return wps

    uniq = sorted(set(requests))
    upper = [r for r in uniq if r >= head]   # 含等于 head
    lower = [r for r in uniq if r < head]
    wps: list[tuple[int, bool]] = []

    if direction == "up":
        if algo == "SCAN":
            wps += [(r, True) for r in upper]
            if lower:
                if not upper or upper[-1] != max_track:
                    wps.append((max_track, False))
                wps += [(r, True) for r in reversed(lower)]
        elif algo == "LOOK":
            wps += [(r, True) for r in upper]
            wps += [(r, True) for r in reversed(lower)]
        elif algo == "C-SCAN":
            wps += [(r, True) for r in upper]
            if lower:
                if not upper or upper[-1] != max_track:
                    wps.append((max_track, False))
                if lower[0] != min_track:
                    wps.append((min_track, False))
                wps += [(r, True) for r in lower]
        elif algo == "C-LOOK":
            wps += [(r, True) for r in upper]
            wps += [(r, True) for r in lower]
    else:  # direction == "down"
        if algo == "SCAN":
            wps += [(r, True) for r in reversed(lower)]
            if upper:
                if not lower or lower[0] != min_track:
                    wps.append((min_track, False))
                wps += [(r, True) for r in upper]
        elif algo == "LOOK":
            wps += [(r, True) for r in reversed(lower)]
            wps += [(r, True) for r in upper]
        elif algo == "C-SCAN":
            wps += [(r, True) for r in reversed(lower)]
            if upper:
                if not lower or lower[0] != min_track:
                    wps.append((min_track, False))
                if upper[-1] != max_track:
                    wps.append((max_track, False))
                wps += [(r, True) for r in reversed(upper)]
        elif algo == "C-LOOK":
            wps += [(r, True) for r in reversed(lower)]
            if upper:
                wps += [(r, True) for r in reversed(upper)]

    return wps


def run(algorithm, requests, head, disk_size=200, direction="up"):
    algo = algorithm.upper()
    if algo not in ALGORITHMS:
        raise ValueError(f"未知磁盘调度算法: {algorithm}")

    wps = _waypoints(algo, requests, head, disk_size, direction)

    steps: list[SimulationStep] = []
    served: list[int] = []
    pending = list(requests)
    total = 0
    pos = head
    track_path = [head]

    for idx, (track, is_req) in enumerate(wps):
        move = abs(track - pos)
        total += move
        track_path.append(track)
        if is_req:
            served.append(track)
            if track in pending:
                pending.remove(track)
            desc = f"磁头 {pos} → {track}，移动 {move} 道，服务请求 {track}"
        elif track in (0, disk_size - 1):
            desc = f"磁头 {pos} → {track}，移动 {move} 道（到达磁盘端点，准备折返/返回）"
        else:
            desc = f"磁头 {pos} → {track}，移动 {move} 道"
        steps.append(
            SimulationStep(
                index=idx,
                description=desc,
                state={
                    "当前磁头": track,
                    "本次移动": move,
                    "累计寻道": total,
                    "已服务": served.copy(),
                    "待服务": pending.copy(),
                    "是否服务请求": is_req,
                },
                highlight={"from": pos, "to": track, "move": move, "served": is_req},
            )
        )
        pos = track

    count = len(requests)
    metrics = {
        "总寻道道数": total,
        "平均寻道长度": round(total / count, 2) if count else 0,
        "请求总数": count,
        "起始磁头": head,
    }
    final_state = {
        "服务顺序": served,
        "磁头轨迹": track_path,
        "总寻道道数": total,
    }
    return SimulationTrace(
        module="disk",
        algorithm=algo,
        input_echo={
            "requests": list(requests),
            "head": head,
            "disk_size": disk_size,
            "direction": direction,
        },
        steps=steps,
        metrics=metrics,
        final_state=final_state,
    )
