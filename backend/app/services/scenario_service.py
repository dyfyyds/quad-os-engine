from __future__ import annotations

import json

from sqlalchemy import select

from app.models.scenario import Scenario


def _to_dict(r: Scenario) -> dict:
    return {
        "id": r.id,
        "module": r.module,
        "name": r.name,
        "description": r.description,
        "input": json.loads(r.input_json),
        "is_preset": r.is_preset,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


async def list_scenarios(db, module=None):
    stmt = select(Scenario)
    if module:
        stmt = stmt.where(Scenario.module == module)
    stmt = stmt.order_by(Scenario.created_at.desc())
    rows = (await db.execute(stmt)).scalars().all()
    return [_to_dict(r) for r in rows]


async def create_scenario(db, module, name, description, input_data):
    obj = Scenario(
        module=module,
        name=name,
        description=description or "",
        input_json=json.dumps(input_data, ensure_ascii=False),
        is_preset=False,
    )
    db.add(obj)
    await db.commit()
    await db.refresh(obj)
    return _to_dict(obj)


async def delete_scenario(db, sid) -> bool:
    obj = await db.get(Scenario, sid)
    if not obj:
        return False
    await db.delete(obj)
    await db.commit()
    return True
