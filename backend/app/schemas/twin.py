from __future__ import annotations
from typing import Any
from pydantic import BaseModel


class SimState(BaseModel):
    clock: int
    rngState: int
    nextPid: int
    gantt: list[Any]
    scheduler: dict[str, Any]
    processes: list[dict[str, Any]]
    memory: dict[str, Any]
    resources: dict[str, Any]
    sync: dict[str, Any]
    disk: dict[str, Any]
    metrics: dict[str, Any]
    config: dict[str, Any]


class TwinTickRequest(BaseModel):
    state: SimState


class TwinTickResponse(BaseModel):
    state: SimState
    events: list[dict[str, Any]]
