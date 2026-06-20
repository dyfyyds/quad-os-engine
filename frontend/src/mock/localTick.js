// 前端离线整拍引擎 + SimState 序列化契约。
//
// 本文件分两部分：
//   1) 序列化契约 serializeSim/applySim —— 决定哪些字段进后端 round-trip。
//   2) 纯函数 seedSim/localTick —— 不触 store、不调后端、不用 Math.random（用种子 PRNG）。
//      它既是后端不可用时的离线兜底，又是前后端 parity 的 JS 参照（oracle）。
//
// 与原 driver.js tick() 逐字对齐：os→state、os.pushEvent→events.push、
// Math.random→rng、模块级调度变量→state.scheduler、后端调用剥离为本地等价分支。
import { makeRng } from './rng.js'
import { seedState } from './seed.js'

// —— SimState 序列化契约 ——————————————————————————————————————
// 仅这些顶层字段参与后端 round-trip；其余（events/history）为 UI-only，不传。
export const SIM_FIELDS = [
  'clock', 'rngState', 'nextPid', 'gantt', 'scheduler',
  'processes', 'memory', 'resources', 'sync', 'disk', 'metrics', 'config',
]

// memory 内的 UI-only 子字段，不进 round-trip（后端不关心、且会被重置）。
const MEMORY_UI_ONLY = ['backendMode', 'backendError', 'pagingTrace', 'traceCursor']

// 从完整 store 状态抽出可序列化 SimState（深拷贝，剔除 UI-only）。
export function serializeSim(state) {
  const out = {}
  for (const k of SIM_FIELDS) out[k] = state[k]
  const sim = JSON.parse(JSON.stringify(out))
  for (const k of MEMORY_UI_ONLY) delete sim.memory[k]
  return sim
}

// 把后端返回的 SimState 套回 target（保留 target.memory 的 UI-only 子字段）。
export function applySim(target, sim) {
  for (const k of SIM_FIELDS) {
    if (k === 'memory') {
      const ui = {}
      for (const u of MEMORY_UI_ONLY) ui[u] = target.memory[u]
      target.memory = { ...sim.memory, ...ui }
    } else {
      target[k] = sim[k]
    }
  }
}

// —— 常量 ——————————————————————————————————————————————————————
const JOB_NAMES = ['gcc', 'vim', 'sync', 'cron', 'http', 'db']
const DISK_BUSY_WINDOW = 10
const IO_PROB = {
  vim: 0.25, http: 0.20, db: 0.25, sync: 0.15,
  cron: 0.03, gcc: 0.03, init: 0.01, shell: 0.05,
  logger: 0.10, daemon: 0.08, default: 0.08,
}

// —— 小工具 ————————————————————————————————————————————————————
const findRunning = (s) => s.processes.find((p) => p.state === '运行') || null

function clampIndex(n, len) {
  return len ? ((n % len) + len) % len : 0
}

function vecLe(a, b) {
  return a.every((x, j) => x <= b[j])
}

const calcNeed = (max, alloc) => max.map((row, i) => row.map((v, j) => v - alloc[i][j]))

function translateProcessNames(state, list) {
  return (list || []).map((name) => {
    const match = String(name).match(/^P(\d+)$/)
    if (match) {
      const idx = parseInt(match[1])
      return state.processes[idx]?.name || name
    }
    return name
  })
}

function findFrameOwner(state, slot) {
  for (const p of state.processes) {
    if (p.pageTable) {
      const pageIndex = p.pageTable.findIndex((row) => row.标志 === 1 && row.主存块号 === slot)
      if (pageIndex >= 0) {
        return { proc: p, pageRow: p.pageTable[pageIndex] }
      }
    }
  }
  return null
}

function getIoProb(name) {
  const prefix = name.replace(/\d+$/, '')
  return IO_PROB[prefix] ?? IO_PROB.default
}

// 按当前就绪/运行集初始化 RR 轮转队列与时间片计数（每轮首拍调用）。
function seedScheduler(state) {
  state.scheduler.rrQueue = state.processes
    .filter((p) => p.state === '就绪')
    .sort((a, b) => (a.arrival - b.arrival) || (a.pid - b.pid))
    .map((p) => p.pid)
  state.scheduler.currentPid = state.processes.find((p) => p.state === '运行')?.pid ?? null
  state.scheduler.quantumUsed = 0
}

