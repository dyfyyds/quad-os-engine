import { useOsStore } from '../store/os'
import { api } from '../api/client'

/**
 * 驱动 —— 按虚拟时钟推进，向中央 store 写入「连贯」的 OS 运行叙事，
 * 让总览大屏与各核心页彼此联动地「活」起来。
 *
 * 六大模块均已接入后端引擎语义（backend/app/engines/*），且因果联动：
 *   · 处理机  /api/scheduling/run  一次性 trace + 逐周期回放
 *   · 存储    /api/paging/run      置换 trace 回放（FIFO/LRU/OPT/CLOCK）+ 地址转换（页号×块长+单元号→绝对地址/缺页）
 *   · 设备    /api/disk/simulate   移臂 + 旋转 I/O 模拟
 *   · 资源    /api/banker/*        安全性 + 资源请求/释放
 *   · 同步    sync_engine 语义     PV 生产者-消费者（进程驱动，阻塞/唤醒）
 * 「调度器选中的运行进程」是共同的因：它驱动访存/地址转换、磁盘 I/O、资源请求与同步生产。
 * 后端不可用时自动回退前端等价算法（一次性告警），保证纯前端可独立运行。
 */
let timer = null
let diskBusy = false  // 防止并发调用后端
let ticking = false
let cpuTrace = null
let cpuTraceKey = ''
let cpuTracePromise = null
let lastCpuRunning = null
let cpuFallbackNotified = false
// —— 存储：分页置换 trace（同 CPU：一次取、逐周期回放）——
let memTrace = null
let memTraceKey = ''
let memTracePromise = null
let memFallbackNotified = false
// —— 资源：银行家 ——
let bankerBusy = false
let bankerFallbackNotified = false
const rand = (a, b) => a + Math.random() * (b - a)
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

// ———————————————————————— 处理机：后端调度 trace 准备与回放 ————————————————————————
function cpuJobs(os) {
  return os.processes
    .filter((p) => Number(p.burst) > 0)
    .map((p) => ({
      name: p.name,
      arrival: Number(p.arrival) || 0,
      burst: Number(p.burst) || 1,
      priority: p.priority ?? null,
    }))
}

function cpuKey(os) {
  return JSON.stringify({
    algorithm: os.config.schedAlgo,
    time_quantum: os.config.quantum,
    jobs: cpuJobs(os),
  })
}

function finalizeJob(job, finish) {
  job.完成时间 = finish
  job.周转时间 = finish - job.arrival
  job.带权周转时间 = +(job.周转时间 / Math.max(1, job.burst)).toFixed(2)
  job.等待时间 = job.周转时间 - job.burst
}

function localSchedulingTrace(os) {
  const algo = os.config.schedAlgo
  const jobs = cpuJobs(os).map((j, idx) => ({ ...j, _idx: idx }))
  const gantt = []
  const done = []

  if (algo === 'RR') {
    const q = Math.max(1, Number(os.config.quantum) || 1)
    const pool = jobs
      .map((j) => ({ ...j, remaining: j.burst }))
      .sort((a, b) => a.arrival - b.arrival || a._idx - b._idx)
    let time = 0
    let i = 0
    const queue = []
    const enqueue = (upto) => {
      while (i < pool.length && pool[i].arrival <= upto) queue.push(pool[i++])
    }
    enqueue(time)
    if (!queue.length && pool.length) {
      time = pool[0].arrival
      enqueue(time)
    }
    while (queue.length) {
      const job = queue.shift()
      const run = Math.min(q, job.remaining)
      const start = time
      const finish = time + run
      gantt.push({ 作业: job.name, 开始: start, 结束: finish })
      job.remaining -= run
      time = finish
      enqueue(time)
      if (job.remaining > 0) queue.push(job)
      else {
        finalizeJob(job, finish)
        done.push(job)
      }
    }
  } else {
    const remaining = jobs.map((j) => ({ ...j }))
    let time = 0
    const key = (j) => {
      if (algo === 'FCFS') return [j.arrival, j._idx]
      if (algo === 'SJF') return [j.burst, j.arrival, j._idx]
      if (algo === 'HRRN') {
        const wait = Math.max(0, time - j.arrival)
        return [-(wait + j.burst) / Math.max(1, j.burst), j._idx]
      }
      if (algo === 'PRIORITY') return [j.priority ?? 99, j.arrival, j._idx]
      return [j.arrival, j._idx]
    }
    const compare = (a, b) => {
      const ka = key(a)
      const kb = key(b)
      for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
        if ((ka[i] ?? 0) !== (kb[i] ?? 0)) return (ka[i] ?? 0) - (kb[i] ?? 0)
      }
      return 0
    }
    while (remaining.length) {
      let available = remaining.filter((j) => j.arrival <= time)
      if (!available.length) {
        time = Math.min(...remaining.map((j) => j.arrival))
        available = remaining.filter((j) => j.arrival <= time)
      }
      const chosen = available.sort(compare)[0]
      const start = Math.max(time, chosen.arrival)
      const finish = start + chosen.burst
      gantt.push({ 作业: chosen.name, 开始: start, 结束: finish })
      finalizeJob(chosen, finish)
      done.push(chosen)
      remaining.splice(remaining.indexOf(chosen), 1)
      time = finish
    }
  }

  return {
    module: 'scheduling',
    algorithm: algo,
    metrics: {},
    steps: [],
    final_state: {
      完成顺序: done.sort((a, b) => a.完成时间 - b.完成时间 || a._idx - b._idx).map((j) => j.name),
      甘特图: gantt,
      作业明细: jobs.map((j) => {
        const d = done.find((x) => x.name === j.name) || j
        return {
          作业: j.name,
          到达: j.arrival,
          服务: j.burst,
          完成: d.完成时间,
          周转: d.周转时间,
          带权周转: d.带权周转时间,
          等待: d.等待时间,
        }
      }),
    },
  }
}

