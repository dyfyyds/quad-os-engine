from fastapi import APIRouter, HTTPException

from app.engines import disk_engine
from app.schemas.common import SimulationTrace
from app.schemas.disk import DiskRequest

router = APIRouter(prefix="/api/disk", tags=["磁盘调度"])

ALGORITHMS = disk_engine.ALGORITHMS


@router.get("/algorithms")
def algorithms():
    return {"algorithms": ALGORITHMS}


@router.post("/run", response_model=SimulationTrace)
def run(body: DiskRequest):
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