// ———————————————————————— 处理机：运行时动态调度 + I/O 唤醒协调 ————————————————————————
function applyCpuTrace(state, push) {
  const time = state.clock
  const sch = state.scheduler

  // —— I/O 完成协调器 ——
  const queueNames = new Set(state.disk.queue.map((r) => r.进程名))
  const justUnblocked = new Set()
  for (let i = state.disk.ioBlocked.length - 1; i >= 0; i--) {
    const name = state.disk.ioBlocked[i]
    if (!queueNames.has(name)) {
      state.disk.ioBlocked.splice(i, 1)
      const proc = state.processes.find((p) => p.name === name)
      if (proc && proc.state === '阻塞') {
        proc.state = '就绪'
        proc.blockedReason = ''
        proc.pageWaitingFor = null
        proc.blockedAt = null
        justUnblocked.add(name)
        push('I/O完成', 'device', 'info', `${name} I/O 完成 → 解除阻塞，重新加入就绪队列`)
        if (state.config.schedAlgo === 'RR') {
          if (!sch.rrQueue.includes(proc.pid)) sch.rrQueue.push(proc.pid)
        }
      }
    }
  }

  // 第一轮：新建 → 就绪，服务时间到完成
  state.processes.forEach((p) => {
    if (p.ran >= p.burst && p.burst > 0) {
      if (p.state !== '完成') {
        p.state = '完成'
        p.finishTime = time
        push('进程完成', 'processor', 'info', `${p.name}(P${p.pid}) 服务时间用尽 → 完成`)

        // 释放其持有的所有银行家算法资源
        const r = state.resources
        const idx = state.processes.findIndex((x) => x.pid === p.pid)
        if (idx >= 0) {
          const alloc = r.allocation[idx]
          if (alloc.some((v) => v > 0)) {
            r.available = r.available.map((v, j) => v + alloc[j])
            r.allocation[idx] = alloc.map(() => 0)
            r.need[idx] = r.max[idx].map(() => 0)
            push('资源释放', 'resource', 'info', `${p.name} 完成，回收全部持有的资源 [${alloc}]`)
            refreshBankerSafety(state, push, false)
          }
        }

        // 释放其持有的所有物理内存块，更新页表
        state.memory.frames = state.memory.frames.map((framePage, slot) => {
          if (framePage !== null) {
            const pageIndex = p.pageTable.findIndex((row) => row.标志 === 1 && row.主存块号 === slot)
            if (pageIndex >= 0) {
              p.pageTable[pageIndex].标志 = 0
              p.pageTable[pageIndex].主存块号 = null
              p.pageTable[pageIndex].访问位 = 0
              p.pageTable[pageIndex].修改位 = 0
              return null
            }
          }
          return framePage
        })
        push('内存释放', 'memory', 'info', `${p.name} 完成，释放其占用的物理内存页框`)
      }
    } else if (time < p.arrival) {
      p.state = '新建'
    } else if (p.state === '新建' && time >= p.arrival) {
      p.state = '就绪'
      if (state.config.schedAlgo === 'RR') {
        if (!sch.rrQueue.includes(p.pid)) sch.rrQueue.push(p.pid)
      }
      push('作业就绪', 'processor', 'info', `${p.name}(P${p.pid}) 到达 → 进入就绪队列`)
    }
  })

  // 第二轮：动态调度逻辑（时间片/抢占）
  const currentRunning = state.processes.find((p) => p.state === '运行')
  if (currentRunning) {
    if (currentRunning.ran >= currentRunning.burst) {
      sch.currentPid = null
      sch.quantumUsed = 0
    } else if (state.config.schedAlgo === 'RR' && sch.quantumUsed >= state.config.quantum) {
      currentRunning.state = '就绪'
      if (!sch.rrQueue.includes(currentRunning.pid)) sch.rrQueue.push(currentRunning.pid)
      push('进程抢占', 'processor', 'info', `${currentRunning.name} 时间片到，让出 CPU 回就绪队列`)
      sch.currentPid = null
      sch.quantumUsed = 0
    } else {
      sch.quantumUsed++
    }
  }

  // 调度核心：当前无运行进程则从就绪队列挑选
  const runningNow = state.processes.find((p) => p.state === '运行')
  if (!runningNow) {
    const readyProcs = state.processes.filter((p) => p.state === '就绪' && !justUnblocked.has(p.name))
    if (readyProcs.length > 0) {
      let chosen = null
      const algo = state.config.schedAlgo

      if (algo === 'FCFS') {
        chosen = readyProcs.sort((a, b) => a.arrival - b.arrival || a.pid - b.pid)[0]
      } else if (algo === 'SJF') {
        chosen = readyProcs.sort((a, b) => (a.burst - a.ran) - (b.burst - b.ran) || a.arrival - b.arrival || a.pid - b.pid)[0]
      } else if (algo === 'HRRN') {
        const getRatio = (p) => {
          const wait = Math.max(0, time - p.arrival)
          const service = p.burst
          return (wait + service) / Math.max(1, service)
        }
        chosen = readyProcs.sort((a, b) => getRatio(b) - getRatio(a) || a.pid - b.pid)[0]
      } else if (algo === 'PRIORITY') {
        chosen = readyProcs.sort((a, b) => a.priority - b.priority || a.arrival - b.arrival || a.pid - b.pid)[0]
      } else if (algo === 'RR') {
        let foundPid = null
        for (const pid of sch.rrQueue) {
          if (readyProcs.some((c) => c.pid === pid)) { foundPid = pid; break }
        }
        if (foundPid !== null) {
          chosen = readyProcs.find((c) => c.pid === foundPid)
          sch.rrQueue = sch.rrQueue.filter((pid) => pid !== foundPid)
        } else {
          chosen = readyProcs.sort((a, b) => a.arrival - b.arrival || a.pid - b.pid)[0]
        }
      } else {
        chosen = readyProcs[0]
      }

      if (chosen) {
        chosen.state = '运行'
        sch.currentPid = chosen.pid
        sch.quantumUsed = 1
        push('进程调度', 'processor', 'info', `${chosen.name}(P${chosen.pid}) 占用 CPU`)
      }
    }
  }

  // MMU 上下文切换
  const activeProc = state.processes.find((p) => p.state === '运行')
  if (activeProc) {
    state.memory.pageTable = activeProc.pageTable.map((row) => ({ ...row }))
    state.memory.lastReplace = { ...activeProc.lastReplace }
    state.memory.hits = activeProc.hits
    state.memory.faults = activeProc.faults
  }

  // 指标聚合
  const doneProcs = state.processes.filter((p) => p.state === '完成')
  state.metrics.completed = doneProcs.length
  state.metrics.readyLen = state.processes.filter((p) => p.state === '就绪').length
  state.metrics.blockedLen = state.processes.filter((p) => p.state === '阻塞').length
  state.metrics.throughput = +(doneProcs.length / Math.max(1, time)).toFixed(2)
  const turnarounds = doneProcs.map((p) => (p.finishTime ?? time) - p.arrival)
  state.metrics.avgTurnaround = turnarounds.length
    ? +(turnarounds.reduce((s, t) => s + t, 0) / turnarounds.length).toFixed(2)
    : 0

  return state.processes.find((p) => p.state === '运行') || null
}