async function prepareCpuTrace(os) {
  const key = cpuKey(os)
  if (cpuTrace && key === cpuTraceKey) return cpuTrace
  if (cpuTracePromise) return cpuTracePromise

  cpuTracePromise = (async () => {
    try {
      cpuTrace = await api.scheduling({
        algorithm: os.config.schedAlgo,
        jobs: cpuJobs(os),
        time_quantum: os.config.quantum,
      })
      cpuTraceKey = key
      cpuFallbackNotified = false
    } catch (e) {
      cpuTrace = localSchedulingTrace(os)
      cpuTraceKey = key
      if (!cpuFallbackNotified) {
        os.pushEvent('调度回退', 'processor', 'warning', `后端调度接口不可用，临时使用前端等价算法：${e?.message || e}`)
        cpuFallbackNotified = true
      }
    } finally {
      cpuTracePromise = null
    }
    return cpuTrace
  })()

  return cpuTracePromise
}

function ranUntil(name, time, gantt) {
  return gantt.reduce((sum, seg) => {
    if (seg.作业 !== name) return sum
    return sum + Math.max(0, Math.min(time, seg.结束) - seg.开始)
  }, 0)
}

function visibleGanttUntil(gantt, time) {
  return gantt
    .filter((seg) => seg.开始 < time)
    .map((seg) => ({
      ...seg,
      结束: Math.min(seg.结束, time),
    }))
    .filter((seg) => seg.结束 > seg.开始)
}

function applyCpuTrace(os) {
  const trace = cpuTrace
  const fullGantt = trace?.final_state?.甘特图 || []
  const details = trace?.final_state?.作业明细 || []

  const time = os.clock
  const runningSeg = fullGantt.find((seg) => seg.开始 <= time && time < seg.结束) || null
  const runningName = runningSeg?.作业 || null
  os.gantt = visibleGanttUntil(fullGantt, time)

  os.processes.forEach((p) => {
    const detail = details.find((d) => d.作业 === p.name)
    p.ran = Math.min(p.burst, ranUntil(p.name, time, fullGantt))
    if (detail?.完成 !== undefined && detail.完成 <= time) p.state = '完成'
    else if (p.name === runningName) p.state = '运行'
    else if (time < p.arrival) p.state = '新建'
    else p.state = '就绪'
  })

  if (runningName && runningName !== lastCpuRunning) {
    const proc = os.processes.find((p) => p.name === runningName)
    os.pushEvent('进程调度', 'processor', 'info', `${os.config.schedAlgo} 调度器选中 ${runningName}${proc ? `(P${proc.pid})` : ''} 占用 CPU`)
  }
  lastCpuRunning = runningName

  details
    .filter((d) => d.完成 === time)
    .forEach((d) => os.pushEvent('进程完成', 'processor', 'info', `进程 ${d.作业} 执行完毕，周转 ${d.周转}`))

  const completed = details.filter((d) => d.完成 !== undefined && d.完成 <= time)
  os.metrics.completed = completed.length
  os.metrics.readyLen = os.processes.filter((p) => p.state === '就绪').length
  os.metrics.blockedLen = os.processes.filter((p) => p.state === '阻塞').length
  os.metrics.throughput = +(completed.length / Math.max(1, time)).toFixed(2)
  os.metrics.avgTurnaround = completed.length
    ? +(completed.reduce((sum, d) => sum + (d.周转 || 0), 0) / completed.length).toFixed(2)
    : 0

  return os.processes.find((p) => p.state === '运行') || null
}

