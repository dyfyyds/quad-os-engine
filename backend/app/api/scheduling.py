from fastapi import APIRouter, HTTPException

from app.engines import scheduling_engine
from app.schemas.common import SimulationTrace
from app.schemas.scheduling import SchedulingRequest

router = APIRouter(prefix="/api/scheduling", tags=["作业调度"])

ALGORITHMS = scheduling_engine.ALGORITHMS


@router.get("/algorithms")
def algorithms():
    return {"algorithms": ALGORITHMS}


@router.post("/run", response_model=SimulationTrace)
def run(body: SchedulingRequest):
    try:
        return scheduling_engine.run(
            algorithm=body.algorithm,
            jobs=[j.model_dump() for j in body.jobs],
            time_quantum=body.time_quantum,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
