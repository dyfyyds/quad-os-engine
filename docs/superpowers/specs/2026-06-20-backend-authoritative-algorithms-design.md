# Quad-OS 算法后端权威化（整拍下沉 + 前端降级 + 全面正确性审计）— 设计

> 日期：2026-06-20 ｜ 分支：`fix/rr-rotation-and-config-persistence`
> 状态：设计已确认（方案 B + 两层面 + 全面审计 + 三期合一），待写实现计划

## 1. 背景与问题

平台有**两个算法层面**，目前「后端优先 + 本地兜底」落实不一致：

**A. 五个「实验页」**（作业调度 / 磁盘 / 页面置换 / 资源分配 / 进程同步）
直接调后端 `/api/.../run`，**无本地兜底**——后端一挂即 `ElMessage.error()` 白屏。即「依赖后端」✅、「断网降级」❌。

**B. 数字孪生实时仿真**（`frontend/src/mock/driver.js`，逐拍耦合推进）

| 模块 | 现状 |
|---|---|
| 磁盘 `serveDisk` | ✅ 后端优先 + 本地等价兜底 |
| 银行家 `refreshBankerSafety` / `serveBankerRequest` | ✅ 后端优先 + 本地兜底 |
| CPU 调度 `applyCpuTrace` | ❌ 纯本地 JS（`prepareCpuTrace` 取了后端 trace 但实时调度器没用它）|
| 分页 `applyMemoryStep` / `loadPageAfterDiskIo` | ❌ 纯本地 JS（从不调后端）|
| PV 同步 `pvProduce` / `pvConsume` | ❌ 纯本地 JS（后端无对应增量接口）|

**进行中地基**：已有无状态 `MemoryEngine` + `POST /api/memory/access`（单步访存决策），`paging_engine.run` 已重构为同构页表/页框模型；但前端尚未接入。

### 1.1 与「北极星」的关系（细化）

`docs/接口契约.md` 既定北极星为「后端权威整机会话 + WebSocket 实时推送，前端只渲染，后端不可达时离线降级」。本设计**细化**该北极星：用**无状态 HTTP「整拍」端点**实现后端权威，而非有状态 WebSocket 会话。理由：

- 降级最简单——状态形状一致，本地直接算下一拍；
- 可写**前后端 parity 测试**（同输入态 → 同输出态）；
- 与已落地的 `/api/memory/access`（state in → state out）同范式；
- 无后端会话/并发/重连复杂度。

WebSocket 推送降为**未来可选优化**，非本设计目标。

## 2. 目标 / 非目标

**目标**
- 孪生每一拍的**每个算法决策**默认来自后端；后端不可达时**整拍**回退本地等价实现。
- 五个实验页后端不可用时**本地降级**出结果 + 提示，不再白屏。
- 前后端算法**口径统一**且**对照教科书语义修正**；用确定性 + parity 测试锁定。
- 仿真**可复现**（同初始态 + 同 PRNG 流 → 同结果），这是后端/本地两路可互换的前提。

**非目标**
- WebSocket / 有状态后端会话（北极星的后续优化）。
- 多用户 / 鉴权。
- 新增算法（仅对齐与修正现有算法）。
- 3D 数字孪生视图（`twin/`）的渲染逻辑改动——它只读 store，不受影响。

## 3. 架构总览

```
┌─────────────────────────── 前端 ───────────────────────────┐
│  视图（只读 store）   store/os.js（唯一数据源 = 接口契约）   │
│        │                         ▲                          │
│        │                         │ 套用新状态 + 追加事件     │
│  ┌─────┴───────── driver.js tick() ─────────┐               │
│  │  1) 序列化 SimState                       │               │
│  │  2) POST /api/twin/tick ──────────────────┼──► 后端       │
│  │  3) 成功→套用返回 state/events            │   twin_engine │
│  │     失败→localTick()（本地等价整拍）      │   （编排既有  │
│  └───────────────────────────────────────────┘    引擎）     │
│  实验页：api.X() 失败 → mock/engines/* 本地引擎 + 降级提示   │
└─────────────────────────────────────────────────────────────┘
                              │
        共享：mock/engines/*（JS）与 backend/app/engines/*（Py）
        语义一一对应，由 parity 测试与确定性 PRNG 锁定
```

