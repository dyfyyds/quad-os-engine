from __future__ import annotations

import json

from sqlalchemy import select

from app.models.run_history import RunHistory


def _to_dict(r: RunHistory) -> dict:
    return {
        "id": r.id,
        "module": r.module,
        "algorithm": r.algorithm,
        "input": json.loads(r.input_json),
        "metrics": json.loads(r.metrics_json),
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


async def list_history(db, module=None, limit=50):
    stmt = select(RunHistory)
    if module:
        stmt = stmt.where(RunHistory.module == module)
    stmt = stmt.order_by(RunHistory.created_at.desc()).limit(limit)
    rows = (await db.execute(stmt)).scalars().all()
    return [_to_dict(r) for r in rows]


async def record(db, module, algorithm, input_data, metrics):
    obj = RunHistory(
        module=module,
        algorithm=algorithm,
        input_json=json.dumps(input_data, ensure_ascii=False),
        metrics_json=json.dumps(metrics, ensure_ascii=False),
    )
    db.add(obj)
    await db.commit()
    await db.refresh(obj)
    return _to_dict(obj)