// CPU 运行期触发一次访存 —— 回放后端分页引擎的下一步（CPU → 存储 因果联动）
function onCpuMemoryAccess(os, runningProc) {
  applyMemoryStep(os)
}

// CPU 运行期发起一次磁盘 I/O —— 请求挂上当前运行进程名（CPU → 设备 因果联动）
function onCpuDiskRequest(os, runningProc) {
  const d = os.disk
  if (d.queue.length >= 8) return
  const req = makeRequest(os)
  if (runningProc) req.进程名 = runningProc.name
  d.queue.push(req)
  os.pushEvent('I/O请求', 'device', 'info',
    `${req.进程名} 发起 I/O：柱面 ${req.柱面号}/磁道 ${req.磁道号}/记录 ${req.物理记录号}`)
}

// ———————————————————————— 存储：分页置换（接入后端引擎）————————————————————————

function memKey(os) {
  return JSON.stringify({
    algorithm: os.config.pageAlgo,
    refs: os.memory.refString,
    frames: os.memory.frameCount,
  })
}

/**
 * 取后端分页 trace（FIFO/LRU/OPT/CLOCK），按 key 缓存；
 * 后端不可用时回退本地等价算法（与 CPU 的 prepareCpuTrace 同范式）。
 */
async function prepareMemoryTrace(os) {
  const key = memKey(os)
  if (memTrace && key === memTraceKey) return memTrace
  if (memTracePromise) return memTracePromise

  memTracePromise = (async () => {
    try {
      memTrace = await api.paging({
        algorithm: os.config.pageAlgo,
        reference_string: os.memory.refString,
        frames: os.memory.frameCount,
      })
      memTraceKey = key
      memFallbackNotified = false
      os.setPagingTrace(memTrace)   // 同步至 store：backend 模式 + 暴露 trace.steps 给「分步执行过程」
    } catch (e) {
      memTrace = localPagingTrace(os)
      memTraceKey = key
      os.clearPagingTrace(e?.message || '后端分页接口不可用')   // 同步至 store：local 回退模式 + 告警
      if (!memFallbackNotified) {
        os.pushEvent('分页回退', 'memory', 'warning', `后端分页接口不可用，临时使用前端等价算法：${e?.message || e}`)
        memFallbackNotified = true
      }
    } finally {
      memTracePromise = null
    }
    return memTrace
  })()

  return memTracePromise
}

/** 本地回退：JS 端忠实复刻 paging_engine.run，产出与后端同形的 steps[]。 */
function localPagingTrace(os) {
  const algo = (os.config.pageAlgo || 'LRU').toUpperCase()
  const refs = os.memory.refString
  const n = os.memory.frameCount
  const mem = []
  const insertTime = {}
  const lastUsed = {}
  const useBit = {}
  let hand = 0
  const steps = []
  let faults = 0, hits = 0

  const nextUse = (start, page) => {
    for (let k = start; k < refs.length; k++) if (refs[k] === page) return k - start
    return Infinity
  }

  refs.forEach((page, i) => {
    const hit = mem.includes(page)
    let evicted = null
    if (hit) {
      hits++
      lastUsed[page] = i
      if (algo === 'CLOCK') useBit[page] = 1
    } else {
      faults++
      if (mem.length < n) {
        mem.push(page)
        if (algo === 'CLOCK') useBit[page] = 1
      } else {
        if (algo === 'FIFO') {
          evicted = mem.reduce((a, b) => (insertTime[a] <= insertTime[b] ? a : b))
          mem[mem.indexOf(evicted)] = page
        } else if (algo === 'OPT') {
          evicted = mem.reduce((a, b) => (nextUse(i + 1, a) >= nextUse(i + 1, b) ? a : b))
          mem[mem.indexOf(evicted)] = page
        } else if (algo === 'CLOCK') {
          while (useBit[mem[hand]] === 1) { useBit[mem[hand]] = 0; hand = (hand + 1) % n }
          evicted = mem[hand]; mem[hand] = page; useBit[page] = 1; hand = (hand + 1) % n
        } else { // LRU
          evicted = mem.reduce((a, b) => ((lastUsed[a] ?? -1) <= (lastUsed[b] ?? -1) ? a : b))
          mem[mem.indexOf(evicted)] = page
        }
        if (evicted !== null) delete useBit[evicted]
      }
      insertTime[page] = i
      lastUsed[page] = i
    }
    const snapshot = mem.concat(new Array(n).fill(null)).slice(0, n)
    steps.push({ state: { 引用页: page, 命中: hit, 缺页: !hit, 换出页: evicted, 页框: snapshot, 累计缺页: faults } })
  })

  return {
    module: 'paging', algorithm: algo,
    metrics: { 访问总数: refs.length, 缺页次数: faults, 命中次数: hits },
    steps,
    final_state: { 最终页框: mem.concat(new Array(n).fill(null)).slice(0, n), 缺页次数: faults },
  }
}

