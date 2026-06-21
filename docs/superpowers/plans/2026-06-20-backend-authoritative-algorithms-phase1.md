# 算法后端权威化 — Phase 1（孪生整拍下沉）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让数字孪生每一拍由后端 `POST /api/twin/tick` 推进，后端不可达时回退前端**纯函数 `localTick`**；两路用同一种子 PRNG，结果逐拍一致。

**Architecture:** 把现 `driver.js` 中与 Pinia 耦合的 `tick()` 抽成纯函数 `localTick(state)→{state,events}`（不碰 store、不用 `Math.random`、调度状态进 `state.scheduler`、随机用种子 PRNG）。该纯函数既作前端离线兜底，又作前后端 **parity 的 JS 参照（oracle）**。后端 `twin_engine.tick(state)→(state,events)` 移植同一逻辑、复用既有引擎，由 oracle fixture 锁定一致。

**Tech Stack:** 后端 FastAPI + pytest；前端 Vue3/Pinia + Vite（**无 JS 测试框架**，前端校验用 `node scripts/*.mjs` + preview）。

> 设计依据：`docs/superpowers/specs/2026-06-20-backend-authoritative-algorithms-design.md`。Phase 2（实验页兜底）、Phase 3（正确性审计）在 Phase 1 落地后各自单独出计划——它们依赖本期产出的 `localTick.js` / `mock/engines` 实际结构。

---

## 文件结构

**后端 新增**
- `backend/app/engines/rng.py` — Mulberry32 确定性 PRNG。
- `backend/app/engines/twin_engine.py` — `tick(state: dict) -> tuple[dict, list[dict]]`，编排既有引擎推进一拍。
- `backend/app/schemas/twin.py` — `TwinTickRequest/Response`（SimState 透传校验）。
- `backend/app/api/twin.py` — `POST /api/twin/tick`。
- `backend/tests/test_rng.py`、`backend/tests/test_twin_engine.py`、`backend/tests/test_twin_parity.py`、`backend/tests/test_twin_api.py`。
- `backend/tests/fixtures/twin_init.json`、`backend/tests/fixtures/twin_expected.json`（由前端 oracle 脚本生成）。

**后端 改**
- `backend/main.py` — 注册 `twin` 路由。

**前端 新增**
- `frontend/src/mock/rng.js` — mulberry32（与后端逐位一致）。
- `frontend/src/mock/localTick.js` — 纯函数 `seedSim(config)`、`localTick(state)`、`serializeSim(state)`、`applySim(target, sim)`。
- `frontend/scripts/rng_check.mjs` — 打印 PRNG 向量（生成期望值）。
- `frontend/scripts/twin_oracle.mjs` — 跑纯 `localTick` 生成 parity fixtures。

**前端 改**
- `frontend/src/mock/seed.js` — `seedState` 增 `rngState`、`scheduler`；`Math.random` 改种子 PRNG。
- `frontend/src/mock/driver.js` — 删除内联 tick 数学，改为调用 `localTick.js`；新增后端整拍 dispatch + 回退。
- `frontend/src/api/client.js` — 增 `twinTick`。

---

## Task 1: 确定性 PRNG（前后端逐位一致）

**Files:**
- Create: `backend/app/engines/rng.py`
- Create: `frontend/src/mock/rng.js`
- Create: `frontend/scripts/rng_check.mjs`
- Test: `backend/tests/test_rng.py`

- [ ] **Step 1: 写后端 PRNG**

`backend/app/engines/rng.py`:

```python
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
```

- [ ] **Step 2: 写前端 PRNG（同算法）**

`frontend/src/mock/rng.js`:

```js
// Mulberry32 确定性 PRNG —— 与后端 backend/app/engines/rng.py 逐位一致。
export function makeRng(state) {
  return {
    state: state >>> 0,
    next() {
      this.state = (this.state + 0x6d2b79f5) >>> 0
      let t = this.state
      t = Math.imul(t ^ (t >>> 15), 1 | t)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    },
    randint(lo, hi) {
      return lo + Math.floor(this.next() * (hi - lo + 1))
    },
  }
}
```

- [ ] **Step 3: 用前端生成期望向量**

`frontend/scripts/rng_check.mjs`:

```js
import { makeRng } from '../src/mock/rng.js'
const r = makeRng(0x9e3779b9)
const vec = Array.from({ length: 8 }, () => Number(r.next().toFixed(12)))
console.log(JSON.stringify(vec))
```

Run: `node frontend/scripts/rng_check.mjs`
记下输出的 8 个浮点数组（下一步粘进后端测试）。

- [ ] **Step 4: 写后端 parity 测试（粘入上一步向量）**

`backend/tests/test_rng.py`:

```python
from app.engines.rng import Mulberry32


def test_matches_frontend_vector():
    # 来自 `node frontend/scripts/rng_check.mjs`（seed=0x9E3779B9，前 8 个 next()）
    expected = [...]  # ← 粘入 Step 3 的输出
    r = Mulberry32(0x9E3779B9)
    got = [round(r.next(), 12) for _ in range(8)]
    assert got == expected


def test_randint_range():
    r = Mulberry32(123)
    for _ in range(1000):
        v = r.randint(1, 4)
        assert 1 <= v <= 4
```

- [ ] **Step 5: 跑测试验证通过**

Run: `cd backend && python -m pytest tests/test_rng.py -v`
Expected: PASS（若浮点不一致，核对 `Math.imul`/32 位回绕；这是后续所有 parity 的根基，必须先绿）。

- [ ] **Step 6: 提交**

```bash
git add backend/app/engines/rng.py frontend/src/mock/rng.js frontend/scripts/rng_check.mjs backend/tests/test_rng.py
git commit -m "feat(rng): 前后端逐位一致的 Mulberry32 确定性 PRNG"
```

---

## Task 2: SimState 序列化契约（纯函数）

把"哪些字段进 round-trip"固化为纯函数，前端 driver 与 oracle 共用。

**Files:**
- Create: `frontend/src/mock/localTick.js`（本任务仅先放 `serializeSim`/`applySim` 与字段白名单；`seedSim`/`localTick` 在 Task 3 填充）
- Test: `frontend/scripts/simstate_check.mjs`（Node 自检，临时脚本）

- [ ] **Step 1: 定义白名单 + serialize/apply**

`frontend/src/mock/localTick.js`（先建文件，仅本段）:

```js
// SimState 序列化契约：仅这些字段参与后端 round-trip（其余 events/history/backendMode 为 UI-only）。
export const SIM_FIELDS = [
  'clock', 'rngState', 'nextPid', 'gantt', 'scheduler',
  'processes', 'memory', 'resources', 'sync', 'disk', 'metrics', 'config',
]

// memory 里 UI-only 子字段，不进 round-trip
const MEMORY_UI_ONLY = ['backendMode', 'backendError', 'pagingTrace', 'traceCursor']

export function serializeSim(state) {
  const out = {}
  for (const k of SIM_FIELDS) out[k] = state[k]
  // 深拷贝并剔除 memory UI-only
  const sim = JSON.parse(JSON.stringify(out))
  for (const k of MEMORY_UI_ONLY) delete sim.memory[k]
  return sim
}

export function applySim(target, sim) {
  for (const k of SIM_FIELDS) {
    if (k === 'memory') {
      // 保留 target.memory 的 UI-only 子字段，仅覆盖算法字段
      const ui = {}
      for (const u of MEMORY_UI_ONLY) ui[u] = target.memory[u]
      target.memory = { ...sim.memory, ...ui }
    } else {
      target[k] = sim[k]
    }
  }
}
```

- [ ] **Step 2: 写 Node 自检脚本**

`frontend/scripts/simstate_check.mjs`:

```js
import { serializeSim, applySim, SIM_FIELDS } from '../src/mock/localTick.js'

const state = {
  clock: 3, rngState: 99, nextPid: 6, gantt: [{ 作业: 'a', 开始: 0, 结束: 1 }],
  scheduler: { rrQueue: [1, 2], currentPid: 1, quantumUsed: 2 },
  processes: [{ pid: 1, state: '运行' }], resources: { available: [1] },
  sync: { s1: 4 }, disk: { head: 53, queue: [] }, metrics: { cpuUtil: 0 },
  config: { schedAlgo: 'RR' },
  memory: { frames: [null], backendMode: 'backend', pagingTrace: { x: 1 } },
}
const sim = serializeSim(state)
console.assert(sim.memory.backendMode === undefined, 'UI-only 应被剔除')
console.assert(sim.clock === 3 && sim.scheduler.rrQueue.length === 2)

const target = { memory: { frames: [], backendMode: 'local', backendError: 'e', pagingTrace: null, traceCursor: -1 } }
for (const k of SIM_FIELDS) if (!(k in target)) target[k] = undefined
applySim(target, sim)
console.assert(target.memory.backendMode === 'local', 'apply 应保留 target 的 UI-only')
console.assert(target.memory.frames[0] === null, 'apply 应覆盖算法字段')
console.log('simstate OK')
```

- [ ] **Step 3: 跑自检**

Run: `node frontend/scripts/simstate_check.mjs`
Expected: 输出 `simstate OK`，无 assert 报错。

- [ ] **Step 4: 提交**

```bash
git add frontend/src/mock/localTick.js frontend/scripts/simstate_check.mjs
git commit -m "feat(sim): SimState 序列化契约 serializeSim/applySim（剔除 UI-only）"
```

---

## Task 3: 抽出纯函数 `localTick`（前端离线整拍引擎）

把 `driver.js` 现 `tick()` 及其全部子逻辑**机械迁移**为纯函数，作为离线兜底 + parity oracle。

**转换规则（逐条照搬，不改算法语义）：**
1. 入参 `os`（store 实例）→ 纯 `state` 对象（plain）。
2. `os.pushEvent(type, core, level, desc)` → `events.push({ type, core, level, desc })`（`events` 为本拍局部数组，最后随返回）。
3. getter：`os.runningProc` → `findRunning(state)`；`os.readyProcs` 等同理写成本地小工具。
4. `os.recordHistory()` **移出**纯函数（UI-only，留在 driver 包装层）。
5. 模块级 `schedRrQueue/schedCurrentPid/schedQuantumUsed` → `state.scheduler.{rrQueue,currentPid,quantumUsed}`。
6. 所有 `Math.random()` → `rng.next()`，其中 `rng = makeRng(state.rngState)`；该拍结束把 `rng.state` 写回 `state.rngState`。
7. `addDeterministicArrival` 的 `Math.floor(Math.random()*4)+1` → `rng.randint(1,4)` 等。
8. 纯函数内**不出现** `api.*`（后端调用只在 driver 包装层；本期 disk/banker 的「后端优先」内联调用移到 driver dispatch，纯函数只保留本地等价分支）。

**Files:**
- Modify: `frontend/src/mock/localTick.js`（填充 `seedSim`、`localTick` 及所有迁移来的子函数）
- Modify: `frontend/src/mock/seed.js`（`seedState` 增 `rngState`、`scheduler`，`Math.random`→PRNG）
- Modify: `frontend/src/mock/driver.js`（改为调用 `localTick`；移除内联 tick 数学）
- Verify: preview（无 JS 单测，靠可视行为 + Task 4 oracle 锁定）

- [ ] **Step 1: `seed.js` 注入 rng/scheduler 初值**

在 `seedState` 返回对象中加入（`frontend/src/mock/seed.js` 顶层 state）：

```js
    rngState: (config.rngSeed ?? 0x9e3779b9) >>> 0,
    scheduler: { rrQueue: [], currentPid: null, quantumUsed: 0 },
```

并把 `generateDynamicRefString` 与资源矩阵的 `Math.random()` 改为接收一个 `rng`（由 `seedState` 用 `makeRng(rngState)` 创建并贯穿），使初始态也可复现。`DEFAULT_CONFIG` 增 `rngSeed: 0x9e3779b9`。

- [ ] **Step 2: 迁移 tick 主体进 `localTick.js`**

