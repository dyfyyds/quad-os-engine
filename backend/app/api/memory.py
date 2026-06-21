from fastapi import APIRouter, HTTPException

from app.engines.memory_engine import MemoryEngine
from app.schemas.memory import (
    MemoryAccessRequest,
    MemoryAccessResponse,
    MemoryStateSchema,
)

router = APIRouter(prefix="/api/memory", tags=["运行时内存引擎"])


@router.post("/access", response_model=MemoryAccessResponse)
def access(body: MemoryAccessRequest):
    try:
        engine = MemoryEngine(
            frames=body.state.frames,
            page_tables=body.state.page_tables,
            clock_ptr=body.state.clock_ptr,
            process_refs=body.state.process_refs,
            process_ptrs=body.state.process_ptrs,
        )
        hit, evicted, wrote_back, slot = engine.access_page(
            pid=body.pid,
            page=body.page,
            is_write=body.is_write,
            current_time=body.current_time,
            algorithm=body.algorithm,
        )
        
        updated_state = MemoryStateSchema(
            frames=engine.frames,
            page_tables=engine.page_tables,
            clock_ptr=engine.clock_ptr,
            process_refs=engine.process_refs,
            process_ptrs=engine.process_ptrs,
        )
        
        return MemoryAccessResponse(
            hit=hit,
            evicted_page=evicted,
            wrote_back=wrote_back,
            slot=slot,
            state=updated_state,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/load", response_model=MemoryAccessResponse)
def load(body: MemoryAccessRequest):
    """装载页面（I/O 完成后放入内存）。"""
    return access(body)
