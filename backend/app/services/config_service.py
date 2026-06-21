from __future__ import annotations

import json

from app.models.app_config import AppConfig


def _to_dict(r: AppConfig) -> dict:
    return {
        "key": r.key,
        "config": json.loads(r.value_json),
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


async def get_config(db, key: str = "current") -> dict | None:
    obj = await db.get(AppConfig, key)
    return _to_dict(obj) if obj else None


async def upsert_config(db, key: str, data: dict) -> dict:
    obj = await db.get(AppConfig, key)
    value = json.dumps(data, ensure_ascii=False)
    if obj:
        obj.value_json = value
    else:
        obj = AppConfig(key=key, value_json=value)
        db.add(obj)
    await db.commit()
    await db.refresh(obj)
    return _to_dict(obj)
