from fastapi import APIRouter, HTTPException

from app.engines import paging_engine
from app.schemas.common import SimulationTrace
from app.schemas.paging import PagingRequest, TranslateRequest

router = APIRouter(prefix="/api/paging", tags=["页面置换"])

ALGORITHMS = paging_engine.ALGORITHMS


@router.get("/algorithms")
def algorithms():
    return {"algorithms": ALGORITHMS}


@router.post("/run", response_model=SimulationTrace)
def run(body: PagingRequest):
    try:
        return paging_engine.run(body.algorithm, body.reference_string, body.frames)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/translate", response_model=SimulationTrace)
def translate(body: TranslateRequest):
    return paging_engine.translate(body.page_table, body.instructions, body.block_size)
