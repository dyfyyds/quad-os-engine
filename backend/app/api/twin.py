from fastapi import APIRouter, HTTPException

from app.engines import twin_engine
from app.schemas.twin import TwinTickRequest, TwinTickResponse

router = APIRouter(prefix="/api/twin", tags=["数字孪生整拍"])


@router.post("/tick", response_model=TwinTickResponse)
def tick(body: TwinTickRequest):
    try:
        state, events = twin_engine.tick(body.state.model_dump())
        return TwinTickResponse(state=state, events=events)
    except (KeyError, ValueError, IndexError) as e:
        raise HTTPException(status_code=400, detail=f"整拍推进失败: {e}")