三条主线：
1. **Phase 1**：孪生整拍下沉（确定性基座 + 状态契约 + 后端 `twin_engine`/`/api/twin/tick` + driver 降级）。
2. **Phase 2**：实验页本地兜底（抽出共享 JS 引擎，视图后端失败时降级）。
3. **Phase 3**：全面正确性审计（逐算法对照教科书 + 前后端口径统一 + parity 测试）。
   审计不单列实现阶段，而是随 Phase 1/2 触及每个算法时**就地修 + 加测试**；本节集中记录审计结论与目标语义。

---

## 4. Phase 1 — 孪生整拍下沉

### 4.1 确定性 PRNG 基座

现 `driver.js` 多处用 `Math.random()`（`onCpuDiskRequest` 的 I/O 概率、`applyMemoryStep` 触发的 0.4 概率、`addDeterministicArrival` 的资源 max）。改为**可序列化种子 PRNG**，前后端**同一算法**，RNG 状态随 SimState 走，谁算下一拍谁续用同一条流。

选定 **mulberry32**（32 位、JS/Python 可逐位一致）：

```js
// frontend/src/mock/rng.js
export function mulberry32(state) {
  return {
    state: state >>> 0,
    next() {
      this.state = (this.state + 0x6d2b79f5) >>> 0
      let t = this.state
      t = Math.imul(t ^ (t >>> 15), 1 | t)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    },
  }
}
```

```python
# backend/app/engines/rng.py
class Mulberry32:
    def __init__(self, state: int): self.state = state & 0xFFFFFFFF
    def next(self) -> float:
        self.state = (self.state + 0x6D2B79F5) & 0xFFFFFFFF
        t = self.state
        t = (t ^ (t >> 15)) * (t | 1) & 0xFFFFFFFF
        t ^= (t + ((t ^ (t >> 7)) * (t | 61) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296
```

> `Math.imul`/32 位回绕必须两端逐位对齐；parity 测试首条即「同 seed 连取 N 个数，FE/BE 数组完全一致」。

`rngState` 进入 SimState（见 4.2）。`seedState` 初始化 `rngState`（默认固定常量，如 `0x9E3779B9`，可由 config 覆盖以换实验样本）。`generateDynamicRefString` 与 `seedState` 内资源矩阵的 `Math.random()` 也改用该 PRNG，使**整段运行**（含初始态）可复现；初始态生成仍在前端，生成后随 SimState 下发后端，故无需后端重算初始态。

### 4.2 状态契约：SimState（序列化）vs UI-only

`POST /api/twin/tick`：

```
请求  { state: SimState }
响应  { state: SimState, events: Array<{type, core, level, desc}> }
```

**SimState（双向序列化，JSON 安全）**——现 store 中参与算法演进的字段：
- `clock`、`rngState`、`nextPid`、`gantt`
- `scheduler`：`{ rrQueue:number[], currentPid:number|null, quantumUsed:number }`
  —— **把现 driver.js 模块级变量 `schedRrQueue/schedCurrentPid/schedQuantumUsed` 上提进 store 状态**，使后端/本地两路共享同一份且可序列化。
- `processes[]`：`pid,name,state,arrival,burst,ran,priority,blockedReason,pageWaitingFor,blockedAt,refString,refPtr,hits,faults,pageTable[],syncPhase,lastReplace,finishTime`
- `memory`：`capacity,frameCount,frames,pageTable,refString,refPtr,faults,hits,clockPtr,lastReplace`
- `resources`：`types,available,max,allocation,need,safeSeq,deadlock`
- `sync`：`capacity,s1,s2,mutex,buffer,produced,consumed,prodBlocked,consBlocked,mutexBlocked,lockOwner`
- `disk`：`cylinders,tracksPerCyl,recordsPerTrack,head,currentRecord,direction,queue,path,totalSeek,served,servedLog,busyUntil,busyLog,busyRate,ioBlocked,activeRequest`
- `metrics`、`config`

