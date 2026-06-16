"""统一的「分步 trace」契约 —— 5 个引擎共用。

前端用一套 StepControls 通用驱动「运行 / 单步 / 重置」，
各模块只替换中间的可视化组件。
"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class SimulationStep(BaseModel):
    """调度过程中的一步（动画与状态表的数据源）。"""

    index: int
    description: str
    state: dict[str, Any] = Field(default_factory=dict)
    highlight: dict[str, Any] = Field(default_factory=dict)


class SimulationTrace(BaseModel):
    """任一引擎 run() 的统一返回结构。"""

    module: str
    algorithm: str
    input_echo: dict[str, Any] = Field(default_factory=dict)
    steps: list[SimulationStep] = Field(default_factory=list)
    metrics: dict[str, Any] = Field(default_factory=dict)
    final_state: dict[str, Any] = Field(default_factory=dict)
