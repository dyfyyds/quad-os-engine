from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.mysql import get_db
from app.services import config_service

router = APIRouter(prefix="/api/config", tags=["配置持久化"])


class ConfigIn(BaseModel):
    key: str = "current"
    config: dict


@router.get("")
async def get_config(key: str = "current", db: AsyncSession = Depends(get_db)):
    cfg = await config_service.get_config(db, key)
    if cfg is None:
        raise HTTPException(status_code=404, detail="无保存配置")
    return cfg


@router.put("")
async def put_config(body: ConfigIn, db: AsyncSession = Depends(get_db)):
    return await config_service.upsert_config(db, body.key, body.config)
