# 配置持久化（后端为主 + 本地兜底）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把实验配置 `os.config` 升级为「后端数据库持久化为主、localStorage 兜底」，并让后端无 `DATABASE_URL` 时默认用 SQLite，从而裸跑也能真正持久化。

**Architecture:** 后端加一张 KV 表 `app_config` + `GET/PUT /api/config`；前端 `applyConfig` 先写后端、成功再缓存本地，启动时 `hydrateFromServer` 以后端为主覆盖本地；任一不可用静默回退 localStorage。store 字段契约不变，页面零改动。

**Tech Stack:** FastAPI · SQLAlchemy 2.0 async · aiosqlite/aiomysql · Vue 3 · Pinia。

**Spec:** `docs/superpowers/specs/2026-06-20-config-persistence-design.md`

---

## 文件结构

**后端**
- `backend/app/db/mysql.py`（改）— 默认 URL 改 SQLite
- `backend/requirements.txt`（改）— 加 `aiosqlite`
- `backend/app/models/app_config.py`（建）— `AppConfig` 模型
- `backend/app/models/__init__.py`（改）— 注册模型
- `backend/app/services/config_service.py`（建）— get/upsert
- `backend/app/api/config.py`（建）— GET/PUT 路由
- `backend/main.py`（改）— 注册路由
- `backend/tests/test_config_api.py`（建）— 端点测试

**前端**
- `frontend/src/api/client.js`（改）— `put` 助手 + `getConfig`/`putConfig`
- `frontend/src/store/os.js`（改）— `applyConfig` 后端优先 + `hydrateFromServer`
- `frontend/src/App.vue`（改）— 挂载时 `hydrateFromServer`

---

## Task 1: 后端 DB 层 — 默认 SQLite + aiosqlite

**Files:**
- Modify: `backend/app/db/mysql.py:12-15`
- Modify: `backend/requirements.txt:10`

- [ ] **Step 1: 加 aiosqlite 依赖并安装**

修改 `backend/requirements.txt`，在 `aiomysql==0.2.0` 行下加一行：

```
aiosqlite==0.20.0
```

Run: `pip install aiosqlite==0.20.0`
Expected: `Successfully installed aiosqlite-0.20.0`（或 already satisfied）

- [ ] **Step 2: 把默认 URL 改为 SQLite**

修改 `backend/app/db/mysql.py`，把第 12-15 行：

```python
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "mysql+aiomysql://quados:quados@mysql:3306/quad_os?charset=utf8mb4",
)
```

替换为：

```python
# 无 DATABASE_URL（裸跑/本地）默认落地 SQLite 文件，docker 由 compose 显式注入 MySQL。
DEFAULT_DATABASE_URL = "sqlite+aiosqlite:///./quad_os.db"
DATABASE_URL = os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)
```

- [ ] **Step 3: 跑现有全套测试，确认未回退**

Run: `cd backend && python -m pytest -q`
Expected: 全部通过（约 100 项），无 import 错误。

- [ ] **Step 4: 提交**

```bash
git add backend/requirements.txt backend/app/db/mysql.py
git commit -m "feat(db): 无 DATABASE_URL 时默认使用 SQLite（裸跑可持久化）"
```

---

## Task 2: 后端 AppConfig 模型

**Files:**
- Create: `backend/app/models/app_config.py`
- Modify: `backend/app/models/__init__.py`

- [ ] **Step 1: 新建模型**

创建 `backend/app/models/app_config.py`：

```python
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class AppConfig(Base):
    """KV 风格的应用配置持久化（key='current' 即当前实验配置）。"""

    __tablename__ = "app_config"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value_json: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
```

- [ ] **Step 2: 注册模型（让 init_db 建表）**

修改 `backend/app/models/__init__.py` 为：

```python
from app.models.app_config import AppConfig
from app.models.run_history import RunHistory
from app.models.scenario import Scenario

__all__ = ["Scenario", "RunHistory", "AppConfig"]
```