function onCpuDiskRequest(state, runningProc, rng, push) {
  const d = state.disk
  if (d.queue.length >= 8) return
  if (rng.next() >= getIoProb(runningProc.name)) return

  const req = makeRequest(state)
  if (runningProc) req.进程名 = runningProc.name
  d.queue.push(req)

  if (runningProc && !d.ioBlocked.includes(runningProc.name)) {
    d.ioBlocked.push(runningProc.name)
    runningProc.state = '阻塞'
    runningProc.blockedReason = `等待磁盘 I/O - 柱面 ${req.柱面号} 磁道 ${req.磁道号} 记录 ${req.物理记录号}`
  }
  push('I/O请求', 'device', 'info',
    `${req.进程名} 发起 I/O → 进入阻塞态：柱面 ${req.柱面号}/磁道 ${req.磁道号}/记录 ${req.物理记录号}`)
}

// ———————————————————————— 存储：运行时访存 + 缺页装入置换 ————————————————————————
function applyMemoryStep(state, push) {
  const runningProc = findRunning(state)
  if (!runningProc) return

  const refs = runningProc.refString
  const stepIdx = runningProc.refPtr % refs.length
  const page = refs[stepIdx]
  runningProc.refPtr++

  const hit = runningProc.pageTable[page]?.标志 === 1
  const now = state.clock
  const blockSize = state.config.blockSize || 128
  const unit = (page * 31 + now * 17) % blockSize

  if (hit) {
    runningProc.hits++
    runningProc.pageTable[page].lastUsed = now
    if (state.config.pageAlgo === 'CLOCK') runningProc.pageTable[page].访问位 = 1
    const willWrite = ((page + now) % 5) < 2
    if (willWrite) runningProc.pageTable[page].修改位 = 1
    const slot = runningProc.pageTable[page].主存块号
    const absAddr = slot * blockSize + unit

    runningProc.lastReplace = {
      访问页: page, 单元号: unit, 缺页: false,
      调出页: null, 装入页: null, 装入块: null, 写回: false,
      绝对地址: absAddr,
    }

    state.memory.hits = runningProc.hits
    state.memory.refPtr = runningProc.refPtr
    state.memory.pageTable = runningProc.pageTable.map((row) => ({ ...row }))
    state.memory.lastReplace = { ...runningProc.lastReplace }
  } else {
    const exists = state.disk.queue.some((r) => r.进程名 === runningProc.name && r.isPageFault && r.page === page)
    if (!exists) {
      runningProc.state = '阻塞'
      runningProc.blockedReason = `缺页中断: 等待装入页 ${page}`
      runningProc.pageWaitingFor = page
      runningProc.blockedAt = now

      if (!state.disk.ioBlocked.includes(runningProc.name)) state.disk.ioBlocked.push(runningProc.name)

      state.disk.queue.push({
        进程名: runningProc.name,
        柱面号: (page * 31) % state.disk.cylinders,
        磁道号: 0,
        物理记录号: 0,
        isPageFault: true,
        page: page,
        unit: unit,
      })

      runningProc.lastReplace = {
        访问页: page, 单元号: unit, 缺页: true,
        调出页: null, 装入页: null, 装入块: null, 写回: false,
        绝对地址: null,
      }
      state.memory.lastReplace = { ...runningProc.lastReplace }

      push('缺页中断', 'memory', 'warning',
        `访问 [页 ${page} 单元 ${unit}] 缺页 —— 向磁盘队列发送读入请求，${runningProc.name} 进入阻塞`)
    }
  }
}

