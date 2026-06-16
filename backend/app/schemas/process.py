from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class PCB(BaseModel):
    """进程控制块输入。"""
    pid: int
    name: str
    arrival: int = 0
    burst: int = Field(gt=0)
    ran: int = 0
    priority: int | None = None
    state: str | None = None  # 可选，不传则自动按 arrival 决定


class ProcessTickRequest(BaseModel):
    """单步推进请求。"""
    processes: list[PCB]
    algorithm: str
    time_quantum: int | None = 2
    new_arrivals: list[PCB] | None = None
    force_io: bool | None = None


class ProcessTickResponse(BaseModel):
    """单步推进响应 —— 返回更新后的进程状态和事件。"""
    clock: int
    processes: list[dict[str, Any]]
    gantt: list[dict[str, Any]]
    events: list[str]
    metrics: dict[str, Any]
    step: dict[str, Any]  # SimulationStep 的 dict 形式


class ProcessRunRequest(BaseModel):
    """一次性运行请求。"""
    processes: list[PCB]
    algorithm: str
    time_quantum: int | None = 2
    max_ticks: int | None = 200