/**
 * 回放一步分页 trace —— 以后端的命中/缺页/换出/页框快照为权威，
 * 在前端层叠加教材位语义（访问位/修改位/外存地址/写回）。
 */
function applyMemoryStep(os) {
  const m = os.memory
  const trace = memTrace
  if (!trace || !trace.steps?.length) return
  const step = trace.steps[m.refPtr % trace.steps.length].state
  m.refPtr++
  m.traceCursor = (m.refPtr - 1) % trace.steps.length   // 揭示游标 → 当前步（MemoryCore「分步执行过程」据此逐步显示）

  const page = step.引用页
  const hit = step.命中
  const evicted = step.换出页 ?? null
  const now = os.clock
  const willWrite = Math.random() < 0.4   // 约四成访问为写 → 置「修改位」
  const blockSize = os.config.blockSize || 128
  const unit = Math.floor(Math.random() * blockSize)   // 页内单元号（偏移）—— 地址转换用

  // 写回判定须在重建页表之前读取被淘汰页的修改位
  const wroteBack = !hit && evicted !== null && m.pageTable[evicted]
    ? m.pageTable[evicted].修改位 === 1 : false

  // 以后端页框快照为权威，重建页框与页表「标志/主存块号」
  const snap = step.页框.slice(0, m.frameCount)
  m.frames = snap
  m.pageTable.forEach((row) => {
    const idx = snap.indexOf(row.页号)
    if (idx >= 0) {
      if (row.标志 !== 1) { row.标志 = 1; row.loadTime = now }
      row.主存块号 = idx
    } else {
      row.标志 = 0; row.主存块号 = null; row.访问位 = 0; row.修改位 = 0
    }
  })

  const slot = snap.indexOf(page)
  const row = m.pageTable[page]
  if (row) {
    row.访问位 = 1
    row.lastUsed = now
    if (hit) { if (willWrite) row.修改位 = 1 }
    else { row.修改位 = willWrite ? 1 : 0; row.loadTime = now }
  }

  if (hit) m.hits++
  else m.faults++

  // 地址转换（保留 paging_engine.translate 设计）：绝对地址 = 主存块号 × 块长 + 单元号
  const absAddr = slot >= 0 ? slot * blockSize + unit : null

  m.lastReplace = {
    访问页: page, 单元号: unit, 缺页: !hit,
    调出页: hit ? null : evicted,
    装入页: hit ? null : page,
    装入块: slot >= 0 ? slot : null,
    写回: wroteBack,
    绝对地址: absAddr,        // 命中 → 直接得址；缺页 → 装入后重试得址
  }

  // —— 缺页中断 → 阻塞当前运行进程（存储 → 调度 因果闭环）——
  if (!hit) {
    const detail = evicted === null
      ? `装入空闲块 ${slot}`
      : `调出页 ${evicted}${wroteBack ? '(已修改,写回外存)' : ''}，装入页 ${page} → 主存块 ${slot}`
    os.pushEvent('缺页中断', 'memory', 'warning',
      `访问 [页 ${page} 单元 ${unit}] 缺页中断 *${page} —— ${detail}（装入后绝对地址 ${absAddr}）`)

    // 阻塞当前运行的进程（模拟缺页中断处理期间进程等待）
    const runningProc = os.processes.find((p) => p.state === '运行')
    if (runningProc) {
      runningProc.state = '阻塞'
      runningProc.blockedReason = `缺页等待: 页${page}`
      runningProc.pageWaitingFor = page
      runningProc.blockedAt = now
      os.pushEvent('进程阻塞', 'memory', 'warning',
        `${runningProc.name}(P${runningProc.pid}) 因缺页中断阻塞，等待页 ${page} 装入主存`)
    }

    // 唤醒等待该页的其他就绪态进程（如果有的话——无实际效应，仅为语义完整）
    os.processes.forEach((p) => {
      if (p.state === '阻塞' && p.pageWaitingFor === page && p !== runningProc) {
        p.state = '就绪'
        p.blockedReason = ''
        p.pageWaitingFor = null
        p.blockedAt = null
        os.pushEvent('进程唤醒', 'memory', 'info',
          `${p.name}(P${p.pid}) 所等待页 ${page} 已装入主存，唤醒回就绪队列`)
      }
    })
  } else {
    // 页命中 → 唤醒所有等待此页的阻塞进程（页已在主存，可继续执行）
    os.processes.forEach((p) => {
      if (p.state === '阻塞' && p.pageWaitingFor === page) {
        p.state = '就绪'
        p.blockedReason = ''
        p.pageWaitingFor = null
        p.blockedAt = null
        os.pushEvent('进程唤醒', 'memory', 'info',
          `${p.name}(P${p.pid}) 所需页 ${page} 已在主存，唤醒回就绪队列`)
      }
    })
  }
}