按上述 8 条规则，把 `driver.js` 的这些函数搬进 `localTick.js` 并纯化：
`seedScheduler`、`clampIndex`、`vecLe`、`calcNeed`、`translateProcessNames`、`findFrameOwner`、`localSchedulingTrace`、`applyCpuTrace`、`onCpuDiskRequest`、`getIoProb`、`localPagingTrace`、`applyMemoryStep`、`loadPageAfterDiskIo`、`recordDiskBusy`、`recomputeDiskBusyRate`、`serveDisk`（**仅本地分支**，删 `api.disk` 调用）、`makeRequest`、`localSafety`、`localBankerRequest`、`refreshBankerSafety`（仅本地分支）、`serveBankerRequest`（仅本地分支）、PV 全套（`pvWake*`/`pvProduce`/`pvConsume`/`isProducer`/`isConsumer`/`syncProduce`/`syncConsume`）、`addDeterministicArrival`、`recomputeRuntimeMetrics`、`tick`。

顶部签名：

```js
import { makeRng } from './rng.js'
import { seedState } from './seed.js'

const findRunning = (s) => s.processes.find((p) => p.state === '运行') || null

export function seedSim(config) { return seedState(config) }  // 复用 seed.js

// 纯整拍：推进一拍，返回新 state 与本拍事件。不触 store / 不调后端 / 不用 Math.random。
export function localTick(state) {
  const events = []
  const rng = makeRng(state.rngState)
  const push = (type, core, level, desc) => events.push({ type, core, level, desc })
  // …（迁移来的 tick 主体，所有 os.pushEvent→push、os.xxx→state.xxx、Math.random→rng.next）…
  state.rngState = rng.state >>> 0
  return { state, events }
}
```

> 这是一次**机械重写**：算法分支逐字保留，仅替换 store/random 接缝。源参照 `frontend/src/mock/driver.js:39-1431`。

- [ ] **Step 3: 重写 `driver.js` 包装层（仅本地路径，先不接后端）**

`driver.js` 改为：

```js
import { useOsStore } from '../store/os'
import { localTick, serializeSim, applySim } from './localTick'

let timer = null, ticking = false

function runLocalTick(os) {
  const { events } = localTick(os.$state)   // 直接在 store state 上推进
  for (const e of events) os.pushEvent(e.type, e.core, e.level, e.desc)
  os.recordHistory()
}

async function tick(os) { runLocalTick(os) }   // Task 7 加入后端 dispatch
// start/pause/step/setSpeed/reset/checkBackend 保留，内部 tick 走上面这个
```

> `localTick(os.$state)` 直接以 store 的 `$state` 为 plain 对象推进（Pinia 的 `$state` 可整体读写）。事件单独经 `pushEvent` 入 UI 流。

- [ ] **Step 4: preview 验证本地仿真行为不变**

```
preview_start → 打开「数字孪生 / 总览」→ 运行
```
用 `preview_snapshot` / `preview_screenshot` 确认：进程在就绪↔运行↔阻塞↔完成迁移、甘特图增长、缺页事件、磁盘移臂、银行家安全序列、PV 生产消费事件都正常滚动。`preview_console_logs` 无报错。

> 因 PRNG 化，行为变为**确定性**（同 seed 每次相同）——这是预期变化。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/mock/localTick.js frontend/src/mock/seed.js frontend/src/mock/driver.js
git commit -m "refactor(twin): 抽出纯函数 localTick 作离线整拍引擎（scheduler 入 state、PRNG 化）"
```

---

## Task 4: 生成 parity oracle fixtures

用纯 `localTick` 跑固定初始态 N 拍，导出后端 parity 的金标准。

**Files:**
- Create: `frontend/scripts/twin_oracle.mjs`
- Create: `backend/tests/fixtures/twin_init.json`
- Create: `backend/tests/fixtures/twin_expected.json`

- [ ] **Step 1: 写 oracle 脚本**

`frontend/scripts/twin_oracle.mjs`:

```js
import { writeFileSync, mkdirSync } from 'node:fs'
import { seedSim, localTick, serializeSim } from '../src/mock/localTick.js'

const config = { rngSeed: 0x12345678, schedAlgo: 'RR', pageAlgo: 'LRU', diskAlgo: 'SCAN',
  processAutoArrival: true, dynamicPages: true }
const state = seedSim(config)
const init = serializeSim(state)

const expected = []
let s = state
for (let i = 0; i < 30; i++) {
  const { state: ns, events } = localTick(s)
  s = ns
  expected.push({ tick: i + 1, state: serializeSim(s), events })
}

