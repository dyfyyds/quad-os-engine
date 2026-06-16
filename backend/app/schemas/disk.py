"""磁盘调度模块的请求/响应 Schema。"""
from __future__ import annotations

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# 兼容旧接口 — 纯移臂调度
# ---------------------------------------------------------------------------
class DiskRequest(BaseModel):
    """纯移臂调度请求（兼容旧接口）。"""
    algorithm: str                 # FCFS / SSTF / SCAN / C-SCAN / LOOK / C-LOOK / F-SCAN / N-SCAN
    requests: list[int]            # 柱面号列表
    head: int = Field(ge=0)
    disk_size: int = 200
    direction: str = "up"          # up / down


# ---------------------------------------------------------------------------
# 高级接口 — 完整 I/O 模拟
# ---------------------------------------------------------------------------
class DiskGeometryConfig(BaseModel):
    """磁盘几何配置。"""
    cylinders: int = Field(default=200, ge=1, description="柱面总数")
    tracks_per_cylinder: int = Field(default=4, ge=1, description="每柱面磁道数")
    records_per_track: int = Field(default=8, ge=1, description="每磁道记录数（扇区）")
    seek_per_cylinder: float = Field(default=1.0, ge=0, description="每柱面寻道时间")
    rotation_per_rev: float = Field(default=8.0, ge=0, description="一圈旋转时间")
    transfer_per_record: float = Field(default=0.5, ge=0, description="每记录传输时间")


class IORequestItem(BaseModel):
    """单条 I/O 请求。"""
    进程名: str = Field(default="unknown", description="进程名称")
    柱面号: int = Field(ge=0, description="目标柱面号")
    磁道号: int = Field(default=0, ge=0, description="目标磁道号")
    物理记录号: int = Field(default=0, ge=0, description="目标物理记录号")


class DiskSimulateRequest(BaseModel):
    """完整 I/O 模拟请求（移臂 + 旋转 + 传输）。"""
    algorithm: str = Field(description="移臂算法: FCFS/SSTF/SCAN/C-SCAN/LOOK/C-LOOK/F-SCAN/N-SCAN")
    io_requests: list[IORequestItem] = Field(description="I/O 请求队列")
    head: int = Field(ge=0, description="当前磁头所在柱面")
    current_record: int = Field(default=0, ge=0, description="当前磁头所在物理记录")
    geometry: DiskGeometryConfig = Field(default_factory=DiskGeometryConfig, description="磁盘几何参数")
    direction: str = Field(default="up", description="初始移臂方向: up/down")


class DiskBenchmarkRequest(BaseModel):
    """多算法基准对比请求。"""
    io_requests: list[IORequestItem] = Field(description="I/O 请求队列")
    head: int = Field(ge=0, description="当前磁头所在柱面")
    current_record: int = Field(default=0, ge=0, description="当前磁头所在物理记录")
    geometry: DiskGeometryConfig = Field(default_factory=DiskGeometryConfig, description="磁盘几何参数")
    direction: str = Field(default="up", description="初始移臂方向")
    algorithms: list[str] | None = Field(default=None, description="要对比的算法列表（默认全部）")