// ———————————————————————— 设备：磁盘驱动调度（接入真实后端引擎）————————————————————————

/**
 * 接入后端 /api/disk/simulate 进行完整 I/O 模拟（移臂 + 旋转 + 传输）。
 * 后端引擎支持 FCFS/SSTF/SCAN/C-SCAN/LOOK/C-LOOK/F-SCAN/N-SCAN 八种算法。
 */
async function serveDisk(os) {
  if (diskBusy) return  // 防止并发
  const d = os.disk
  if (!d.queue.length) return

  diskBusy = true
  try {
    const trace = await api.diskSimulate({
      algorithm: os.config.diskAlgo,
      io_requests: d.queue,
      head: d.head,
      current_record: d.currentRecord,
      geometry: {
        cylinders: d.cylinders,
        tracks_per_cylinder: d.tracksPerCyl,
        records_per_track: d.recordsPerTrack,
      },
      direction: d.direction > 0 ? 'up' : 'down',
    })

    // 用引擎返回的第一步结果更新 store
    if (trace.steps && trace.steps.length > 0) {
      const first = trace.steps[0]
      const st = first.state
      const seek = st['寻道距离']
      const servedName = st['进程名']

      // 更新磁头位置
      d.head = st['目标柱面']
      d.currentRecord = st['目标记录']
      d.totalSeek += seek
      if (d.head !== trace.input_echo.head) {
        d.direction = d.head > trace.input_echo.head ? 1 : -1
      }
      d.path.push(d.head)
      if (d.path.length > 30) d.path.shift()

      // 从队列移除已服务请求
      const idx = d.queue.findIndex(r => r.进程名 === servedName)
      if (idx >= 0) {
        const req = d.queue.splice(idx, 1)[0]
        d.served++
        d.servedLog.unshift({ ...req, 寻道: seek, ts: os.clock })
        if (d.servedLog.length > 8) d.servedLog.pop()
      }

      os.pushEvent('驱动调度', 'device', 'info',
        `${servedName}：移臂至柱面 ${d.head}(寻道 ${seek}) → 旋转至记录 ${d.currentRecord} (服务时间 ${st['服务时间']})`)
    }
  } catch (e) {
    console.warn('[disk] 后端调用失败，回退本地调度:', e.message)
    // 回退：本地简单 SSTF
    serveDiskLocal(os)
  } finally {
    diskBusy = false
  }
}

/** 本地回退调度（后端不可用时）。 */
function serveDiskLocal(os) {
  const d = os.disk
  if (!d.queue.length) return
  // SSTF 选择最近请求
  let bi = 0, bd = Infinity
  d.queue.forEach((r, i) => {
    const dist = Math.abs(r.柱面号 - d.head)
    if (dist < bd) { bd = dist; bi = i }
  })
  const req = d.queue[bi]
  const seek = Math.abs(req.柱面号 - d.head)
  d.totalSeek += seek
  d.head = req.柱面号
  d.currentRecord = req.物理记录号
  d.path.push(d.head)
  if (d.path.length > 30) d.path.shift()
  d.queue.splice(bi, 1)
  d.served++
  d.servedLog.unshift({ ...req, 寻道: seek, ts: os.clock })
  if (d.servedLog.length > 8) d.servedLog.pop()
  os.pushEvent('驱动调度', 'device', 'info',
    `${req.进程名}：移臂至柱面 ${req.柱面号}(寻道 ${seek}) → 旋转至记录 ${req.物理记录号} [本地]`)
}

function makeRequest(os) {
  const d = os.disk
  return {
    进程名: os.processes.length ? pick(os.processes).name : 'job',
    柱面号: Math.round(rand(0, d.cylinders - 1)),
    磁道号: Math.round(rand(0, d.tracksPerCyl - 1)),
    物理记录号: Math.round(rand(0, d.recordsPerTrack - 1)),
  }
}

// ———————————————————————— 资源：银行家算法（接入后端引擎）————————————————————————

const vecLe = (a, b) => a.every((x, j) => x <= b[j])
const calcNeed = (max, alloc) => max.map((row, i) => row.map((v, j) => v - alloc[i][j]))

