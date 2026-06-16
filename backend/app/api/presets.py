from fastapi import APIRouter, HTTPException

from app.presets import PRESETS

router = APIRouter(prefix="/api/presets", tags=["教材预设"])


@router.get("")
def list_all():
    return PRESETS


@router.get("/{module}")
def list_module(module: str):
    if module not in PRESETS:
        raise HTTPException(status_code=404, detail=f"无该模块预设: {module}")
    return {"module": module, "presets": PRESETS[module]}
