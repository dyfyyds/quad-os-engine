from fastapi import APIRouter

from app.engines import banker_engine
from app.schemas.banker import ResourceRequest, SafetyRequest
from app.schemas.common import SimulationTrace

router = APIRouter(prefix="/api/banker", tags=["资源分配·银行家"])


@router.post("/safety", response_model=SimulationTrace)
def safety(body: SafetyRequest):
    return banker_engine.check_safety(body.available, body.max, body.allocation)


@router.post("/request", response_model=SimulationTrace)
def request(body: ResourceRequest):
    return banker_engine.request(
        body.available, body.max, body.allocation,
        body.pid, body.request, use_banker=body.use_banker,
    )