- [ ] **Step 3: 确认导入无误**

Run: `cd backend && python -c "import app.models; print(app.models.AppConfig.__tablename__)"`
Expected: 输出 `app_config`

- [ ] **Step 4: 提交**

```bash
git add backend/app/models/app_config.py backend/app/models/__init__.py
git commit -m "feat(model): 新增 AppConfig 配置持久化表"
```

---

## Task 3: 后端 config 服务 + API + 注册（TDD）

**Files:**
- Test: `backend/tests/test_config_api.py`
- Create: `backend/app/services/config_service.py`
- Create: `backend/app/api/config.py`
- Modify: `backend/main.py:7-8,38`

- [ ] **Step 1: 写失败测试**

创建 `backend/tests/test_config_api.py`：

```python
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && python -m pytest tests/test_config_api.py -v`
Expected: `test_put_then_get_roundtrip` 与 `test_put_upserts_same_key` **FAIL**（路由未注册，PUT 返回 404/405 ≠ 200）。`test_default_database_url_is_sqlite`（Task 1 已加常量）与 `test_get_missing_config_returns_404`（此刻 404 是「路由缺失」的巧合）会先通过——实现后它们才因正确原因通过。关键信号：两个 PUT 测试现在必须红。

- [ ] **Step 3: 实现 config 服务**

创建 `backend/app/services/config_service.py`：

```python
from __future__ import annotations

import json

from app.models.app_config import AppConfig


def _to_dict(r: AppConfig) -> dict:
    return {
        "key": r.key,
        "config": json.loads(r.value_json),
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


async def get_config(db, key: str = "current") -> dict | None:
    obj = await db.get(AppConfig, key)
    return _to_dict(obj) if obj else None


async def upsert_config(db, key: str, data: dict) -> dict:
    obj = await db.get(AppConfig, key)
    value = json.dumps(data, ensure_ascii=False)
    if obj:
        obj.value_json = value
    else:
        obj = AppConfig(key=key, value_json=value)
        db.add(obj)
    await db.commit()
    await db.refresh(obj)
    return _to_dict(obj)
```

- [ ] **Step 4: 实现 config 路由**

创建 `backend/app/api/config.py`：

```python
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.mysql import get_db
from app.services import config_service

router = APIRouter(prefix="/api/config", tags=["配置持久化"])


class ConfigIn(BaseModel):
    key: str = "current"
    config: dict


@router.get("")
async def get_config(key: str = "current", db: AsyncSession = Depends(get_db)):
    cfg = await config_service.get_config(db, key)
    if cfg is None:
        raise HTTPException(status_code=404, detail="无保存配置")
    return cfg


@router.put("")
async def put_config(body: ConfigIn, db: AsyncSession = Depends(get_db)):
    return await config_service.upsert_config(db, body.key, body.config)
```

- [ ] **Step 5: 注册路由**

修改 `backend/main.py`。把第 7-8 行的导入：

```python
from app.api import (banker, disk, history, paging, presets, process, report,
                     scenarios, scheduling, sync)
```

改为（加 `config`）：

```python
from app.api import (banker, config, disk, history, paging, presets, process,
                     report, scenarios, scheduling, sync)
```

并把第 38 行的注册循环：

```python
for module in (scheduling, banker, paging, disk, sync, process, presets, report, scenarios, history):
```

改为（加 `config`）：

```python
for module in (scheduling, banker, paging, disk, sync, process, presets, report, scenarios, history, config):
```

- [ ] **Step 6: 跑测试确认通过**

Run: `cd backend && python -m pytest tests/test_config_api.py -v`
Expected: PASS（4 项）

- [ ] **Step 7: 跑全套确认无回退**

Run: `cd backend && python -m pytest -q`
Expected: 全绿（约 104 项）

- [ ] **Step 8: 提交**

```bash
git add backend/app/services/config_service.py backend/app/api/config.py backend/main.py backend/tests/test_config_api.py
git commit -m "feat(api): 配置持久化端点 GET/PUT /api/config"
```