/** 本地回退：安全性算法（多趟扫描），返回与后端 check_safety 同形的结果。 */
function localSafety(available, max, allocation) {
  const n = allocation.length, m = available.length
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
        finish[i] = true; seq.push(`P${i}`); changed = true
      }
    }
  }
  const safe = finish.every(Boolean)
  const deadlock = finish.map((f, i) => (f ? null : `P${i}`)).filter(Boolean)
  return {
    metrics: { 安全: safe, 安全序列: safe ? seq : null },
    final_state: { Available: [...available], Max: max, Allocation: allocation, Need: need, 安全序列: safe ? seq : [], 死锁进程: deadlock },
  }
}

/** 本地回退：资源请求算法（试探分配 + 安全性检查）。 */
function localBankerRequest(r, pid, req) {
  const need = r.need
  if (!vecLe(req, need[pid])) return { metrics: { 可分配: false, 原因: `请求超过进程 P${pid} 的最大需求 Need=${need[pid]}`, 安全: false }, final_state: { Need: need, Available: [...r.available] } }
  if (!vecLe(req, r.available)) return { metrics: { 可分配: false, 原因: `资源不足，请求 ${req} > 可用 ${r.available}，须等待`, 安全: false }, final_state: { Need: need, Available: [...r.available] } }
  const newAvail = r.available.map((v, j) => v - req[j])
  const newAlloc = r.allocation.map((row, i) => (i === pid ? row.map((v, j) => v + req[j]) : [...row]))
  const safety = localSafety(newAvail, r.max, newAlloc)
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

/** 对当前资源态做安全性检查，写回真实安全序列 / 死锁标志。 */
async function refreshBankerSafety(os, announce = true) {
  const r = os.resources
  let trace
  try {
    trace = await api.bankerSafety({ available: r.available, max: r.max, allocation: r.allocation })
    bankerFallbackNotified = false
  } catch (e) {
    trace = localSafety(r.available, r.max, r.allocation)
    if (!bankerFallbackNotified) {
      os.pushEvent('银行家回退', 'resource', 'warning', `后端银行家接口不可用，临时使用前端等价算法：${e?.message || e}`)
      bankerFallbackNotified = true
    }
  }
  const safe = trace.metrics.安全
  r.safeSeq = trace.final_state.安全序列 || []
  r.deadlock = !safe
  if (announce) {
    if (safe) os.pushEvent('安全性检查', 'resource', 'info', `银行家算法通过安全性检查，安全序列 ${r.safeSeq.join(',')}`)
    else os.pushEvent('死锁告警', 'resource', 'danger', `系统处于不安全状态，死锁进程 ${(trace.final_state.死锁进程 || []).join(',')}`)
  }
}

/**
 * 一次资源活动（fire-and-forget）：约 35% 概率随机释放已占资源，
 * 否则挑一个进程发起资源请求并按银行家判定结果落库（进程 → 资源 因果联动）。
 */
async function serveBankerRequest(os) {
  if (bankerBusy) return
  bankerBusy = true
  try {
    const r = os.resources
    const n = r.allocation.length

    // —— 释放：进程阶段性归还，已占资源回收（让矩阵呼吸、避免单调耗尽）——
    if (Math.random() < 0.35) {
      const i = Math.floor(Math.random() * n)
      const alloc = r.allocation[i]
      if (alloc.some((v) => v > 0)) {
        const rel = alloc.map((v) => Math.round(Math.random() * v))
        if (rel.some((v) => v > 0)) {
          r.available = r.available.map((v, j) => v + rel[j])
          r.allocation = r.allocation.map((row, ri) => (ri === i ? row.map((v, j) => v - rel[j]) : row))
          r.need = calcNeed(r.max, r.allocation)
          os.pushEvent('资源释放', 'resource', 'info', `P${i} 释放资源 [${rel}]，回收至可用资源池`)
          await refreshBankerSafety(os, false)
          return
        }
      }
    }

    // —— 请求：构造请求向量（多数 ≤ Need，约 1/4 超额以演示等待/拒绝）——
    const i = Math.floor(Math.random() * n)
    const need = r.need[i]
    const aggressive = Math.random() < 0.25
    const request = need.map((nd, j) => {
      const hi = aggressive ? Math.max(nd, r.available[j]) + 1 : Math.min(nd, r.available[j])
      return Math.max(0, Math.round(Math.random() * hi))
    })
    if (request.every((v) => v === 0)) return  // 空请求跳过

    let trace
    try {
      trace = await api.bankerRequest({ available: r.available, max: r.max, allocation: r.allocation, pid: i, request, use_banker: true })
      bankerFallbackNotified = false
    } catch (e) {
      trace = localBankerRequest(r, i, request)
      if (!bankerFallbackNotified) {
        os.pushEvent('银行家回退', 'resource', 'warning', `后端银行家接口不可用，临时使用前端等价算法：${e?.message || e}`)
        bankerFallbackNotified = true
      }
    }

    const fs = trace.final_state || {}
    if (trace.metrics.可分配) {
      r.available = fs.Available
      r.allocation = fs.Allocation
      r.need = fs.Need
      r.safeSeq = fs.安全序列 || r.safeSeq
      r.deadlock = false
      os.pushEvent('资源分配', 'resource', 'info', `P${i} 申请 [${request}] 获准，安全序列 ${(fs.安全序列 || []).join(',')}`)
    } else {
      os.pushEvent('资源请求', 'resource', 'warning', `P${i} 申请 [${request}] 未获准：${trace.metrics.原因 || '不安全 / 资源不足'}`)
      if ((fs.死锁进程 || []).length) r.deadlock = true
    }
  } finally {
    bankerBusy = false
  }
}

// ———————————————————————— 同步：PV 生产者-消费者（进程驱动，语义同 sync_engine）————————————————————————
// 计数信号量：s1=空闲缓冲、s2=产品；P 使信号量-1(<0 则阻塞入队)，V 使其+1(<=0 则唤醒一个等待者)。
// 唤醒者继续完成其后半段(存入/取出 + 对应 V)，与 backend/app/engines/sync_engine 完全一致。

function pvWakeConsumer(s, os) {           // 一个被唤醒的消费者完成消费后半段
  s.buffer--; s.consumed++; s.s1++         // 取出 + V(s1)
  if (s.s1 <= 0 && s.prodBlocked.length) {
    const w = s.prodBlocked.shift()
    os.pushEvent('同步唤醒', 'resource', 'info', `V(s1) 唤醒生产者 ${w}`)
    pvWakeProducer(s, os)
  }
}
function pvWakeProducer(s, os) {            // 一个被唤醒的生产者完成生产后半段
  s.buffer++; s.produced++; s.s2++         // 存入 + V(s2)
  if (s.s2 <= 0 && s.consBlocked.length) {
    const w = s.consBlocked.shift()
    os.pushEvent('同步唤醒', 'resource', 'info', `V(s2) 唤醒消费者 ${w}`)
    pvWakeConsumer(s, os)
  }
}
function pvProduce(s, proc, os) {
  s.s1--                                   // P(s1)
  if (s.s1 < 0) {
    s.prodBlocked.push(proc)
    os.pushEvent('生产阻塞', 'resource', 'warning', `P(s1) 后 s1=${s.s1}<0，${proc} 阻塞（缓冲区满）`)
  } else {
    s.buffer++; s.produced++; s.s2++       // 存入 + V(s2)
    if (s.s2 <= 0 && s.consBlocked.length) {
      const w = s.consBlocked.shift()
      os.pushEvent('同步唤醒', 'resource', 'info', `V(s2) 唤醒消费者 ${w}`)
      pvWakeConsumer(s, os)
    }
  }
}
function pvConsume(s, proc, os) {
  s.s2--                                   // P(s2)
  if (s.s2 < 0) {
    s.consBlocked.push(proc)
    os.pushEvent('消费阻塞', 'resource', 'warning', `P(s2) 后 s2=${s.s2}<0，${proc} 阻塞（缓冲区空）`)
  } else {
    s.buffer--; s.consumed++; s.s1++       // 取出 + V(s1)
    if (s.s1 <= 0 && s.prodBlocked.length) {
      const w = s.prodBlocked.shift()
      os.pushEvent('同步唤醒', 'resource', 'info', `V(s1) 唤醒生产者 ${w}`)
      pvWakeProducer(s, os)
    }
  }
}

/** 一拍同步活动：由进程驱动(运行进程偏生产)，缓冲越满越偏消费 → 自平衡且偶发阻塞/唤醒。 */
function stepSync(os, running) {
  const s = os.sync
  const producer = (running && running.name) || pick(os.processes)?.name || 'proc'
  const consumer = pick(os.processes)?.name || 'proc'
  const fillRatio = s.buffer / Math.max(1, s.capacity)
  const pProduce = 0.65 - 0.5 * fillRatio   // 满→0.15(仍偶尔撑满阻塞)、空→0.65
  if (Math.random() < pProduce) pvProduce(s, producer, os)
  else pvConsume(s, consumer, os)
}

// ———————————————————————— 主时钟步进 ————————————————————————
async function tick(os) {
  os.clock++
  const t = os.clock

  // —— 处理机/存储：以后端 trace 为准逐周期回放 ——
  await prepareCpuTrace(os)
  await prepareMemoryTrace(os)
  const running = applyCpuTrace(os)

  // —— 因果联动：CPU 运行的进程驱动访存 / 磁盘 I/O ——
  if (running && Math.random() < 0.7) onCpuMemoryAccess(os, running)
  if (running && Math.random() < 0.08) onCpuDiskRequest(os, running)

  // —— 新作业到达 ——
  if (t % 7 === 0) {
    const pid = os.nextPid++
    const name = `${pick(['gcc', 'vim', 'sync', 'cron', 'http', 'db'])}${pid}`
    os.processes.push({ pid, name, state: '就绪', arrival: t, burst: Math.round(rand(4, 10)), ran: 0, priority: Math.round(rand(1, 4)), blockedReason: '', pageWaitingFor: null, blockedAt: null })
    os.pushEvent('作业到达', 'processor', 'info', `新作业 ${name} 进入就绪队列`)
    if (os.processes.length > 12) os.processes.shift()
  }

  // —— 资源：银行家算法（异步调用后端引擎，进程驱动资源请求/释放）——
  if (t % 5 === 0) serveBankerRequest(os)  // fire-and-forget

  // —— 设备：磁盘驱动调度（异步调用后端，不阻塞主时钟）——
  if (os.disk.queue.length && t % 2 === 0) serveDisk(os)  // fire-and-forget
  if (os.disk.queue.length < 6 && t % 6 === 0) {
    const req = makeRequest(os)
    os.disk.queue.push(req)
    os.pushEvent('I/O请求', 'device', 'info', `新增 I/O 请求：${req.进程名} 柱面 ${req.柱面号}/磁道 ${req.磁道号}/记录 ${req.物理记录号}`)
  }

  // —— 同步：生产者-消费者（进程驱动 PV，不再随机）——
  if (Math.random() < 0.5) stepSync(os, running)

  // —— 缺页阻塞超时唤醒（4 tick 后强制就绪，模拟缺页处理完成）——
  os.processes.forEach((p) => {
    if (p.state === '阻塞' && p.blockedAt && p.pageWaitingFor !== null && (t - p.blockedAt) >= 4) {
      p.state = '就绪'
      p.blockedReason = ''
      p.pageWaitingFor = null
      p.blockedAt = null
      os.pushEvent('超时唤醒', 'memory', 'info', `${p.name}(P${p.pid}) 缺页等待超时，已自动唤醒回就绪队列`)
    }
  })

  // —— 指标聚合 ——
  const used = os.memory.frames.filter((x) => x !== null).length
  const refs = os.memory.faults + os.memory.hits
  const target = running ? rand(72, 96) : rand(6, 18)
  os.metrics.cpuUtil = Math.round(os.metrics.cpuUtil + (target - os.metrics.cpuUtil) * 0.45)
  os.metrics.memUtil = Math.round((used / os.memory.capacity) * 100)
  os.metrics.diskQueueLen = os.disk.queue.length
  os.metrics.faultRate = refs ? Math.round((os.memory.faults / refs) * 100) : 0
  // 实时重算就绪/阻塞计数（applyMemoryStep 可能已改变进程状态）
  os.metrics.readyLen = os.processes.filter((p) => p.state === '就绪').length
  os.metrics.blockedLen = os.processes.filter((p) => p.state === '阻塞').length
  os.recordHistory()
}

export function useOsDriver() {
  const os = useOsStore()

  function schedule() {
    if (timer) clearInterval(timer)
    timer = setInterval(async () => {
      if (ticking) return
      ticking = true
      try {
        await tick(os)
      } finally {
        ticking = false
      }
    }, Math.max(120, 900 / os.speed))
  }
  async function start() {
    if (os.running) return
    await Promise.all([prepareCpuTrace(os), prepareMemoryTrace(os)])
    await refreshBankerSafety(os)
    os.running = true
    schedule()
  }
  function pause() { os.running = false; if (timer) { clearInterval(timer); timer = null } }
  async function step() {
    if (ticking) return
    ticking = true
    try {
      await tick(os)
    } finally {
      ticking = false
    }
  }
  function setSpeed(s) { os.speed = s; if (os.running) schedule() }
  function reset() {
    pause()
    cpuTrace = null
    cpuTraceKey = ''
    cpuTracePromise = null
    lastCpuRunning = null
    cpuFallbackNotified = false
    memTrace = null
    memTraceKey = ''
    memTracePromise = null
    memFallbackNotified = false
    bankerBusy = false
    bankerFallbackNotified = false
    os.resetState()
  }

  return { start, pause, step, setSpeed, reset }
}