mkdirSync('backend/tests/fixtures', { recursive: true })
writeFileSync('backend/tests/fixtures/twin_init.json', JSON.stringify(init, null, 2))
writeFileSync('backend/tests/fixtures/twin_expected.json', JSON.stringify(expected, null, 2))
console.log('oracle written: 30 ticks')
```

- [ ] **Step 2: 生成 fixtures**

Run: `node frontend/scripts/twin_oracle.mjs`
Expected: 输出 `oracle written: 30 ticks`；两个 JSON 文件生成、非空、`twin_init.json` 含 `clock:0`、`scheduler`、`rngState`。

- [ ] **Step 3: 提交**

```bash
git add frontend/scripts/twin_oracle.mjs backend/tests/fixtures/twin_init.json backend/tests/fixtures/twin_expected.json
git commit -m "test(twin): 生成前后端 parity 的 30 拍 oracle fixtures"
```

---

## Task 5: 后端 `twin_engine`（移植 + parity 锁定）

把 `localTick` 逐拍逻辑移植到 Python，**复用既有引擎**（`MemoryEngine`、`banker_engine`、`disk_engine`、`sync_engine` 的原语），由 oracle 锁定一致。

**Files:**
- Create: `backend/app/engines/twin_engine.py`
- Test: `backend/tests/test_twin_parity.py`、`backend/tests/test_twin_engine.py`

- [ ] **Step 1: 写 parity 测试（先失败）**

`backend/tests/test_twin_parity.py`:

```python
import json
from pathlib import Path

from app.engines import twin_engine

FIX = Path(__file__).parent / "fixtures"


def _load(name):
    return json.loads((FIX / name).read_text(encoding="utf-8"))


def test_30_tick_parity_with_frontend():
    state = _load("twin_init.json")
    expected = _load("twin_expected.json")
    for exp in expected:
        state, events = twin_engine.tick(state)
        assert state == exp["state"], f"tick {exp['tick']} 状态不一致"
        assert events == exp["events"], f"tick {exp['tick']} 事件不一致"
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && python -m pytest tests/test_twin_parity.py -v`
Expected: FAIL（`ModuleNotFoundError: twin_engine` 或断言不符）。

- [ ] **Step 3: 移植实现 `twin_engine.tick`**

`backend/app/engines/twin_engine.py`：以 `frontend/src/mock/localTick.js` 为唯一参照逐函数移植。骨架：

```python
"""孪生整拍引擎：纯函数 tick(state)->(state, events)，移植自 localTick.js。
复用 memory_engine / banker_engine / disk_engine / sync 原语，不复制核心判定。"""
from __future__ import annotations

from app.engines.rng import Mulberry32
from app.engines.memory_engine import MemoryEngine
from app.engines import banker_engine, disk_engine
# … 视需要引入 sync 原语 …

def _running(state): 
    return next((p for p in state["processes"] if p["state"] == "运行"), None)

def tick(state: dict) -> tuple[dict, list[dict]]:
    events: list[dict] = []
    rng = Mulberry32(state["rngState"])
    def push(t, core, level, desc): events.append({"type": t, "core": core, "level": level, "desc": desc})
    # … 移植 localTick 主体：顺序与 JS 完全一致；中文键名保持一致 …
    state["rngState"] = rng.state & 0xFFFFFFFF
    return state, events
```

移植要点（与 JS 对齐，逐项核对）：
- 字典键用**中文**与前端一致（`'柱面号'`、`'标志'`、`'主存块号'`…），否则 `state == expected` 不成立。
- 浮点：JS `(a/b).toFixed(2)` → Python `round(a/b, 2)`；注意 `toFixed` 返回字符串而 metrics 多处是 `+(...).toFixed(2)` 即 number，用 `round`。
- 列表顺序、`sort` 稳定性与 JS 一致（Python `sorted` 稳定，JS `Array.sort` 在现代引擎稳定；tie-break 已显式带 `pid/_idx`）。
- 置换走 `MemoryEngine`；安全性/请求走 `banker_engine`；移臂复用 `disk_engine` 的单步选择。

- [ ] **Step 4: 迭代至 parity 全绿**

Run: `cd backend && python -m pytest tests/test_twin_parity.py -v`
Expected: 最终 PASS。逐拍 diff 定位首个不一致字段并对齐（常见：浮点精度、键名、sort tie-break、rng 调用次数/顺序）。

- [ ] **Step 5: 写不变量测试（独立于 oracle）**

`backend/tests/test_twin_engine.py`:

```python
import json
from pathlib import Path
from app.engines import twin_engine

