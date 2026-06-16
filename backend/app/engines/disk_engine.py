"""磁盘调度引擎 — 移臂调度 + 旋转调度。

移臂算法：FCFS / SSTF / SCAN / C-SCAN / LOOK / C-LOOK / F-SCAN / N-SCAN
旋转算法：FCFS / SSTF (最短旋转距离)

磁盘几何：
- 柱面 (cylinder): 移臂调度的维度（磁头沿半径方向移动）
- 磁道 (track): 每柱面的磁道数（对应多个盘面/磁头）
- 扇区/记录 (sector/record): 每磁道的物理记录数

约定：
- I/O 请求包含：进程名、柱面号、磁道号、物理记录号
- 总服务时间 = 寻道时间 + 旋转延迟 + 传输时间
- 寻道 = |目标柱面 - 当前柱面|
- 旋转 = 沿磁道旋转到目标记录的距离（圆周最短路径）
"""
from __future__ import annotations

import math
from dataclasses import dataclass

from app.schemas.common import SimulationStep, SimulationTrace

# ---------------------------------------------------------------------------
# 移臂算法列表
# ---------------------------------------------------------------------------
SEEK_ALGORITHMS = ["FCFS", "SSTF", "SCAN", "C-SCAN", "LOOK", "C-LOOK", "F-SCAN", "N-SCAN"]

# ---------------------------------------------------------------------------
# 磁盘几何参数
# ---------------------------------------------------------------------------
@dataclass
class DiskGeometry:
    """磁盘物理几何参数。"""
    cylinders: int = 200           # 柱面总数
    tracks_per_cylinder: int = 4   # 每柱面磁道数（盘面数）
    records_per_track: int = 8     # 每磁道记录数（扇区数）
    seek_per_cylinder: float = 1.0 # 每柱面寻道时间单位
    rotation_per_rev: float = 8.0  # 一圈旋转时间单位
    transfer_per_record: float = 0.5  # 每记录传输时间单位

    @property
    def max_cylinder(self) -> int:
        return self.cylinders - 1

    @property
    def max_track(self) -> int:
        return self.tracks_per_cylinder - 1

    @property
    def max_record(self) -> int:
        return self.records_per_track - 1

    @property
    def rotation_per_record(self) -> float:
        """每记录旋转时间（旋转一圈/每磁道记录数）。"""
        return self.rotation_per_rev / max(1, self.records_per_track)


# ---------------------------------------------------------------------------
# I/O 请求
# ---------------------------------------------------------------------------
@dataclass
class IORequest:
    """一条 I/O 请求。"""
    process_name: str
    cylinder: int
    track: int = 0
    record: int = 0
    arrival_time: int = 0


def _rotation_distance(current_record: int, target_record: int, total_records: int) -> int:
    """计算两个记录之间的最短旋转距离（圆周）。"""
    if total_records <= 0:
        return 0
    diff = abs(target_record - current_record) % total_records
    return min(diff, total_records - diff)


# ---------------------------------------------------------------------------
# 移臂调度 — waypoints（含端点折返/返回虚拟点）
# ---------------------------------------------------------------------------
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
    upper = [r for r in uniq if r >= head]
    lower = [r for r in uniq if r < head]
    wps: list[tuple[int, bool]] = []

    if direction == "up":
        if algo in ("SCAN", "F-SCAN"):
            wps += [(r, True) for r in upper]
            if lower:
                if not upper or upper[-1] != max_track:
                    wps.append((max_track, False))
                wps += [(r, True) for r in reversed(lower)]
        elif algo in ("LOOK", "N-SCAN"):
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
        if algo in ("SCAN", "F-SCAN"):
            wps += [(r, True) for r in reversed(lower)]
            if upper:
                if not lower or lower[0] != min_track:
                    wps.append((min_track, False))
                wps += [(r, True) for r in upper]
        elif algo in ("LOOK", "N-SCAN"):
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


def _seek_order(algorithm: str, requests: list[IORequest], head: int,
                disk_size: int, direction: str, geometry: DiskGeometry | None = None) -> list[int]:
    """返回请求的服务顺序（索引列表），用于 simulate 等高级接口。"""
    algo = algorithm.upper()
    n = len(requests)
    indices = list(range(n))

    if algo == "FCFS":
        return indices

    if algo == "SSTF":
        order = []
        remaining = list(indices)
        pos = head
        while remaining:
            best = min(remaining, key=lambda i: abs(requests[i].cylinder - pos))
            order.append(best)
            remaining.remove(best)
            pos = requests[best].cylinder
        return order

    # SCAN 系列：用柱面值走 waypoints，然后提取请求点的原始索引
    cylinders = [r.cylinder for r in requests]
    wps = _waypoints(algo, cylinders, head, disk_size, direction)
    order = []
    for track, is_req in wps:
        if is_req:
            # 找到对应的原始索引（第一个匹配且未用过的）
            for i in range(n):
                if requests[i].cylinder == track and i not in order:
                    order.append(i)
                    break
    return order


# ---------------------------------------------------------------------------
# 主运行函数 — 纯移臂调度（兼容原有接口，含端点折返计算）
# ---------------------------------------------------------------------------
def run(algorithm: str, requests: list[int], head: int,
        disk_size: int = 200, direction: str = "up") -> SimulationTrace:
    """纯移臂调度（兼容旧接口，输入为柱面号列表）。

    使用 waypoints 方式计算寻道距离，含 SCAN/C-SCAN 的端点折返移动。
    """
    algo = algorithm.upper()
    if algo not in SEEK_ALGORITHMS:
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


