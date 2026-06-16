from __future__ import annotations

from pydantic import BaseModel, Field


class DiskRequest(BaseModel):
    algorithm: str                 # FCFS / SSTF / SCAN / C-SCAN / LOOK / C-LOOK
    requests: list[int]
    head: int = Field(ge=0)
    disk_size: int = 200
    direction: str = "up"          # up / down