**UI-only（不进 round-trip）**：
- `events`：后端只回**本拍新增**（无 `ts`），前端 `pushEvent` 补 `ts=clock` 并 `unshift`。
- `history`：前端由 `metrics` 派生（`recordHistory()` 保持前端）。
- `memory.backendMode / backendError / pagingTrace / traceCursor`：纯 UI 来源标识。

前端套用：`Object.assign` SimState 字段回 store（保持引用契约字段名不变），再逐条 `pushEvent(返回事件)`，再 `recordHistory()`。

### 4.3 后端 `twin_engine` + 端点

新增 `backend/app/engines/twin_engine.py`：纯函数 `tick(state: dict) -> (state: dict, events: list[dict])`，**编排既有引擎**，1:1 移植 `driver.js` `tick()` 的耦合顺序：

1. `clock++`；首拍 `seed_scheduler`。
2. `config.processAutoArrival && clock%7==0` → 确定性到达（PRNG 取资源 max）。
3. 设备：`activeRequest` 计时推进；完成则出队、若 `isPageFault` 调用置换装入（复用 `MemoryEngine`）。
4. 无活动请求且有队列 → `serve_disk`（移臂选择复用 `disk_engine._seek_order`/`_waypoints` 的单步形态）。
5. 处理机：`apply_cpu`（I/O 唤醒协调 + 状态机 + 按 `config.schedAlgo` 选下一个，调度 key 与 `scheduling_engine._key` 同源）。
6. 推进 `ran` / 维护 `gantt` / 完成回收（资源 + 内存）。
7. 访存（PRNG 0.4）→ `MemoryEngine.access_page`；缺页 → 入磁盘队列阻塞。
8. 磁盘 I/O 请求（`clock%6==0` + PRNG I/O 概率）。
9. 资源（`clock%5==0`）→ 银行家 `request`/`check_safety`（复用 `banker_engine`）。
10. PV 同步（`clock%3==0`，生产者/消费者）→ **共享 PV 原语**（见 6.5）。
11. 聚合 `metrics`。

端点 `backend/app/api/twin.py`：`POST /api/twin/tick`，`body.state` → `twin_engine.tick` → 响应。schema `backend/app/schemas/twin.py`（`SimState` 宽松校验：列表/字典透传，仅约束顶层键存在）。`main.py` 注册 `twin` 路由。

> twin_engine **不复制**置换/安全性/移臂/PV 的核心判定，只做编排与状态推进，核心判定一律落到既有引擎，保证「实验页」与「孪生」用同一套后端算法。

### 4.4 前端 driver 降级接线

`driver.js`：
- 抽出现有 `tick(os)` 主体为 `localTick(os)`（**保留为本地等价整拍引擎**，不删）。
- 新 `tick(os)`：
  1. 若 `backendMode!=='local'`：`serializeSim(os)` → `await api.twinTick(state)` → `applySim(os, resp.state)` + 追加 `resp.events` + `recordHistory()` → `backendMode='backend'`。
  2. 捕获异常：首次 `pushEvent('整拍回退','system','warning','后端整拍接口不可用，切换本地仿真')`；`backendMode='local'`；`localTick(os)`。
  3. `checkBackend()` 周期性探活，恢复后切回 `backend`。
- 模块级 `schedRrQueue/schedCurrentPid/schedQuantumUsed` 迁入 `os.scheduler`；`localTick` 与 `seedScheduler` 改读写 `os.scheduler`。
- `serializeSim/applySim`：白名单字段拷贝（4.2 的 SimState），排除 UI-only。
- `api/client.js` 增 `twinTick: (b) => post('/api/twin/tick', b)`。

