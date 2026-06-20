"""配置持久化 API 测试（临时 SQLite：同步建表 + 异步运行 + 覆盖 get_db）。"""
import os
import tempfile

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.models  # noqa: F401 — 注册模型
from app.db import mysql
from app.db.mysql import get_db
from app.models.base import Base
from main import app

# —— 临时 SQLite 测试库 ——
_DB = os.path.join(tempfile.gettempdir(), "quados_test_config.db")
if os.path.exists(_DB):
    os.remove(_DB)
_sync = create_engine(f"sqlite:///{_DB}")
Base.metadata.create_all(_sync)
_sync.dispose()

_aengine = create_async_engine(f"sqlite+aiosqlite:///{_DB}")
_ASession = async_sessionmaker(_aengine, expire_on_commit=False)


async def _override_get_db():
    async with _ASession() as session:
        yield session


app.dependency_overrides[get_db] = _override_get_db
client = TestClient(app)


def test_default_database_url_is_sqlite():
    assert mysql.DEFAULT_DATABASE_URL.startswith("sqlite+aiosqlite")


def test_get_missing_config_returns_404():
    r = client.get("/api/config", params={"key": "nope"})
    assert r.status_code == 404


def test_put_then_get_roundtrip():
    r = client.put("/api/config", json={"config": {"quantum": 6, "schedAlgo": "FCFS"}})
    assert r.status_code == 200
    assert r.json()["config"]["quantum"] == 6

    r2 = client.get("/api/config")
    assert r2.status_code == 200
    body = r2.json()
    assert body["key"] == "current"
    assert body["config"]["schedAlgo"] == "FCFS"


def test_put_upserts_same_key():
    client.put("/api/config", json={"config": {"quantum": 2}})
    client.put("/api/config", json={"config": {"quantum": 9}})
    assert client.get("/api/config").json()["config"]["quantum"] == 9
