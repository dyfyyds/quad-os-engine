from __future__ import annotations

from pydantic import BaseModel, Field


class Job(BaseModel):
    name: str
    arrival: int = 0
    burst: int = Field(gt=0)
    priority: int | None = None


class SchedulingRequest(BaseModel):
    algorithm: str                 # FCFS / SJF / HRRN / PRIORITY / RR
    jobs: list[Job]
    time_quantum: int | None = None
