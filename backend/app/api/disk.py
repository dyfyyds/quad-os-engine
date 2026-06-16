"""磁盘调度 API — 移臂调度 + 旋转调度 + 基准对比。"""
from fastapi import APIRouter, HTTPException

from app.engines import disk_engine
from app.schemas.common import SimulationTrace
from app.schemas.disk import (
    DiskBenchmarkRequest,
    DiskRequest,
    DiskSimulateRequest,
)

router = APIRouter(prefix="/api/disk", tags=["磁盘调度"])

SEEK_ALGORITHMS = disk_engine.SEEK_ALGORITHMS


@router.get("/algorithms")
def algorithms():
    """返回支持的移臂调度算法列表。"""
    return {"algorithms": SEEK_ALGORITHMS}


@router.post("/run", response_model=SimulationTrace)
def run(body: DiskRequest):
    """纯移臂调度（兼容旧接口，输入柱面号列表）。"""
    try:
        return disk_engine.run(
            algorithm=body.algorithm,
            requests=body.requests,
            head=body.head,
            disk_size=body.disk_size,
            direction=body.direction,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/simulate", response_model=SimulationTrace)
def simulate(body: DiskSimulateRequest):
    """完整 I/O 模拟：移臂调度 + 旋转定位 + 传输。

    请求体包含完整的 I/O 请求（进程名/柱面号/磁道号/物理记录号）
    和磁盘几何参数，返回详细的分步服务轨迹。
    """
    try:
        io_reqs = [r.model_dump() for r in body.io_requests]
        return disk_engine.simulate(
            algorithm=body.algorithm,
            io_requests=io_reqs,
            head=body.head,
            current_record=body.current_record,
            geometry=body.geometry.model_dump(),
            direction=body.direction,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/benchmark")
def benchmark(body: DiskBenchmarkRequest):
    """多算法基准对比 — 对同一请求队列运行多种算法并返回对比指标。"""
    try:
        io_reqs = [r.model_dump() for r in body.io_requests]
        return disk_engine.benchmark(
            io_requests=io_reqs,
            head=body.head,
            current_record=body.current_record,
            geometry=body.geometry.model_dump(),
            direction=body.direction,
            algorithms=body.algorithms,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
