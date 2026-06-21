"""Quad-OS Engine —— 多算法操作系统调度模拟平台后端入口。"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import (banker, config, disk, history, memory, paging, presets, process, report,
                     scenarios, scheduling, sync, twin)


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        from app.db.mysql import init_db
        await init_db()
        print("[ok] 数据库已就绪")
    except Exception as e:  # noqa: BLE001
        print(f"[warn] 数据库初始化失败，持久化功能不可用（核心模拟不受影响）：{e}")
    yield


app = FastAPI(
    title="Quad-OS 调度模拟平台",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://localhost(:\d+)?|https?://127\.0\.0\.1(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for module in (scheduling, banker, paging, disk, sync, process, presets, report, scenarios, history, config, memory, twin):
    app.include_router(module.router)


@app.get("/api/health", tags=["系统"])
def health():
    return {"status": "ok", "service": "quad-os-engine"}