function loadPageAfterDiskIo(state, req, push) {
  const p = state.processes.find((x) => x.name === req.进程名)
  if (!p) return

  const page = req.page
  const unit = req.unit !== undefined ? req.unit : ((page * 31 + state.clock * 17) % (state.config.blockSize || 128))
  const algo = state.config.pageAlgo || 'LRU'
  const frameCount = state.memory.frameCount

  let slot = state.memory.frames.indexOf(null)
  let evicted = null
  let wroteBack = false

  if (slot >= 0) {
    p.pageTable[page].标志 = 1
    p.pageTable[page].主存块号 = slot
    p.pageTable[page].loadTime = state.clock
    p.pageTable[page].lastUsed = state.clock
    p.pageTable[page].访问位 = 1
    p.pageTable[page].修改位 = page % 2
    state.memory.frames[slot] = page
  } else {
    if (algo === 'FIFO') {
      let minLoad = Infinity
      let chosen = 0
      for (let k = 0; k < frameCount; k++) {
        const owner = findFrameOwner(state, k)
        const loadTime = owner ? owner.pageRow.loadTime : -1
        if (loadTime < minLoad) { minLoad = loadTime; chosen = k }
      }
      slot = chosen
    } else if (algo === 'CLOCK') {
      let hand = state.memory.clockPtr || 0
      let found = false
      let loops = 0
      while (!found && loops < 100) {
        const owner = findFrameOwner(state, hand)
        if (!owner || owner.pageRow.访问位 === 0) {
          slot = hand
          found = true
        } else {
          owner.pageRow.访问位 = 0
          hand = (hand + 1) % frameCount
        }
        loops++
      }
      state.memory.clockPtr = (hand + 1) % frameCount
      slot = slot ?? 0
    } else if (algo === 'OPT') {
      let maxNext = -1
      let chosen = 0
      for (let k = 0; k < frameCount; k++) {
        const owner = findFrameOwner(state, k)
        if (!owner) { chosen = k; break }
        const start = owner.proc.refPtr
        const refs = owner.proc.refString
        let nextUse = Infinity
        for (let idx = start; idx < refs.length; idx++) {
          if (refs[idx] === owner.pageRow.页号) { nextUse = idx - start; break }
        }
        if (nextUse > maxNext) { maxNext = nextUse; chosen = k }
      }
      slot = chosen
    } else { // LRU
      let minUsed = Infinity
      let chosen = 0
      for (let k = 0; k < frameCount; k++) {
        const owner = findFrameOwner(state, k)
        const lastUsed = owner ? owner.pageRow.lastUsed : -1
        if (lastUsed < minUsed) { minUsed = lastUsed; chosen = k }
      }
      slot = chosen
    }

    const owner = findFrameOwner(state, slot)
    if (owner) {
      evicted = owner.pageRow.页号
      wroteBack = owner.pageRow.修改位 === 1
      owner.pageRow.标志 = 0
      owner.pageRow.主存块号 = null
      owner.pageRow.访问位 = 0
      owner.pageRow.修改位 = 0
    }

    p.pageTable[page].标志 = 1
    p.pageTable[page].主存块号 = slot
    p.pageTable[page].loadTime = state.clock
    p.pageTable[page].lastUsed = state.clock
    p.pageTable[page].访问位 = 1
    p.pageTable[page].修改位 = 0
    state.memory.frames[slot] = page
  }

  p.faults++
  p.lastReplace = {
    访问页: page, 单元号: unit, 缺页: true,
    调出页: evicted, 装入页: page, 装入块: slot, 写回: wroteBack,
    绝对地址: slot * (state.config.blockSize || 128) + unit,
  }

  state.memory.pageTable = p.pageTable.map((row) => ({ ...row }))
  state.memory.lastReplace = { ...p.lastReplace }
  state.memory.faults = p.faults

  const detail = evicted === null
    ? `装入物理块 ${slot}`
    : `调出页 ${evicted}${wroteBack ? '(已修改,写回外存)' : ''}，装入页 ${page} → 物理块 ${slot}`

  push('缺页装入', 'memory', 'info', `缺页处理完成: 页 ${page} 已装入 —— ${detail}`)
}

// ———————————————————————— 设备：磁盘移臂调度（本地等价，与后端 _waypoints 对齐）————————————————————————
function recordDiskBusy(state, processName, serviceTime) {
  const d = state.disk
  const normalized = Math.max(1, Number(serviceTime) || 1)
  const start = Math.max(state.clock, d.busyUntil || 0)
  const end = start + normalized
  d.busyUntil = end
  d.busyLog.push({ start, end, serviceTime: normalized, processName })
  const keepFrom = state.clock - DISK_BUSY_WINDOW * 3
  d.busyLog = d.busyLog.filter((seg) => seg.end >= keepFrom)
}

function recomputeDiskBusyRate(state) {
  const d = state.disk
  const windowEnd = state.clock
  const windowStart = windowEnd - DISK_BUSY_WINDOW
  const busyTime = d.busyLog.reduce((sum, seg) => {
    const overlap = Math.max(0, Math.min(seg.end, windowEnd) - Math.max(seg.start, windowStart))
    return sum + overlap
  }, 0)
  d.busyRate = Math.min(100, Math.round((busyTime / DISK_BUSY_WINDOW) * 100))
  d.busyLog = d.busyLog.filter((seg) => seg.end >= windowStart)
}

