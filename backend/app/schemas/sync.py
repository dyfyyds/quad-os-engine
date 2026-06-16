from __future__ import annotations

from pydantic import BaseModel, Field


class SyncOp(BaseModel):
    type: str                      # produce / consume
    proc: str | None = None


class SyncRequest(BaseModel):
    operations: list[SyncOp]
    buffer_size: int = Field(gt=0, default=10)
