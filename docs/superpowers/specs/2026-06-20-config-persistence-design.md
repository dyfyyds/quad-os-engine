# Quad-OS 配置持久化（后端为主 + 本地兜底）— Phase A 设计

> 日期：2026-06-20 ｜ 分支：`fix/rr-rotation-and-config-persistence`
> 状态：设计已确认，待写实现计划

## 1. 背景与问题

实验配置 `os.config` 原先只活在前端内存，刷新/重置即丢失。已用 **localStorage 持久化**修复（本分支已提交 `9836fac`）。本阶段把持久化升级为**「后端为主 + localStorage 兜底」**，并作为后续「后端权威整机模拟（WebSocket 实时推送）」迁移的**第一步地基**。

## 2. 目标 / 非目标

**目标**
- 配置经后端持久化（数据库），跨浏览器/设备一致。
- 后端 / DB 不可用时**静默回退 localStorage**，绝不阻断使用。
- **零配置 dev**：未设 `DATABASE_URL` 时自动用 SQLite，裸跑（无 docker MySQL）也能真正验证「后端为主」，而非永远走兜底。

**非目标（属于后续 Phase B/C）**
- 整机模拟下沉到后端、WebSocket 实时推送、`driver.js` 瘦身。
- 多用户 / 鉴权 / 命名配置版本（未来可复用现有 `scenarios` 场景库）。

## 3. 北极星（已锁定，供 Phase A 前向兼容）

- 后端权威整机会话 + WebSocket 推送；前端只渲染；**后端不可达时 `driver.js` 离线降级**。
- Phase A 产出的 `config` 端点与「后端为主」加载流，**Phase B 的后端会话将直接复用**——会话 `seed()` 自持久化的 config。

## 4. 架构

### 4.1 后端

1. **DB 层**（`backend/app/db/mysql.py`）：默认 URL 由 MySQL 改为 SQLite
   `DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./quad_os.db")`。
   docker 仍由 compose 显式注入 MySQL URL（已确认 `docker-compose.yml:47`），不受影响。
   `requirements.txt` 增加 `aiosqlite`。
2. **模型** `AppConfig`（`backend/app/models/app_config.py`）：
   `key: str(64) PK`、`value_json: Text`、`updated_at: DateTime(onupdate=now)`。
   注册进 `models/__init__.py`，由现有 `init_db()` 自动建表。
3. **服务** `backend/app/services/config_service.py`：
   `get_config(db, key="current") -> dict | None`、`upsert_config(db, key, data: dict) -> dict`。
4. **路由** `backend/app/api/config.py`：
   - `GET /api/config?key=current` → `{key, config, updated_at}`；无记录返回 404。
   - `PUT /api/config` body `{key?: "current", config: {...}}` → upsert，返回保存结果。
   在 `main.py` 路由列表注册。

### 4.2 前端

1. **`api/client.js`**：`getConfig()` → `GET /api/config`；`putConfig(config)` → `PUT /api/config`。
   （命名用 `putConfig`，避免与 `store/os.js` 现有的 localStorage 写入助手 `saveConfig` 混淆——两者一个写后端、一个写本地缓存。）
2. **`store/os.js`**（沿用现有 localStorage 助手 `saveConfig`/`loadSavedConfig`/`clearSavedConfig`，不改名）：
   - 初始 `state` 维持 `seedState(loadSavedConfig() || undefined)`（localStorage 秒出，兜底层不变）。
   - `applyConfig()`：先 `await api.putConfig(this.config)`；成功 → 同时 `saveConfig`（本地缓存）；失败 → 仅 `saveConfig` + `pushEvent('配置回退','system','warning', …)`；最后 `this.$state = seedState(this.config)`。
   - 新增 `hydrateFromServer()`：`const r = await api.getConfig()`；若 `r?.config` 存在 → `saveConfig(r.config)`（更新本地缓存）→ `this.$state = seedState(r.config)`（`seedState` 自动与 `DEFAULT_CONFIG` 合并）。后端有值即**覆盖本地（后端为主）**。
3. **`App.vue` onMounted**（紧接现有 `driver.checkBackend()`）：`await os.hydrateFromServer().catch(()=>{})`。

### 4.3 数据流

- **保存**：用户「应用配置」→ `applyConfig` → `PUT /api/config`（成功落 DB + 本地缓存；失败仅本地 + 提示）→ 重建 state。
- **加载**：刷新 / F5 → 同步 localStorage 秒出 → `onMounted` `GET /api/config` → 有则覆盖。
- **回退**：后端 / DB 任一不可用 → 存取走 localStorage + 一条提示事件，使用不中断。

## 5. 错误处理

- 后端任何 4xx/5xx/网络错 → 前端 `catch` → 走 localStorage 路径 + 一条 warning 事件（复用 `pushEvent`）。
- 后端 DB 不可用 → 端点按现有 `get_db` 行为抛错 → 前端同上。
- `GET` 404（无保存记录）→ 视为「无服务器配置」，用本地/默认，**不算错误**。

## 6. 测试

- **后端 pytest**（临时 SQLite 库）：
  - `config_service`：upsert 新建 / 覆盖；get 命中 / 未命中。
  - 端点：PUT 后 GET 回读一致；GET 空时 404。
- **前端 preview 实测**（无 JS 测试框架）：
  - 改 quantum → 应用 → `GET /api/config` 含新值 → F5 → 从后端恢复。
  - 停后端 → 应用 → 仅 localStorage、有提示事件；F5 用本地兜底。

## 7. 影响面 / 文件清单

**后端（新增/改）**：`db/mysql.py`（默认 URL）、`requirements.txt`（aiosqlite）、`models/app_config.py`（新）、`models/__init__.py`、`services/config_service.py`（新）、`api/config.py`（新）、`main.py`（注册）、`tests/test_config_api.py`（新）。
**前端（改）**：`api/client.js`、`store/os.js`、`App.vue`。
**契约**：`store/os.js` 字段形状不变，`docs/接口契约.md` 不动。

## 8. 验收标准

- **有后端**：应用配置后 F5 / 换浏览器，配置从后端恢复一致。
- **无后端/DB**：应用配置后刷新，配置从 localStorage 恢复，带「本地兜底」提示，功能不中断。
- **裸跑**（无 docker、无 `DATABASE_URL`）：后端用 SQLite，「后端为主」真实生效。
- 现有 100 项后端测试 + 新增 config 测试全绿。

## 9. 风险

- SQLite 与 MySQL 方言差异：仅 KV 表 + JSON 文本，极低风险。
- aiosqlite 写并发：教学单用户，忽略。
