"""MySQL 异步连接（SQLAlchemy 2.0 async）。

引擎延迟连接：导入本模块不会立即连库，应用即使在无 MySQL 时也能启动，
仅「场景库 / 运行历史」相关接口在调用时报错，核心模拟功能不受影响。
"""
from __future__ import annotations

import os

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "mysql+aiomysql://quados:quados@mysql:3306/quad_os?charset=utf8mb4",
)

engine = create_async_engine(DATABASE_URL, pool_pre_ping=True, pool_recycle=3600)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_db():
    async with SessionLocal() as session:
        yield session


async def init_db(max_retries: int = 30, delay: float = 2.0):
    """初始化数据库表，带重试等待 MySQL 就绪。"""
    import asyncio
    import logging

    import app.models  # noqa: F401 — 注册模型
    from app.models.base import Base

    logger = logging.getLogger(__name__)

    for attempt in range(1, max_retries + 1):
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            logger.info("数据库表初始化成功")
            return
        except Exception as e:
            if attempt < max_retries:
                logger.warning("数据库连接失败 (第 %d/%d 次)，%0.1f 秒后重试: %s",
                               attempt, max_retries, delay, e)
                await asyncio.sleep(delay)
            else:
                logger.warning("数据库初始化失败，持久化功能不可用（核心模拟不受影响）：%s", e)
