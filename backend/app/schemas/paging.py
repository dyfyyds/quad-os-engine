from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class PagingRequest(BaseModel):
    algorithm: str                 # FIFO / LRU / OPT / CLOCK
    reference_string: list[int]
    frames: int = Field(gt=0)


class TranslateRequest(BaseModel):
    page_table: list[dict[str, Any]]   # [{页号,标志,主存块号,...}]
    instructions: list[dict[str, Any]] # [{操作,页号,单元号}]
    block_size: int = 128