function serveDisk(state, push) {
  const d = state.disk
  if (!d.queue.length || d.activeRequest) return

  let chosenIdx = 0
  const algo = state.config.diskAlgo
  let seek = 0

  if (algo === 'SSTF') {
    let minDist = Infinity
    d.queue.forEach((r, idx) => {
      const dist = Math.abs(r.柱面号 - d.head)
      if (dist < minDist) { minDist = dist; chosenIdx = idx }
    })
    seek = Math.abs(d.queue[chosenIdx].柱面号 - d.head)
  } else if (algo === 'LOOK') {
    const dir = d.direction || 1
    let bestIdx = -1
    let bestDist = Infinity
    d.queue.forEach((r, idx) => {
      const dist = r.柱面号 - d.head
      if ((dir > 0 && dist >= 0) || (dir < 0 && dist <= 0)) {
        const absDist = Math.abs(dist)
        if (absDist < bestDist) { bestDist = absDist; bestIdx = idx }
      }
    })
    if (bestIdx >= 0) {
      chosenIdx = bestIdx
    } else {
      d.direction = -dir
      let minDist = Infinity
      d.queue.forEach((r, idx) => {
        const dist = Math.abs(r.柱面号 - d.head)
        if (dist < minDist) { minDist = dist; chosenIdx = idx }
      })
    }
    seek = Math.abs(d.queue[chosenIdx].柱面号 - d.head)
  } else if (algo === 'SCAN') {
    const dir = d.direction || 1
    let bestIdx = -1
    let bestDist = Infinity
    d.queue.forEach((r, idx) => {
      const dist = r.柱面号 - d.head
      if ((dir > 0 && dist >= 0) || (dir < 0 && dist <= 0)) {
        const absDist = Math.abs(dist)
        if (absDist < bestDist) { bestDist = absDist; bestIdx = idx }
      }
    })
    if (bestIdx >= 0) {
      chosenIdx = bestIdx
      seek = Math.abs(d.queue[chosenIdx].柱面号 - d.head)
    } else {
      d.direction = -dir
      let minDist = Infinity
      d.queue.forEach((r, idx) => {
        const dist = Math.abs(r.柱面号 - d.head)
        if (dist < minDist) { minDist = dist; chosenIdx = idx }
      })
      const target = d.queue[chosenIdx].柱面号
      if (dir > 0) {
        seek = (d.cylinders - 1 - d.head) + (d.cylinders - 1 - target)
      } else {
        seek = d.head + target
      }
    }
  } else if (algo === 'C-LOOK') {
    d.direction = 1
    let bestIdx = -1
    let bestVal = Infinity
    d.queue.forEach((r, idx) => {
      if (r.柱面号 >= d.head && r.柱面号 < bestVal) { bestVal = r.柱面号; bestIdx = idx }
    })
    if (bestIdx >= 0) {
      chosenIdx = bestIdx
      seek = Math.abs(d.queue[chosenIdx].柱面号 - d.head)
    } else {
      let minVal = Infinity
      let minIdx = 0
      d.queue.forEach((r, idx) => {
        if (r.柱面号 < minVal) { minVal = r.柱面号; minIdx = idx }
      })
      chosenIdx = minIdx
      seek = d.head - d.queue[chosenIdx].柱面号
    }
  } else if (algo === 'C-SCAN') {
    d.direction = 1
    let bestIdx = -1
    let bestVal = Infinity
    d.queue.forEach((r, idx) => {
      if (r.柱面号 >= d.head && r.柱面号 < bestVal) { bestVal = r.柱面号; bestIdx = idx }
    })
    if (bestIdx >= 0) {
      chosenIdx = bestIdx
      seek = Math.abs(d.queue[chosenIdx].柱面号 - d.head)
    } else {
      let minVal = Infinity
      let minIdx = 0
      d.queue.forEach((r, idx) => {
        if (r.柱面号 < minVal) { minVal = r.柱面号; minIdx = idx }
      })
      chosenIdx = minIdx
      seek = (d.cylinders - 1 - d.head) + d.queue[chosenIdx].柱面号
    }
  } else {
    chosenIdx = 0
    seek = Math.abs(d.queue[chosenIdx].柱面号 - d.head)
  }

  const req = d.queue[chosenIdx]
  const serviceTime = Math.max(2, Math.round(seek / 10) + 1)

  d.head = req.柱面号
  if (algo === 'C-SCAN' || algo === 'C-LOOK') {
    d.direction = 1
  } else {
    d.direction = req.柱面号 >= d.head ? 1 : -1
  }
  d.path.push(d.head)
  if (d.path.length > 30) d.path.shift()

  d.activeRequest = {
    ...req, seek, serviceTime,
    startTime: state.clock, finishTime: state.clock + serviceTime,
  }

  recordDiskBusy(state, req.进程名, serviceTime)
  push('设备调度', 'device', 'info',
    `本地磁盘选中 ${req.进程名} 请求 (柱面 ${req.柱面号})，开始移动磁头，预计耗时 ${serviceTime} 拍`)
}

function makeRequest(state) {
  const d = state.disk
  const running = findRunning(state)
  const pid = running?.pid || state.nextPid || 1
  const t = state.clock
  return {
    进程名: running?.name || `job${pid}`,
    柱面号: (pid * 37 + t * 11 + d.served * 5) % d.cylinders,
    磁道号: (pid + t + d.queue.length) % d.tracksPerCyl,
    物理记录号: (pid * 3 + t + d.currentRecord) % d.recordsPerTrack,
  }
}

// ———————————————————————— 资源：银行家算法（本地等价）————————————————————————
function localSafety(state, available, max, allocation) {
  const n = allocation.length
  const m = available.length
  const need = calcNeed(max, allocation)
  const work = [...available]
  const finish = new Array(n).fill(false)
  const seq = []
  let changed = true
  while (changed) {
    changed = false
    for (let i = 0; i < n; i++) {
      if (!finish[i] && vecLe(need[i], work)) {
        for (let j = 0; j < m; j++) work[j] += allocation[i][j]
        finish[i] = true
        seq.push(state.processes[i]?.name || `P${i}`)
        changed = true
      }
    }
  }
  const safe = finish.every(Boolean)
  const deadlock = finish.map((f, i) => (f ? null : (state.processes[i]?.name || `P${i}`))).filter(Boolean)
  return {
    metrics: { 安全: safe, 安全序列: safe ? seq : null },
    final_state: { Available: [...available], Max: max, Allocation: allocation, Need: need, 安全序列: safe ? seq : [], 死锁进程: deadlock },
  }
}