`prepareCpuTrace`/`prepareMemoryTrace` 等「离线 trace 预备」逻辑在整拍模型下不再驱动调度，保留但不再于 `start()` 调用（避免误导）；或在 Phase 1 末清理为实验页所用。

### 4.5 Phase 1 测试

- **后端 pytest** `tests/test_twin_engine.py`：
  - PRNG parity 固定向量（与前端硬编码期望一致）。
  - 单拍推进若干不变量：时钟+1、完成进程回收资源/内存、缺页入队、RR 时间片到期让出、指标范围合法。
  - 用固定 `SimState` 跑 N 拍快照断言（回归锚点）。
- **前后端 parity**：`tests/fixtures/twin_states.json` 固定初始态；后端跑 30 拍存 `expected`；前端 `npm` 脚本（或 vitest，如引入）跑同初始态同 PRNG 比对（无 JS 测试框架时，用 `frontend/scripts/twin_parity.mjs` Node 脚本 import `localTick` 跑同样 30 拍，与 `expected.json` 逐拍 deep-equal）。
- **preview 实测**：开后端运行孪生→`backendMode=backend`、网络面板见逐拍 `/api/twin/tick`；停后端→自动切本地、出降级事件、仿真不卡。

---

## 5. Phase 2 — 实验页本地兜底

### 5.1 抽出共享 JS 引擎

新增 `frontend/src/mock/engines/`，把 `driver.js` 内现有本地实现抽成**纯函数、返回 `SimulationTrace` 同形**，供「实验页兜底」与「driver 本地整拍」共用（DRY）：
- `scheduling.js`（移自 `localSchedulingTrace`）
- `paging.js`（移自 `localPagingTrace`；并提供 `MemoryEngine` 等价 JS 类供整拍本地用）
- `disk.js`（移自 `serveDisk` 本地分支 + 提供整段 `run` 形态）
- `banker.js`（移自 `localSafety`/`localBankerRequest`）
- `sync.js`（PV 批处理，移植 `sync_engine.run` 语义）

返回结构与 `backend/app/schemas/common.py` 的 `SimulationTrace` 一致（`module,algorithm,input_echo,steps,metrics,final_state`）。

### 5.2 视图降级

五个视图（`JobScheduling/DiskScheduling/PageReplacement/ResourceAllocation/ProcessSync`）的 `run()`：

```
try { trace = await api.X(payload) }
catch (e) {
  trace = engines.X(payload)              // 本地等价
  ElMessage.warning('后端不可用，已用本地算法降级')
  localFallback.value = true              // 视图角标「本地降级」
}
```

`PageReplacement` 的 `pagingTranslate` 同法本地化（纯地址转换，移植 `paging_engine.translate`）。

### 5.3 Phase 2 测试

- 每个 JS 引擎对 1~2 个固定输入，断言 `metrics`/`final_state` 与后端同输入一致（parity）。
- preview：停后端 → 各实验页点「运行」→ 出结果 + 降级提示（不白屏）。

---

## 6. Phase 3 — 正确性审计（目标语义 + 已发现分歧）

逐算法**对照教科书语义**统一前后端口径。下表为审计结论与修正点；实现时落到对应引擎并补测试。

### 6.1 作业/进程调度
**目标语义**：FCFS（按到达，非抢占）；SJF（非抢占，最短**服务时间**，tie→到达→idx）；HRRN（非抢占，响应比 `R=(等待+服务)/服务`，每次空闲重算）；PRIORITY（非抢占，**数值小=优先级高**，缺省 99）；RR（抢占，时间片 `q`，新到达先入队再回插被抢占者）。
**分歧/修正**：
- 孪生 `applyCpuTrace` 的 SJF 用 `burst-ran`（剩余时间，偏 SRTF）→ 统一为**总服务时间**非抢占口径（与 `scheduling_engine` 一致）。
- 孪生挑选 key 抽成与 `scheduling_engine._key` 同源的判定（HRRN/PRIORITY/tie-break 一致）。
- 后端 `_round_robin` 空闲间隙、PRIORITY 缺省 99（本分支已修，保留并补测）。