FIX = Path(__file__).parent / "fixtures"


def test_clock_advances_and_events_are_list():
    state = json.loads((FIX / "twin_init.json").read_text(encoding="utf-8"))
    c0 = state["clock"]
    state, events = twin_engine.tick(state)
    assert state["clock"] == c0 + 1
    assert isinstance(events, list)


def test_rng_state_changes_when_random_used():
    state = json.loads((FIX / "twin_init.json").read_text(encoding="utf-8"))
    before = state["rngState"]
    for _ in range(10):
        state, _ = twin_engine.tick(state)
    assert state["rngState"] != before  # 10 拍内必有随机决策
```

- [ ] **Step 6: 跑全套后端测试**

Run: `cd backend && python -m pytest -q`
Expected: 现有 + 新增全绿。

- [ ] **Step 7: 提交**

```bash
git add backend/app/engines/twin_engine.py backend/tests/test_twin_parity.py backend/tests/test_twin_engine.py
git commit -m "feat(twin): 后端整拍引擎 twin_engine + 前后端 30 拍 parity 锁定"
```

---

## Task 6: `/api/twin/tick` 端点

**Files:**
- Create: `backend/app/schemas/twin.py`、`backend/app/api/twin.py`
- Modify: `backend/main.py`
- Modify: `frontend/src/api/client.js`
- Test: `backend/tests/test_twin_api.py`

- [ ] **Step 1: 写端点测试（先失败）**

`backend/tests/test_twin_api.py`:

```python
import json
from pathlib import Path
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)
FIX = Path(__file__).parent / "fixtures"


def test_tick_advances_clock():
    init = json.loads((FIX / "twin_init.json").read_text(encoding="utf-8"))
    r = client.post("/api/twin/tick", json={"state": init})
    assert r.status_code == 200
    body = r.json()
    assert body["state"]["clock"] == init["clock"] + 1
    assert isinstance(body["events"], list)


def test_bad_state_returns_422_or_400():
    r = client.post("/api/twin/tick", json={"state": {"clock": 0}})  # 缺字段
    assert r.status_code in (400, 422)
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && python -m pytest tests/test_twin_api.py -v`
Expected: FAIL（404，路由不存在）。

- [ ] **Step 3: 写 schema**

`backend/app/schemas/twin.py`:

```python
from __future__ import annotations
from typing import Any
from pydantic import BaseModel


class SimState(BaseModel):
    clock: int
    rngState: int
    nextPid: int
    gantt: list[Any]
    scheduler: dict[str, Any]
    processes: list[dict[str, Any]]
    memory: dict[str, Any]
    resources: dict[str, Any]
    sync: dict[str, Any]
    disk: dict[str, Any]
    metrics: dict[str, Any]
    config: dict[str, Any]


class TwinTickRequest(BaseModel):
    state: SimState


class TwinTickResponse(BaseModel):
    state: SimState
    events: list[dict[str, Any]]
```

- [ ] **Step 4: 写路由**

`backend/app/api/twin.py`:

```python
from fastapi import APIRouter, HTTPException

from app.engines import twin_engine
from app.schemas.twin import TwinTickRequest, TwinTickResponse

router = APIRouter(prefix="/api/twin", tags=["数字孪生整拍"])


@router.post("/tick", response_model=TwinTickResponse)
def tick(body: TwinTickRequest):
    try:
        state, events = twin_engine.tick(body.state.model_dump())
        return TwinTickResponse(state=state, events=events)
    except (KeyError, ValueError, IndexError) as e:
        raise HTTPException(status_code=400, detail=f"整拍推进失败: {e}")
```

- [ ] **Step 5: 注册路由**

`backend/main.py`：import 增 `twin`，并加入 `include_router` 循环元组：

```python
from app.api import (banker, config, disk, history, memory, paging, presets, process, report,
                     scenarios, scheduling, sync, twin)