function localBankerRequest(state, r, pid, req) {
  const need = r.need
  if (!vecLe(req, need[pid])) return { metrics: { 可分配: false, 原因: `请求超过进程最大需求`, 安全: false }, final_state: { Need: need, Available: [...r.available] } }
  if (!vecLe(req, r.available)) return { metrics: { 可分配: false, 原因: `资源不足，请求 ${req} > 可用 ${r.available}，须等待`, 安全: false }, final_state: { Need: need, Available: [...r.available] } }
  const newAvail = r.available.map((v, j) => v - req[j])
  const newAlloc = r.allocation.map((row, i) => (i === pid ? row.map((v, j) => v + req[j]) : [...row]))
  const safety = localSafety(state, newAvail, r.max, newAlloc)
  const safe = safety.metrics.安全
  return {
    metrics: { 可分配: safe, 原因: safe ? `试探分配后系统安全，立即分配` : `试探分配后进入不安全状态，拒绝本次请求`, 安全: safe },
    final_state: {
      Available: safe ? newAvail : [...r.available],
      Allocation: safe ? newAlloc : r.allocation,
      Need: safe ? safety.final_state.Need : need,
      安全序列: safe ? safety.final_state.安全序列 : [],
      死锁进程: safety.final_state.死锁进程,
    },
  }
}

function refreshBankerSafety(state, push, announce = true) {
  const r = state.resources
  const trace = localSafety(state, r.available, r.max, r.allocation)
  const safe = trace.metrics.安全
  r.safeSeq = translateProcessNames(state, trace.final_state.安全序列 || [])
  r.deadlock = !safe
  if (announce) {
    if (safe) push('安全性检查', 'resource', 'info', `银行家安全性检查通过，安全序列 ${r.safeSeq.join(',')}`)
    else push('死锁告警', 'resource', 'danger', `系统不安全！死锁挂起进程 ${translateProcessNames(state, trace.final_state.死锁进程 || []).join(',')}`)
  }
}

function serveBankerRequest(state, proc, push) {
  if (!proc) return
  const r = state.resources
  const n = r.allocation.length
  const i = state.processes.findIndex((x) => x.pid === proc.pid)
  if (i < 0) return
  const phase = Math.floor(state.clock / 5)

  if (phase % 3 === 0) {
    const releaseIdx = clampIndex(phase, n)
    const alloc = r.allocation[releaseIdx]
    const ownerProc = state.processes[releaseIdx]
    if (ownerProc && ownerProc.state !== '完成' && ownerProc.state !== '新建' && alloc.some((v) => v > 0)) {
      const rel = alloc.map((v, j) => (v > 0 && (phase + j) % 2 === 0 ? 1 : 0))
      if (rel.some((v) => v > 0)) {
        r.available = r.available.map((v, j) => v + rel[j])
        r.allocation = r.allocation.map((row, ri) => (ri === releaseIdx ? row.map((v, j) => v - rel[j]) : row))
        r.need = calcNeed(r.max, r.allocation)
        push('资源释放', 'resource', 'info', `${ownerProc.name} 释放资源 [${rel}]，回收至可用资源池`)
        refreshBankerSafety(state, push, false)
        return
      }
    }
  }

  const need = r.need[i]
  const aggressive = phase % 4 === 0
  const request = need.map((nd, j) => {
    if (nd <= 0) return 0
    if (aggressive && j === phase % need.length) return nd + 1
    const hi = Math.min(nd, r.available[j])
    return hi > 0 && (phase + j) % 2 === 0 ? 1 : 0
  })
  if (request.every((v) => v === 0)) {
    const j = need.findIndex((nd, idx) => nd > 0 && r.available[idx] > 0)
    if (j >= 0) request[j] = 1
  }
  if (request.every((v) => v === 0)) return

  const trace = localBankerRequest(state, r, i, request)

  const fs = trace.final_state || {}
  if (trace.metrics.可分配) {
    r.available = fs.Available
    r.allocation = fs.Allocation
    r.need = fs.Need
    r.safeSeq = translateProcessNames(state, fs.安全序列 || r.safeSeq)
    r.deadlock = false
    push('资源分配', 'resource', 'info', `${proc.name} 申请 [${request}] 获准，安全序列 ${r.safeSeq.join(',')}`)
  } else {
    push('资源请求', 'resource', 'warning', `${proc.name} 申请 [${request}] 未获准：${trace.metrics.原因 || '不安全 / 资源不足'}`)
    r.safeSeq = translateProcessNames(state, fs.安全序列 || [])
    if ((fs.死锁进程 || []).length) r.deadlock = true
  }
}

// ———————————————————————— 同步：PV 生产者-消费者（含 mutex 互斥）————————————————————————
function pvWakeConsumer(s, state, w) {
  const p = state.processes.find((x) => x.name === w)
  if (p) {
    p.state = '就绪'
    p.blockedReason = ''
    p.syncPhase = 1
    if (state.config.schedAlgo === 'RR' && !state.scheduler.rrQueue.includes(p.pid)) state.scheduler.rrQueue.push(p.pid)
  }
}

function pvWakeProducer(s, state, w) {
  const p = state.processes.find((x) => x.name === w)
  if (p) {
    p.state = '就绪'
    p.blockedReason = ''
    p.syncPhase = 1
    if (state.config.schedAlgo === 'RR' && !state.scheduler.rrQueue.includes(p.pid)) state.scheduler.rrQueue.push(p.pid)
  }
}

function pvWakeMutex(s, state, w) {
  const p = state.processes.find((x) => x.name === w)
  if (p) {
    p.state = '就绪'
    p.blockedReason = ''
    p.syncPhase = 2
    s.lockOwner = p.name
    if (state.config.schedAlgo === 'RR' && !state.scheduler.rrQueue.includes(p.pid)) state.scheduler.rrQueue.push(p.pid)
  }
}

