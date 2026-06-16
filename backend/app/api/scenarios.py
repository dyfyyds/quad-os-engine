from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.mysql import get_db
from app.services import scenario_service

router = APIRouter(prefix="/api/scenarios", tags=["场景库"])


class ScenarioIn(BaseModel):
    module: str
    name: str
    description: str = ""
    input: dict


@router.get("")
async def list_scenarios(module: str | None = None, db: AsyncSession = Depends(get_db)):
    return await scenario_service.list_scenarios(db, module)


@router.post("")
async def create_scenario(body: ScenarioIn, db: AsyncSession = Depends(get_db)):
    return await scenario_service.create_scenario(
        db, body.module, body.name, body.description, body.input
    )


@router.delete("/{sid}")
async def delete_scenario(sid: int, db: AsyncSession = Depends(get_db)):
    if not await scenario_service.delete_scenario(db, sid):
        raise HTTPException(status_code=404, detail="场景不存在")
    return {"deleted": sid}