# ---------------------------------------------------------------------------
# 高级运行 — 完整 I/O 模拟（移臂 + 旋转 + 传输）
# ---------------------------------------------------------------------------
def simulate(
    algorithm: str,
    io_requests: list[dict],
    head: int,
    current_record: int = 0,
    geometry: dict | None = None,
    direction: str = "up",
) -> SimulationTrace:
    """完整 I/O 模拟：移臂调度 + 旋转定位 + 传输。

    Parameters
    ----------
    algorithm : str
        移臂算法名
    io_requests : list[dict]
        每项: {进程名, 柱面号, 磁道号, 物理记录号}
    head : int
        当前磁头所在柱面
    current_record : int
        当前磁头所在物理记录（旋转位置）
    geometry : dict
        磁盘几何 {cylinders, tracks_per_cylinder, records_per_track, ...}
    direction : str
        初始方向 "up"/"down"
    """
    algo = algorithm.upper()
    if algo not in SEEK_ALGORITHMS:
        raise ValueError(f"未知磁盘调度算法: {algorithm}")

    # 解析几何参数
    g = DiskGeometry(**(geometry or {}))

    # 构造 IORequest
    io_reqs = []
    for r in io_requests:
        io_reqs.append(IORequest(
            process_name=r.get("进程名", "unknown"),
            cylinder=max(0, min(g.max_cylinder, r.get("柱面号", 0))),
            track=max(0, min(g.max_track, r.get("磁道号", 0))),
            record=max(0, min(g.max_record, r.get("物理记录号", 0))),
        ))

    order = _seek_order(algo, io_reqs, head, g.cylinders, direction)

    steps: list[SimulationStep] = []
    served_names: list[str] = []
    pending_names = [r.process_name for r in io_reqs]
    total_seek = 0
    total_rotation = 0
    total_transfer = 0
    pos = head
    cur_rec = current_record
    track_path = [head]

    for step_idx, req_idx in enumerate(order):
        req = io_reqs[req_idx]
        seek = abs(req.cylinder - pos)
        rotation = _rotation_distance(cur_rec, req.record, g.records_per_track)
        transfer = 1  # 每次传输 1 个记录

        seek_time = seek * g.seek_per_cylinder
        rotation_time = rotation * g.rotation_per_record
        transfer_time = transfer * g.transfer_per_record
        service_time = seek_time + rotation_time + transfer_time

        total_seek += seek
        total_rotation += rotation
        total_transfer += transfer
        track_path.append(req.cylinder)

        if req.process_name in pending_names:
            pending_names.remove(req.process_name)
        served_names.append(req.process_name)

        desc = (
            f"{req.process_name}: 移臂 {pos}→{req.cylinder}(寻道{seek}) "
            f"+ 旋转至记录{req.record}(旋转{rotation}) "
            f"+ 传输(1) = 服务时间 {round(service_time, 1)}"
        )
        steps.append(
            SimulationStep(
                index=step_idx,
                description=desc,
                state={
                    "进程名": req.process_name,
                    "目标柱面": req.cylinder,
                    "目标磁道": req.track,
                    "目标记录": req.record,
                    "寻道距离": seek,
                    "旋转距离": rotation,
                    "寻道时间": round(seek_time, 1),
                    "旋转时间": round(rotation_time, 1),
                    "传输时间": round(transfer_time, 1),
                    "服务时间": round(service_time, 1),
                    "累计寻道": total_seek,
                    "累计旋转": total_rotation,
                    "已服务": served_names.copy(),
                    "待服务": pending_names.copy(),
                },
                highlight={
                    "from": pos,
                    "to": req.cylinder,
                    "seek": seek,
                    "rotation": rotation,
                    "served": True,
                },
            )
        )
        pos = req.cylinder
        cur_rec = req.record

    count = len(io_reqs)
    total_service_time = sum(s.state["服务时间"] for s in steps)
    metrics = {
        "总寻道道数": total_seek,
        "总旋转次数": total_rotation,
        "总传输记录": total_transfer,
        "平均寻道长度": round(total_seek / count, 2) if count else 0,
        "平均服务时间": round(total_service_time / count, 2) if count else 0,
        "请求总数": count,
        "起始柱面": head,
        "起始记录": current_record,
    }
    final_state = {
        "服务顺序": served_names,
        "磁头轨迹": track_path,
        "总寻道道数": total_seek,
        "总旋转次数": total_rotation,
    }
    return SimulationTrace(
        module="disk",
        algorithm=algo,
        input_echo={
            "io_requests": io_requests,
            "head": head,
            "current_record": current_record,
            "geometry": geometry or {},
            "direction": direction,
        },
        steps=steps,
        metrics=metrics,
        final_state=final_state,
    )


# ---------------------------------------------------------------------------
# 多算法基准对比
# ---------------------------------------------------------------------------
def benchmark(
    io_requests: list[dict],
    head: int,
    current_record: int = 0,
    geometry: dict | None = None,
    direction: str = "up",
    algorithms: list[str] | None = None,
) -> dict:
    """对多组算法运行 simulate 并返回对比指标。"""
    algos = algorithms or SEEK_ALGORITHMS
    results = {}
    for algo in algos:
        try:
            trace = simulate(algo, io_requests, head, current_record, geometry, direction)
            results[algo] = {
                "总寻道道数": trace.metrics["总寻道道数"],
                "平均寻道长度": trace.metrics["平均寻道长度"],
                "平均服务时间": trace.metrics["平均服务时间"],
                "总旋转次数": trace.metrics["总旋转次数"],
            }
        except Exception as e:
            results[algo] = {"error": str(e)}
    return results