function pvProduce(s, proc, state, procObj, push) {
  if (procObj.syncPhase === 0) {
    s.s1--
    if (s.s1 < 0) {
      s.prodBlocked.push(proc)
      push('生产阻塞', 'resource', 'warning', `P(s1) 缓冲区满，生产者 ${proc} 挂起等待空闲槽`)
      procObj.state = '阻塞'
      procObj.blockedReason = 'PV同步阻塞: 等待空闲槽 (s1)'
      return
    }
    procObj.syncPhase = 1
  }

  if (procObj.syncPhase === 1) {
    s.mutex--
    if (s.mutex < 0) {
      s.mutexBlocked.push(proc)
      push('互斥阻塞', 'resource', 'warning', `P(mutex) 临界区已被占用，生产者 ${proc} 挂起等待锁`)
      procObj.state = '阻塞'
      procObj.blockedReason = 'PV互斥阻塞: 等待临界锁 (mutex)'
      return
    }
    s.lockOwner = proc
    procObj.syncPhase = 2
  }

  if (procObj.syncPhase === 2) {
    s.buffer++
    s.produced++
    push('生产写入', 'resource', 'info', `生产者 ${proc} 获锁进入临界区，放入产品，缓冲区占用 ${s.buffer}`)

    s.mutex++
    s.lockOwner = null
    if (s.mutex <= 0 && s.mutexBlocked.length) {
      const nextW = s.mutexBlocked.shift()
      push('互斥唤醒', 'resource', 'info', `V(mutex) 释放锁，唤醒互斥队列进程 ${nextW}`)
      pvWakeMutex(s, state, nextW)
    }

    s.s2++
    if (s.s2 <= 0 && s.consBlocked.length) {
      const nextC = s.consBlocked.shift()
      push('同步唤醒', 'resource', 'info', `V(s2) 产生新产品，唤醒等待消费者 ${nextC}`)
      pvWakeConsumer(s, state, nextC)
    }

    procObj.syncPhase = 0
  }
}

function pvConsume(s, proc, state, procObj, push) {
  if (procObj.syncPhase === 0) {
    s.s2--
    if (s.s2 < 0) {
      s.consBlocked.push(proc)
      push('消费阻塞', 'resource', 'warning', `P(s2) 缓冲区空，消费者 ${proc} 挂起等待产品`)
      procObj.state = '阻塞'
      procObj.blockedReason = 'PV同步阻塞: 等待产品 (s2)'
      return
    }
    procObj.syncPhase = 1
  }

  if (procObj.syncPhase === 1) {
    s.mutex--
    if (s.mutex < 0) {
      s.mutexBlocked.push(proc)
      push('互斥阻塞', 'resource', 'warning', `P(mutex) 临界区已被占用，消费者 ${proc} 挂起等待锁`)
      procObj.state = '阻塞'
      procObj.blockedReason = 'PV互斥阻塞: 等待临界锁 (mutex)'
      return
    }
    s.lockOwner = proc
    procObj.syncPhase = 2
  }

  if (procObj.syncPhase === 2) {
    s.buffer--
    s.consumed++
    push('消费取出', 'resource', 'info', `消费者 ${proc} 获锁进入临界区，取出产品，缓冲区占用 ${s.buffer}`)

    s.mutex++
    s.lockOwner = null
    if (s.mutex <= 0 && s.mutexBlocked.length) {
      const nextW = s.mutexBlocked.shift()
      push('互斥唤醒', 'resource', 'info', `V(mutex) 释放锁，唤醒互斥队列进程 ${nextW}`)
      pvWakeMutex(s, state, nextW)
    }

    s.s1++
    if (s.s1 <= 0 && s.prodBlocked.length) {
      const nextP = s.prodBlocked.shift()
      push('同步唤醒', 'resource', 'info', `V(s1) 释放空闲槽，唤醒等待生产者 ${nextP}`)
      pvWakeProducer(s, state, nextP)
    }

    procObj.syncPhase = 0
  }
}

function isProducer(proc) {
  if (!proc) return false
  const name = proc.name.toLowerCase()
  return name.includes('logger') || name.includes('daemon') || name.includes('producer')
}

function isConsumer(proc) {
  if (!proc) return false
  const name = proc.name.toLowerCase()
  return name.includes('shell') || name.includes('consumer')
}

function syncProduce(state, running, push) {
  if (!running || !running.name) return
  pvProduce(state.sync, running.name, state, running, push)
}

function syncConsume(state, running, push) {
  if (!running || !running.name) return
  pvConsume(state.sync, running.name, state, running, push)
}

// ———————————————————————— 进程到达 + 指标 ————————————————————————
function addDeterministicArrival(state, t, rng, push) {
  const pid = state.nextPid++
  const name = `${JOB_NAMES[clampIndex(pid, JOB_NAMES.length)]}${pid}`

  const refString = [...state.memory.refString]
  const maxPage = Math.max(...refString)
  const extAddr = (page) => '0' + String(11 + page).padStart(2, '0')
  const pageTableTemplate = []
  for (let p = 0; p <= maxPage; p++) {
    pageTableTemplate.push({
      页号: p, 标志: 0, 主存块号: null, 访问位: 0, 修改位: 0,
      外存地址: extAddr(p), loadTime: -1, lastUsed: -1,
    })
  }

  state.processes.push({
    pid,
    name,
    state: '就绪',
    arrival: t,
    burst: 4 + ((pid + t) % 7),
    ran: 0,
    priority: 1 + ((pid + t) % 4),
    blockedReason: '',
    pageWaitingFor: null,
    blockedAt: null,
    refString: refString,
    refPtr: 0,
    hits: 0,
    faults: 0,
    pageTable: pageTableTemplate,
    lastReplace: { 访问页: null, 缺页: false, 调出页: null, 装入页: null, 装入块: null, 写回: false },
  })

  state.resources.max.push([rng.randint(1, 4), rng.randint(1, 4), rng.randint(1, 3)])
  state.resources.allocation.push([0, 0, 0])
  const newIdx = state.resources.max.length - 1
  state.resources.need.push(state.resources.max[newIdx].map((v, j) => v - state.resources.allocation[newIdx][j]))

  push('作业到达', 'processor', 'info', `新作业 ${name} 到达并加入就绪队列`)
}

