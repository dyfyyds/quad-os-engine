from fastapi import APIRouter, HTTPException

from app.engines import process_engine
from app.engines.process_engine import ProcessEngine
from app.schemas.common import SimulationTrace
from app.schemas.process import (
    PCB,
    ProcessRunRequest,
    ProcessTickRequest,
    ProcessTickResponse,
)

router = APIRouter(prefix="/api/process", tags=["进程状态机"])


@router.get("/algorithms")
def algorithms():
    return {"algorithms": process_engine.ALGORITHMS}


@router.post("/tick", response_model=ProcessTickResponse)
def tick(body: ProcessTickRequest):
    """推进一个时钟周期，返回更新后的进程状态。

    客户端每次调用发送当前全部进程状态，后端计算下一步并返回新状态。
    保持后端无状态，适合前端 tick 驱动模式。
    """
    try:
        engine = ProcessEngine(
            processes=[p.model_dump() for p in body.processes],
            algorithm=body.algorithm,
            time_quantum=body.time_quantum or 2,
        )
        new_arrivals = (
            [a.model_dump() for a in body.new_arrivals]
            if body.new_arrivals
            else None
        )
        engine.tick(new_arrivals=new_arrivals, force_io=body.force_io)
        return engine.build_tick_response()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/run", response_model=SimulationTrace)
def run(body: ProcessRunRequest):
    """一次性运行所有进程到完成，返回完整 SimulationTrace。"""
    try:
        return process_engine.run(
            processes=[p.model_dump() for p in body.processes],
            algorithm=body.algorithm,
            time_quantum=body.time_quantum or 2,
            max_ticks=body.max_ticks or 200,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
