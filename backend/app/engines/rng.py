"""Mulberry32 确定性 PRNG —— 与前端 frontend/src/mock/rng.js 逐位一致。

仅用于模拟中的"随机"决策（I/O 概率、资源量等），使整段仿真可复现，
并支撑前后端 parity 测试。状态 = 单个 uint32，随 SimState 序列化。
"""
from __future__ import annotations

_MASK = 0xFFFFFFFF


class Mulberry32:
    def __init__(self, state: int):
        self.state = state & _MASK

    def next(self) -> float:
        """返回 [0,1) 浮点，并推进状态。"""
        self.state = (self.state + 0x6D2B79F5) & _MASK
        t = self.state
        t = ((t ^ (t >> 15)) * (t | 1)) & _MASK
        t ^= (t + (((t ^ (t >> 7)) * (t | 61)) & _MASK)) & _MASK
        return ((t ^ (t >> 14)) & _MASK) / 4294967296.0

    def randint(self, lo: int, hi: int) -> int:
        """[lo, hi] 闭区间整数（与前端 floor(next()*(hi-lo+1))+lo 一致）。"""
        return lo + int(self.next() * (hi - lo + 1))