### 6.2 页面置换
**目标语义**：FIFO（装入时刻最早）；LRU（最近使用最旧）；OPT（未来最久不用，按**该进程自身** `refString`+`refPtr`）；CLOCK（访问位 + 指针，命中置 1、缺页扫描清 0 直到遇 0）。**写位**统一启发式 `is_write = ((page + 访问序号) % 5) < 2`。
**分歧/修正**：
- 写位三处口径不一：后端 `run` 用 `(page+i)%5`、孪生 `applyMemoryStep` 用 `os.clock`、`loadPageAfterDiskIo` 用 `page%2` → 统一为「`page + 该进程访存序号`」，装入页修改位由本次 `is_write` 决定（删除 `page%2`）。
- 孪生分页统一走 `MemoryEngine`（后端）/等价 JS（本地），不再各写一份置换。
- `seedState` warm-fill 的 `修改位=p%2` 属**初始演示数据**非算法，保留。

### 6.3 磁盘移臂调度
**目标语义**：FCFS；SSTF（最近柱面，tie→小号）；SCAN（沿向到**物理端点**再折返）；C-SCAN（到端点→复位另一端→单向）；LOOK（到该向**最远请求**即折返）；C-LOOK（到最远请求→跳回最近请求）。寻道计费含端点折返/复位移动。
**分歧/修正**：
- 孪生 `serveDisk` 本地兜底为「逐次选择」式，需与后端 `_waypoints` 顺序**逐拍一致**（含 SCAN/C-SCAN 端点、C-LOOK 跳回）→ 本地兜底改用 `mock/engines/disk.js` 移植 `_seek_order` 的单步形态。
- 方向/折返累计寻道与后端对齐（本分支已部分修，补 parity 测试覆盖 SCAN/C-SCAN/LOOK/C-LOOK）。

### 6.4 银行家算法
**目标语义**：安全性多趟扫描求安全序列；请求算法 `Request≤Need ∧ Request≤Available` → 试探分配 → 安全则提交否则回滚。
**分歧/修正**：FE/BE 已基本对齐；`_reject` 返回全量 `Available/Max/Allocation/Need/安全序列/死锁进程`（本分支已修）。补：FE `localSafety`/`localBankerRequest` 与后端**同输入同序列**的 parity 测试。

### 6.5 进程同步（PV）
**目标语义**：计数信号量 `P(s):s--; s<0 阻塞入队`、`V(s):s++; s<=0 唤醒队首`；生产者 `P(s1)→P(mutex)→放→V(mutex)→V(s2)`，消费者 `P(s2)→P(mutex)→取→V(mutex)→V(s1)`。
**分歧/修正**：
- 后端 `sync_engine.run` 是**批处理**、孪生 `pvProduce/pvConsume` 是**增量**——抽出**共享 PV 原语**（`p_op/v_op` + 生产/消费半段），`sync_engine.run`（实验页批处理）与 `twin_engine`（孪生增量）**共用同一原语**，消除两套语义。
- 唤醒后半段（被唤醒者补做 `P(mutex)→临界区→V`）两路一致。

### 6.6 审计测试
`tests/test_algorithm_parity.py`：对每模块固定输入，断言**后端引擎**与**孪生 twin_engine 内复用路径**结果一致；前端侧由 Phase 1/2 的 JS parity 脚本覆盖。

---

## 7. 错误处理与降级语义

- **孪生**：每拍 `/api/twin/tick` 失败（网络/4xx/5xx）→ `backendMode='local'` + 一次性 warning 事件 + `localTick`；`checkBackend` 探活恢复 → 切回 `backend` + 提示。整段运行不中断。
- **实验页**：`api.X` 失败 → 本地引擎出结果 + `ElMessage.warning` + 角标；后端恢复后下次运行自动走后端。
- **后端 twin tick** 入参非法 → 400 + `detail`，前端按失败回退本地（不崩）。
- 既有 `/api/memory/access`、`/api/disk` 等单点接口在整拍模型下由 `twin_engine` 内部直接调用引擎，不再经 HTTP 自调用。

