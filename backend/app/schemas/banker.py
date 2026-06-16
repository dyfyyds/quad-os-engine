from __future__ import annotations

from pydantic import BaseModel


class SafetyRequest(BaseModel):
    available: list[int]
    max: list[list[int]]
    allocation: list[list[int]]


class ResourceRequest(BaseModel):
    available: list[int]
    max: list[list[int]]
    allocation: list[list[int]]
    pid: int
    request: list[int]
    use_banker: bool = True        # False = 随机分配对照（不做安全检查）