function recomputeRuntimeMetrics(state) {
  const used = state.memory.frames.filter((x) => x !== null).length
  const refs = state.memory.faults + state.memory.hits
  const busy = state.gantt.reduce((sum, seg) => sum + Math.max(0, seg.结束 - seg.开始), 0)
  const completed = state.processes.filter((p) => p.state === '完成')
  recomputeDiskBusyRate(state)

  state.metrics.cpuUtil = state.clock ? Math.round((busy / state.clock) * 100) : 0
  state.metrics.memUtil = Math.round((used / Math.max(1, state.memory.capacity)) * 100)
  state.metrics.diskQueueLen = state.disk.queue.length
  state.metrics.faultRate = refs ? Math.round((state.memory.faults / refs) * 100) : 0
  state.metrics.readyLen = state.processes.filter((p) => p.state === '就绪').length
  state.metrics.blockedLen = state.processes.filter((p) => p.state === '阻塞').length
  state.metrics.completed = completed.length
  state.metrics.throughput = +(completed.length / Math.max(1, state.clock)).toFixed(2)
}

// ———————————————————————— 主整拍（纯函数）————————————————————————
export function seedSim(config) {
  return seedState(config)
}

// 推进一拍：返回新 state 与本拍事件。不触 store / 不调后端 / 不用 Math.random。
export function localTick(state) {
  const events = []
  const rng = makeRng(state.rngState)
  const push = (type, core, level, desc) => events.push({ type, core, level, desc })

  state.clock++
  const t = state.clock

  // 首拍播种 RR 轮转队列（seedState 后 clock 归零，故 clock===1 即新一轮）
  if (t === 1) seedScheduler(state)

  if (state.config.processAutoArrival && t % 7 === 0) addDeterministicArrival(state, t, rng, push)

  // —— 设备：物理寻道计时器进度 ——
  if (state.disk.activeRequest) {
    if (t >= state.disk.activeRequest.finishTime) {
      const req = state.disk.activeRequest
      const globalIdx = state.disk.queue.findIndex((r) => r.进程名 === req.进程名 && r.柱面号 === req.柱面号)
      if (globalIdx >= 0) state.disk.queue.splice(globalIdx, 1)

      if (req.isPageFault) loadPageAfterDiskIo(state, req, push)
      state.disk.served++
      state.disk.servedLog.unshift({ ...req, 寻道: req.seek, 服务时间: req.serviceTime, ts: t })
      if (state.disk.servedLog.length > 8) state.disk.servedLog.pop()
      push('设备完成', 'device', 'info', `${req.进程名} I/O 服务完成 (柱面 ${req.柱面号})`)
      state.disk.activeRequest = null
    }
  }

  if (!state.disk.activeRequest && state.disk.queue.length > 0) serveDisk(state, push)

  // —— 处理机调度 ——
  const running = applyCpuTrace(state, push)

  // —— 推进执行 ran ——
  if (running && running.state === '运行') {
    if (running.ran < running.burst) {
      running.ran = Math.min(running.burst, running.ran + 1)
      const last = state.gantt[state.gantt.length - 1]
      if (last && last.作业 === running.name && last.结束 === t - 1) {
        last.结束 = t
      } else {
        state.gantt.push({ 作业: running.name, 开始: t - 1, 结束: t })
      }
      if (running.ran >= running.burst) {
        running.finishTime = t
        running.state = '完成'
        push('进程完成', 'processor', 'info', `${running.name}(P${running.pid}) 服务时间用尽，周转 ${t - running.arrival}`)
      }
    }
  } else {
    const last = state.gantt[state.gantt.length - 1]
    if (last && last.作业 === '空闲' && last.结束 === t - 1) {
      last.结束 = t
    } else {
      state.gantt.push({ 作业: '空闲', 开始: t - 1, 结束: t })
    }
  }

  // 访存（CPU → 存储）：运行进程 40% 概率访存
  if (running && running.state === '运行' && rng.next() < 0.4) applyMemoryStep(state, push)
  // 磁盘 I/O（CPU → 设备）
  if (running && running.state === '运行' && t % 6 === 0) onCpuDiskRequest(state, running, rng, push)
  // 资源（CPU → 银行家）
  if (running && running.state === '运行' && t % 5 === 0) serveBankerRequest(state, running, push)
  // PV 同步（CPU → 同步）
  if (running && running.state === '运行' && t % 3 === 0) {
    if (isProducer(running)) syncProduce(state, running, push)
    else if (isConsumer(running)) syncConsume(state, running, push)
  }

  recomputeRuntimeMetrics(state)

  state.rngState = rng.state >>> 0
  return { state, events }
}