# …
for module in (scheduling, banker, paging, disk, sync, process, presets, report, scenarios, history, config, memory, twin):
    app.include_router(module.router)
```

- [ ] **Step 6: 前端 client 增 twinTick**

`frontend/src/api/client.js`，在 `api` 对象内加：

```js
  twinTick: (b) => post('/api/twin/tick', b),
```

- [ ] **Step 7: 跑端点测试**

Run: `cd backend && python -m pytest tests/test_twin_api.py -v`
Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add backend/app/schemas/twin.py backend/app/api/twin.py backend/main.py frontend/src/api/client.js backend/tests/test_twin_api.py
git commit -m "feat(api): POST /api/twin/tick 整拍端点 + 前端 client.twinTick"
```

---

## Task 7: driver 后端优先 dispatch + 断网回退

**Files:**
- Modify: `frontend/src/mock/driver.js`
- Verify: preview（后端开/关两态）

- [ ] **Step 1: 改 `tick` 为后端优先**

`frontend/src/mock/driver.js`：

```js
import { api } from '../api/client'
import { localTick, serializeSim, applySim } from './localTick'

let backendDown = false

async function tick(os) {
  if (os.memory.backendMode !== 'local') {
    try {
      const { state, events } = await api.twinTick({ state: serializeSim(os.$state) })
      applySim(os.$state, state)
      for (const e of events) os.pushEvent(e.type, e.core, e.level, e.desc)
      os.recordHistory()
      if (backendDown) { backendDown = false; os.memory.backendMode = 'backend' }
      return
    } catch (e) {
      if (!backendDown) {
        backendDown = true
        os.memory.backendMode = 'local'
        os.pushEvent('整拍回退', 'system', 'warning', '后端整拍接口不可用，切换本地仿真')
      }
    }
  }
  runLocalTick(os)   // 本地纯整拍（Task 3）
}
```

- [ ] **Step 2: `checkBackend` 恢复后切回 backend**

确认 `checkBackend()` 在 `/api/health` 成功时设 `os.memory.backendMode = 'backend'`、`backendDown = false`（失败时保持 `'local'`）。

- [ ] **Step 3: preview 验证「有后端」**

```
preview_start（确保后端在跑）→ 运行孪生
```
- `preview_network`：每拍可见 `POST /api/twin/tick` 200。
- `preview_snapshot`：来源标识显示「真实后端引擎 / backend」。
- 仿真连续推进，`preview_console_logs` 无报错。

- [ ] **Step 4: preview 验证「断后端」回退**

停掉后端进程后继续运行：
- 出现一次「整拍回退」warning 事件；来源标识转「本地」。
- 仿真**不卡顿**、继续逐拍推进。
- 重启后端 + `checkBackend` → 来源自动切回 backend。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/mock/driver.js
git commit -m "feat(twin): driver 每拍后端优先 + 断网回退本地整拍 + 来源标识"
```

---

## Self-Review（已核对）

- **Spec 覆盖**：§4.1 PRNG→Task1；§4.2 SimState→Task2/6；§4.3 twin_engine/端点→Task5/6；§4.4 driver 降级 + scheduler 入 state→Task3/7；§4.5 测试（PRNG 向量 / parity / 不变量 / preview）→Task1/4/5/7。Phase 2/3 明确另行出计划。
- **占位扫描**：无 TBD/TODO；唯一"待填"是 Task1 Step4 的期望向量——由 Step3 当场生成粘入，属正常 TDD 流程，非占位。
- **类型/命名一致**：`makeRng`(JS)/`Mulberry32`(PY)、`serializeSim`/`applySim`/`SIM_FIELDS`、`localTick`/`seedSim`、`twin_engine.tick`、`api.twinTick`、`os.scheduler.{rrQueue,currentPid,quantumUsed}`、`os.memory.backendMode` 全计划一致。
- **风险**：Task3（纯化重写）与 Task5（移植）是大块——靠 Task4 oracle + Task5 parity 自动锁定一致；Task3 因无 JS 单测以 preview 兜底。键名/浮点/sort tie-break 是 parity 失败高发点，已在 Task5 Step3 列出排查清单。
