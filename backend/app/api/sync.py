from fastapi import APIRouter

from app.engines import sync_engine
from app.schemas.common import SimulationTrace
from app.schemas.sync import SyncRequest

router = APIRouter(prefix="/api/sync", tags=["进程同步·PV"])


@router.post("/run", response_model=SimulationTrace)
def run(body: SyncRequest):
    return sync_engine.run([op.model_dump() for op in body.operations], body.buffer_size)
