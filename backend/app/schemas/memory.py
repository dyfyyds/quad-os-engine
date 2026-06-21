from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class MemoryStateSchema(BaseModel):
    frames: list[int | None]
    page_tables: dict[int, list[dict[str, Any]]]
    clock_ptr: int = 0
    process_refs: dict[int, list[int]] = Field(default_factory=dict)
    process_ptrs: dict[int, int] = Field(default_factory=dict)


class MemoryAccessRequest(BaseModel):
    state: MemoryStateSchema
    pid: int
    page: int
    is_write: bool = False
    current_time: int = 0
    algorithm: str


class MemoryAccessResponse(BaseModel):
    hit: bool
    evicted_page: int | None = None
    wrote_back: bool = False
    slot: int
    state: MemoryStateSchema