---

## Task 4: 前端 API 客户端 get/put

**Files:**
- Modify: `frontend/src/api/client.js`

- [ ] **Step 1: 加 `put` 助手**

修改 `frontend/src/api/client.js`，在 `async function get(path) {...}` 之后、`export const api` 之前插入：

```javascript
async function put(path, body) {
  const r = await fetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    let detail = r.statusText
    try { detail = (await r.json()).detail || detail } catch (e) { /* ignore */ }
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
  }
  return r.json()
}
```

- [ ] **Step 2: 暴露 getConfig/putConfig**

在 `export const api = {` 对象里，`recordHistory` 行之后加两行：

```javascript
  getConfig: () => get('/api/config'),
  putConfig: (config) => put('/api/config', { config }),
```

- [ ] **Step 3: 确认前端可编译（dev server HMR 无报错）**

若 dev server 未运行：`preview_start`（配置名 `frontend`）。
然后 `preview_console_logs`（level=error），Expected: 无错误。

- [ ] **Step 4: 提交**

```bash
git add frontend/src/api/client.js
git commit -m "feat(client): 新增 getConfig/putConfig 与 put 助手"
```

---

## Task 5: 前端 store — applyConfig 后端优先 + hydrateFromServer

**Files:**
- Modify: `frontend/src/store/os.js`

- [ ] **Step 1: 引入 api**

修改 `frontend/src/store/os.js` 顶部导入，把：

```javascript
import { defineStore } from 'pinia'
import { seedState } from '../mock/seed'
```

改为：

```javascript
import { defineStore } from 'pinia'
import { seedState } from '../mock/seed'
import { api } from '../api/client'
```

- [ ] **Step 2: 改 applyConfig 为后端优先（并新增 hydrateFromServer）**

把 `applyConfig` 这个 action：

```javascript
    // 按当前（已编辑）config 重建 memory/disk 并持久化 —— 系统设置「应用配置」即生效
    applyConfig() {
      saveConfig(this.config)
      this.$state = seedState(this.config)
    },
```

替换为：

```javascript
    // 系统设置「应用配置」：后端为主（先写 DB），无论成败都写本地缓存兜底，再按 config 重建。
    async applyConfig() {
      const cfg = this.config
      let warn = ''
      try {
        await api.putConfig(cfg)
      } catch (e) {
        warn = e?.message || '后端不可用'
      }
      saveConfig(cfg)                 // 本地缓存（兜底）
      this.$state = seedState(cfg)    // 按配置重建运行态（会重置 events）
      if (warn) {
        this.pushEvent('配置回退', 'system', 'warning', `配置仅保存到本地（${warn}）`)
      }
    },
    // 启动时拉取后端配置；有则以后端为主覆盖本地，无/失败则保持本地。
    async hydrateFromServer() {
      let r
      try {
        r = await api.getConfig()
      } catch (e) {
        return                        // 后端不可用或 404 → 保持本地/默认
      }
      if (r && r.config) {
        saveConfig(r.config)
        this.$state = seedState(r.config)
      }
    },
```

- [ ] **Step 3: 确认编译无报错**

`preview_console_logs`（level=error），Expected: 无错误。

- [ ] **Step 4: 提交**

```bash
git add frontend/src/store/os.js
git commit -m "feat(store): applyConfig 后端为主 + hydrateFromServer 启动回填"
```

---

## Task 6: 前端 App.vue — 挂载时回填

**Files:**
- Modify: `frontend/src/App.vue:60-71`

- [ ] **Step 1: 挂载时调用 hydrateFromServer**

修改 `frontend/src/App.vue` 的 `<script setup>`。把：

```javascript
import { ref, onMounted } from 'vue'
import RunControlBar from './components/widgets/RunControlBar.vue'
import { useOsDriver } from './mock/driver'

const collapsed = ref(false)
const driver = useOsDriver()

onMounted(async () => {
  await driver.checkBackend()
})
```