## 8. 测试策略总览

- **后端 pytest**：现有 100+ 项保持全绿；新增 `test_twin_engine`、`test_algorithm_parity`、PRNG 向量、各引擎语义修正用例。
- **前后端 parity**：固定初始态 + 同 PRNG，后端导出 `expected.json`，前端 Node 脚本 `localTick` 比对（无现成 JS 测试框架；如愿引入 vitest 可升级）。
- **preview 实测**：孪生后端/断网两态切换；五实验页断网降级。
- **回归**：`docs/接口契约.md` 字段形状不变——所有页面零改动验证。

## 9. 影响面 / 文件清单

**后端（新增/改）**
- 新：`app/engines/rng.py`、`app/engines/twin_engine.py`、`app/api/twin.py`、`app/schemas/twin.py`
- 改：`main.py`（注册 twin）、`app/engines/sync_engine.py`（抽 PV 原语共享）、`app/engines/scheduling_engine.py`/`paging_engine.py`/`disk_engine.py`/`banker_engine.py`（审计修正，多数已在本分支）
- 测试：`tests/test_twin_engine.py`、`tests/test_algorithm_parity.py`、补各引擎用例

**前端（新增/改）**
- 新：`src/mock/rng.js`、`src/mock/engines/{scheduling,paging,disk,banker,sync}.js`、`scripts/twin_parity.mjs`
- 改：`src/mock/driver.js`（拆 `localTick`、整拍降级、`os.scheduler`、PRNG）、`src/mock/seed.js`（PRNG 化、`rngState`、`scheduler` 初值）、`src/store/os.js`（`scheduler` 状态 + `applySim` 辅助）、`src/api/client.js`（`twinTick`）、五个实验页 `views/*.vue`（本地降级）

**契约**：`store/os.js` 字段形状**不改名**；`docs/接口契约.md` 增补「整拍端点」一节（替换原 mock→real 表为整拍权威说明）。

## 10. 验收标准

- **有后端**：孪生运行时网络面板逐拍见 `/api/twin/tick`，`backendMode=backend`；五实验页走后端出结果。
- **断后端**：孪生自动切本地整拍并出降级事件、仿真连续不卡；五实验页本地降级出结果 + 提示，不白屏；恢复后自动切回后端。
- **可复现**：同初始态（同 `rngState`）连续两次运行逐拍结果一致。
- **parity**：后端与前端本地引擎对固定初始态 30 拍逐拍 deep-equal 通过；五实验页本地与后端同输入结果一致。
- **正确性**：六类算法对照教科书语义的用例全绿（含 SCAN/C-SCAN 端点、HRRN 响应比、RR 时间片、OPT 未来引用、PV 阻塞/唤醒、银行家不安全拒绝）。
- 后端测试套件（现有 + 新增）全绿。

## 11. 风险与权衡

- **双实现维护成本**：算法在 Python（权威）与 JS（兜底）各一份——这是「后端权威 + 离线降级」的固有代价，用户已接受。以 parity 测试 + 确定性 PRNG 把"两份必须一致"变成**可自动检测**，降低漂移风险。
- **每拍一次 HTTP**：本地单用户、tick 间隔 ≥120ms，开销可接受；失败即回退本地，无阻塞。
- **PRNG 逐位一致**：mulberry32 依赖 32 位回绕/`Math.imul`，FE/BE 须严格对齐——首条 parity 向量测试守住。
- **状态序列化体量**：每拍传完整 SimState（含各进程页表）。教学规模（≤十几进程）payload 数 KB，可接受；`events`/`history` 不回传已削减体量。
- **行为变化：仿真变确定**。原 `Math.random()` 带来的"每次不同"消失——对教学/复现是正收益，但与旧观感不同，需在 PR 说明。
- **范围大**：三期一份 spec，但实现按 Phase 1→2→3 顺序推进、各自可独立验证与提交，便于分批 review。
