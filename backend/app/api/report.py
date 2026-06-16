from fastapi import APIRouter

from app.schemas.common import SimulationTrace
from app.services import report_service

router = APIRouter(prefix="/api/report", tags=["实验报告"])


@router.post("/markdown")
def markdown(trace: SimulationTrace):
    content = report_service.to_markdown(trace)
    filename = f"实验报告-{report_service.MODULE_NAMES.get(trace.module, trace.module)}-{trace.algorithm}.md"
    return {"filename": filename, "content": content}
