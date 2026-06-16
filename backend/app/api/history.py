from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.mysql import get_db
from app.services import history_service

router = APIRouter(prefix="/api/history", tags=["运行历史"])


class HistoryIn(BaseModel):
    module: str
    algorithm: str
    input: dict
    metrics: dict


@router.get("")
async def list_history(module: str | None = None, limit: int = 50,
                       db: AsyncSession = Depends(get_db)):
    return await history_service.list_history(db, module, limit)


@router.post("")
async def record(body: HistoryIn, db: AsyncSession = Depends(get_db)):
    return await history_service.record(db, body.module, body.algorithm, body.input, body.metrics)