替换为：

```javascript
import { ref, onMounted } from 'vue'
import RunControlBar from './components/widgets/RunControlBar.vue'
import { useOsDriver } from './mock/driver'
import { useOsStore } from './store/os'

const collapsed = ref(false)
const driver = useOsDriver()
const os = useOsStore()

onMounted(async () => {
  await os.hydrateFromServer().catch(() => {})  // 后端为主：先回填配置
  await driver.checkBackend()
})
```

- [ ] **Step 2: 确认编译无报错**

`preview_console_logs`（level=error），Expected: 无错误。

- [ ] **Step 3: 提交**

```bash
git add frontend/src/App.vue
git commit -m "feat(app): 挂载时 hydrateFromServer 以后端为主回填配置"
```

---

## Task 7: 端到端验证（preview）

**Files:** 无（仅验证）

- [ ] **Step 1: 重启后端到 SQLite**

停掉旧的 MySQL 模式后端进程（之前后台启动的）。从 `backend/` 重新启动（不带 `DATABASE_URL`）：

Run（后台）: `cd backend && python -m uvicorn main:app --host 127.0.0.1 --port 8080`
确认: `curl -s http://127.0.0.1:8080/api/health` 返回 `{"status":"ok",...}`，且 `backend/quad_os.db` 文件被创建。

- [ ] **Step 2: 确保 dev server 运行**

`preview_start`（配置名 `frontend`）。

- [ ] **Step 3: 验证「后端为主」回填**

用 `preview_eval` 执行：

```javascript
(async () => {
  const os = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('os')
  os.config.quantum = 7
  os.config.schedAlgo = 'FCFS'
  await os.applyConfig()
  const r = await fetch('/api/config').then(x => x.json())
  return { backend_quantum: r.config.quantum, backend_algo: r.config.schedAlgo }
})()
```
Expected: `{ backend_quantum: 7, backend_algo: 'FCFS' }`（后端确实存了）。

- [ ] **Step 4: 验证 F5 从后端恢复**

先清掉本地缓存以证明是「从后端」恢复：`preview_eval`：`localStorage.removeItem('quad-os:config')` → 然后 `location.reload()`。
等待后 `preview_eval`：

```javascript
(() => {
  const os = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('os')
  return { quantum: os.config.quantum, algo: os.config.schedAlgo }
})()
```
Expected: `{ quantum: 7, algo: 'FCFS' }`（本地已清空，仍恢复 → 来自后端）。

- [ ] **Step 5: 验证后端不可用时回退本地**

停掉后端进程。`preview_eval`：

```javascript
(async () => {
  const os = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('os')
  os.config.quantum = 3
  await os.applyConfig()
  const ev = os.events.find(e => e.type === '配置回退')
  return { local: JSON.parse(localStorage.getItem('quad-os:config')).quantum, hasWarn: !!ev }
})()
```
Expected: `{ local: 3, hasWarn: true }`（后端挂了仍存本地 + 有回退提示）。

- [ ] **Step 6: 收尾**

重启后端（SQLite）以便后续使用；确认全套后端测试仍绿：`cd backend && python -m pytest -q`。
此任务无代码改动，不单独提交。

---

## 自检备注

- Spec 覆盖：SQLite 默认（T1）、AppConfig 表（T2）、服务+端点+注册（T3）、客户端（T4）、store 后端优先+回填（T5）、App 挂载回填（T6）、有/无后端/裸跑三场景验收（T7）。
- 命名一致：客户端 `putConfig`/`getConfig`；store 复用既有 localStorage 助手 `saveConfig`/`loadSavedConfig`/`clearSavedConfig`（不改名）；后端 `config_service.get_config/upsert_config`、`AppConfig`、`DEFAULT_DATABASE_URL`。
- 契约不变：`store/os.js` 字段形状与 `docs/接口契约.md` 不动。
