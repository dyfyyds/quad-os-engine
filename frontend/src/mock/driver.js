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
const JOB_NAMES = ['gcc', 'vim', 'sync', 'cron', 'http', 'db']
const DISK_BUSY_WINDOW = 10

function clampIndex(n, len) {
  return len ? ((n % len) + len) % len : 0
}

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

function applyCpuTrace(os) {
  const trace = cpuTrace
  const fullGantt = trace?.final_state?.甘特图 || []
  const details = trace?.final_state?.作业明细 || []

  const time = os.clock
  const runningSeg = fullGantt.find((seg) => seg.开始 <= time && time < seg.结束) || null
  const ganttName = runningSeg?.作业 || null  // CPU trace 的"理论应跑"提示，仅用于优先选运行
  // 注意：os.gantt 不再从离线 trace 切片 —— 改由 tick 主循环按实际运行进程累加（见 tick）。

  // —— I/O 完成协调器（单一入口）——
  // 磁盘服务把请求从 disk.queue 移除后，凡是仍挂在 ioBlocked 但已无对应请求的进程，
  // 一律视为 I/O 完成 → 解除阻塞 → 重新进入就绪队列。
  // 这样保证：阻塞 → 就绪 的转换永远不会卡死，且事件只来自一处。
  const queueNames = new Set(os.disk.queue.map((r) => r.进程名))
  // justUnblocked：本 tick 刚解除阻塞的进程，本拍只能停留在「就绪」，
  // 下一 tick 才允许被调度运行 —— 保证 UI 看得到"阻塞→就绪→运行"过渡，
  // 也避免单 tick 内压缩出"解阻塞→运行→新阻塞"导致进度跳变。
  const justUnblocked = new Set()
  for (let i = os.disk.ioBlocked.length - 1; i >= 0; i--) {
    const name = os.disk.ioBlocked[i]
    if (!queueNames.has(name)) {
      os.disk.ioBlocked.splice(i, 1)
      const proc = os.processes.find((p) => p.name === name)
      if (proc && proc.state === '阻塞') {
        proc.state = '就绪'
        proc.blockedReason = ''
        justUnblocked.add(name)
        os.pushEvent('I/O完成', 'device', 'info',
          `${name} I/O 完成 → 解除阻塞，重新加入就绪队列`)
      }
    }
  }

  // I/O 阻塞列表（已被协调器同步过）
  const ioBlocked = os.disk.ioBlocked || []

  // 第一轮：完成态 / 新建态 / 新建→就绪 转换
  // 注意：ran 不再从 CPU trace 甘特图推算（甘特图是离线理论轨迹，不感知 I/O 阻塞）。
  // ran 由 tick 主循环对"真正运行的进程"显式累加，阻塞期自动冻结，进度反映实际执行。
  // 完成判定也改为基于实际 ran：ran >= burst → 完成。
  os.processes.forEach((p) => {
    if (p.ran >= p.burst && p.burst > 0) {
      if (p.state !== '完成') {
        p.state = '完成'
        os.pushEvent('进程完成', 'processor', 'info',
          `${p.name}(P${p.pid}) 服务时间用尽 → 完成`)
      }
    } else if (time < p.arrival) {
      p.state = '新建'
    } else if (p.state === '新建' && time >= p.arrival) {
      p.state = '就绪'
      os.pushEvent('作业就绪', 'processor', 'info',
        `${p.name}(P${p.pid}) 到达 → 「新建」转「就绪」加入就绪队列`)
    }
  })

  // 第二轮：独立调度器 —— 三步决定运行/就绪/阻塞
  //   步骤 1：I/O 阻塞列表中的进程 → 强制「阻塞」
  //   步骤 2：清除上一时刻的「运行」残留 —— 所有非阻塞非完成非新建的进程一律先标为「就绪」
  //   步骤 3：选运行者 —— gantt 选中者优先，否则从就绪队列挑一个

  // 1. ioBlocked → 阻塞
  os.processes.forEach((p) => {
    if (ioBlocked.includes(p.name) && p.state !== '完成' && p.state !== '新建') {
      p.state = '阻塞'
    }
  })

  // 2. 清运行残留：所有已到达、非阻塞非完成非新建的进程统一回「就绪」队列等待调度
  os.processes.forEach((p) => {
    if (p.state !== '阻塞' && p.state !== '完成' && p.state !== '新建' && time >= p.arrival) {
      p.state = '就绪'
    }
  })

  // 3. 选运行：gantt 优先（仅当该进程当前处于「就绪」且非本 tick 刚解除阻塞），
  //    否则从就绪队列挑首个（同样跳过 justUnblocked）。
  //    "本 tick 刚解除阻塞 → 留在就绪，下 tick 才能跑" —— 单 tick 内不发生压缩。
  const ganttProc = ganttName ? os.processes.find((p) => p.name === ganttName) : null
  if (ganttProc && ganttProc.state === '就绪' && !justUnblocked.has(ganttProc.name)) {
    ganttProc.state = '运行'
  } else {
    const candidate = os.processes.find(
      (p) => p.state === '就绪' && !justUnblocked.has(p.name)
    )
    if (candidate) {
      candidate.state = '运行'
      os.pushEvent('主动调度', 'processor', 'info',
        `CPU 空闲 → 从就绪队列调度 ${candidate.name}(P${candidate.pid}) 运行`)
    }
  }

  // 进程调度事件
  const currentRunning = os.processes.find(p => p.state === '运行')
  const currentRunningName = currentRunning?.name || null
  if (currentRunningName && currentRunningName !== lastCpuRunning) {
    os.pushEvent('进程调度', 'processor', 'info',
      `${currentRunning.name}(P${currentRunning.pid}) 占用 CPU`)
  }
  lastCpuRunning = currentRunningName

  // 完成统计 / 指标聚合 —— 基于实际状态（不再依赖 trace 的离线完成时间）
  const doneProcs = os.processes.filter((p) => p.state === '完成')
  os.metrics.completed = doneProcs.length
  os.metrics.readyLen = os.processes.filter((p) => p.state === '就绪').length
  os.metrics.blockedLen = os.processes.filter((p) => p.state === '阻塞').length
  os.metrics.throughput = +(doneProcs.length / Math.max(1, time)).toFixed(2)
  // 实际周转 = 完成时刻 - 到达时刻（仅对已完成进程）
  const turnarounds = doneProcs.map((p) => (p.finishTime ?? time) - p.arrival)
  os.metrics.avgTurnaround = turnarounds.length
    ? +(turnarounds.reduce((s, t) => s + t, 0) / turnarounds.length).toFixed(2)
    : 0

  return os.processes.find((p) => p.state === '运行') || null
}

// CPU 运行期触发一次访存 —— 回放后端分页引擎的下一步（CPU → 存储 因果联动）
function onCpuMemoryAccess(os, runningProc) {
  applyMemoryStep(os)
}

// I/O 概率：按进程类型区分 I/O 密集 vs CPU 密集
const IO_PROB = {
  // I/O 密集型
  vim: 0.25,   // 编辑器：频繁等待键盘输入
  http: 0.20,  // Web 服务：频繁等待网络请求
  db: 0.25,    // 数据库：频繁读写磁盘
  sync: 0.15,  // 同步进程：有一定 I/O
  // CPU 密集型
  cron: 0.03,  // 定时任务：CPU 密集
  gcc: 0.03,   // 编译器：CPU 密集
  init: 0.01,  // 系统初始化：极少 I/O
  shell: 0.05, // 命令行：偶尔 I/O
  logger: 0.10, // 日志进程：频繁写磁盘
  daemon: 0.08, // 守护进程：中等 I/O
}
function getIoProb(name) {
  const prefix = name.replace(/\d+$/, '')  // 'gcc6' → 'gcc'
  return IO_PROB[prefix] ?? IO_PROB.default
}

// CPU 运行期发起一次磁盘 I/O —— 按进程类型概率触发，进程立即进入 I/O 阻塞态
function onCpuDiskRequest(os, runningProc) {
  const d = os.disk
  if (d.queue.length >= 8) return
  if (Math.random() >= getIoProb(runningProc.name)) return  // 按类型概率决定是否 I/O
  const req = makeRequest(os)
  if (runningProc) {
    req.进程名 = runningProc.name
  }
  d.queue.push(req)
  // 进程因 I/O 请求立即进入阻塞态（当 tick 生效，不再占用 CPU）
  if (runningProc && !d.ioBlocked.includes(runningProc.name)) {
    d.ioBlocked.push(runningProc.name)
    runningProc.state = '阻塞'  // 当 tick 立即生效
    runningProc.blockedReason = `等待磁盘 I/O - 柱面 ${req.柱面号} 磁道 ${req.磁道号} 记录 ${req.物理记录号}`
  }
  os.pushEvent('I/O请求', 'device', 'info',
    `${req.进程名} 发起 I/O → 进入阻塞态：柱面 ${req.柱面号}/磁道 ${req.磁道号}/记录 ${req.物理记录号}`)
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
  // refPtr 取模循环：访问串到尾后重头开始，保证演示可持续推进；
  // hits/faults 累计不重置，反映"程序持续访问、缺页持续发生"的真实语义。
  const stepIdx = m.refPtr % trace.steps.length
  const step = trace.steps[stepIdx].state
  m.refPtr++
  m.traceCursor = stepIdx   // 揭示游标 → 当前步（按 trace 内位置取，循环时游标也循环）

  const page = step.引用页
  const hit = step.命中
  const evicted = step.换出页 ?? null
  const now = os.clock
  const blockSize = os.config.blockSize || 128
  const willWrite = ((page + now + m.refPtr) % 5) < 2   // 固定比例写访问 → 置「修改位」
  const unit = (page * 31 + now * 17 + m.refPtr * 7) % blockSize   // 页内单元号（偏移）—— 地址转换用

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
  const runningProc = os.processes.find((p) => p.state === '运行')
  if (!hit) {
    const detail = evicted === null
      ? `装入空闲块 ${slot}`
      : `调出页 ${evicted}${wroteBack ? '(已修改,写回外存)' : ''}，装入页 ${page} → 主存块 ${slot}`
    os.pushEvent('缺页中断', 'memory', 'warning',
      `访问 [页 ${page} 单元 ${unit}] 缺页中断 *${page} —— ${detail}（装入后绝对地址 ${absAddr}）`)

    if (runningProc) {
      runningProc.state = '阻塞'
      runningProc.blockedReason = `缺页等待: 页${page}`
      runningProc.pageWaitingFor = page
      runningProc.blockedAt = now
      os.pushEvent('进程阻塞', 'memory', 'warning',
        `${runningProc.name}(P${runningProc.pid}) 因缺页中断阻塞，等待页 ${page} 装入主存`)
    }
  }

  // —— 统一智能唤醒：扫描所有缺页阻塞进程，若其等待页已在新 frames 快照中，立即解阻塞 ——
  // 适用三种情形：① 缺页路径下，被换入的就是它等的页；② 命中路径下，目标页就在内存；
  //              ③ 别的进程缺页换入了它正在等的页（连锁唤醒）。
  // 当前 runningProc 若刚因本次缺页阻塞，page 已在 frames 里——它的 pageWaitingFor === page，
  // 但我们希望保留 4 拍"缺页处理耗时"语义，所以不立即唤醒自己（pageWaitingFor 等于当前 page 且 blockedAt === now 的跳过）。
  const inMem = new Set(snap.filter((x) => x !== null))
  os.processes.forEach((p) => {
    if (p.state !== '阻塞' || p.pageWaitingFor == null) return
    if (p === runningProc && p.blockedAt === now) return   // 当前刚阻塞的进程保留至少 1 拍
    if (inMem.has(p.pageWaitingFor)) {
      p.state = '就绪'
      p.blockedReason = ''
      p.pageWaitingFor = null
      p.blockedAt = null
      os.pushEvent('进程唤醒', 'memory', 'info',
        `${p.name}(P${p.pid}) 所等待页已在主存，唤醒回就绪队列`)
    }
  })
}

// ———————————————————————— 设备：磁盘驱动调度（接入真实后端引擎）————————————————————————

function recordDiskBusy(os, processName, serviceTime) {
  const d = os.disk
  const normalized = Math.max(1, Number(serviceTime) || 1)
  const start = Math.max(os.clock, d.busyUntil || 0)
  const end = start + normalized
  d.busyUntil = end
  d.busyLog.push({ start, end, serviceTime: normalized, processName })
  const keepFrom = os.clock - DISK_BUSY_WINDOW * 3
  d.busyLog = d.busyLog.filter((seg) => seg.end >= keepFrom)
}

function recomputeDiskBusyRate(os) {
  const d = os.disk
  const windowEnd = os.clock
  const windowStart = windowEnd - DISK_BUSY_WINDOW
  const busyTime = d.busyLog.reduce((sum, seg) => {
    const overlap = Math.max(0, Math.min(seg.end, windowEnd) - Math.max(seg.start, windowStart))
    return sum + overlap
  }, 0)
  d.busyRate = Math.min(100, Math.round((busyTime / DISK_BUSY_WINDOW) * 100))
  d.busyLog = d.busyLog.filter((seg) => seg.end >= windowStart)
}

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
      const serviceTime = st['服务时间']

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
        recordDiskBusy(os, servedName, serviceTime)
        d.servedLog.unshift({ ...req, 寻道: seek, 服务时间: serviceTime, ts: os.clock })
        if (d.servedLog.length > 8) d.servedLog.pop()
      }

      // 注意：「阻塞→就绪」的解除统一由 applyCpuTrace 开头的 I/O 完成协调器处理，
      // 此处不再操作 ioBlocked 或进程状态，避免事件重复与时序竞态。

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
  const serviceTime = seek + 1
  d.totalSeek += seek
  d.head = req.柱面号
  d.currentRecord = req.物理记录号
  d.path.push(d.head)
  if (d.path.length > 30) d.path.shift()
  d.queue.splice(bi, 1)
  d.served++
  recordDiskBusy(os, req.进程名, serviceTime)
  d.servedLog.unshift({ ...req, 寻道: seek, 服务时间: serviceTime, ts: os.clock })
  if (d.servedLog.length > 8) d.servedLog.pop()
  // 注意：「阻塞→就绪」由 applyCpuTrace 开头的 I/O 完成协调器统一处理（同 serveDisk）。
  os.pushEvent('驱动调度', 'device', 'info',
    `${req.进程名}：移臂至柱面 ${req.柱面号}(寻道 ${seek}) → 旋转至记录 ${req.物理记录号} [本地]`)
}

function makeRequest(os) {
  const d = os.disk
  const pid = os.runningProc?.pid || os.nextPid || 1
  const t = os.clock
  return {
    进程名: os.runningProc?.name || `job${pid}`,
    柱面号: (pid * 37 + t * 11 + d.served * 5) % d.cylinders,
    磁道号: (pid + t + d.queue.length) % d.tracksPerCyl,
    物理记录号: (pid * 3 + t + d.currentRecord) % d.recordsPerTrack,
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
 * 一次资源活动：按虚拟时钟确定性释放或请求资源，
 * 再由银行家算法判定并落库（进程 → 资源 因果联动）。
 * 运行进程请求资源（因果联动：CPU 调度 → 资源申请）。
 * 请求向量 = min(Need[i], Available)，由运行进程的实际需求决定，非随机。
 */
async function serveBankerRequest(os, proc) {
  if (bankerBusy || !proc) return
  bankerBusy = true
  try {
    const r = os.resources
    const n = r.allocation.length
    const phase = Math.floor(os.clock / 5)

    // —— 释放：进程阶段性归还，已占资源回收（让矩阵呼吸、避免单调耗尽）——
    if (phase % 3 === 0) {
      const i = clampIndex(phase, n)
      const alloc = r.allocation[i]
      if (alloc.some((v) => v > 0)) {
        const rel = alloc.map((v, j) => (v > 0 && (phase + j) % 2 === 0 ? 1 : 0))
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

    // —— 请求：基于运行进程映射到银行家矩阵，aggressive 节拍化构造请求向量 ——
    // 进程 pid → 矩阵索引；多数请求 ≤ Need，固定节拍超额以演示"申请被拒绝/等待"
    const i = proc.pid % n
    const need = r.need[i]
    const aggressive = phase % 4 === 0
    const request = need.map((nd, j) => {
      if (nd <= 0) return 0
      if (aggressive && j === phase % need.length) return nd + 1  // 超额：让 banker 判定不安全
      const hi = Math.min(nd, r.available[j])
      return hi > 0 && (phase + j) % 2 === 0 ? 1 : 0
    })
    if (request.every((v) => v === 0)) {
      const j = need.findIndex((nd, idx) => nd > 0 && r.available[idx] > 0)
      if (j >= 0) request[j] = 1
    }
    if (request.every((v) => v === 0)) return  // 仍空，跳过

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
      os.pushEvent('资源分配', 'resource', 'info', `${proc.name} 申请 [${request}] 获准，安全序列 ${(fs.安全序列 || []).join(',')}`)
    } else {
      os.pushEvent('资源请求', 'resource', 'warning', `${proc.name} 申请 [${request}] 未获准：${trace.metrics.原因 || '不安全 / 资源不足'}`)
      if ((fs.死锁进程 || []).length) r.deadlock = true
    }
  } finally {
    bankerBusy = false
  }
}

/**
 * 阻塞/完成进程释放全部资源（因果联动：进程阻塞 → 资源回收）。
 * 模拟进程进入 I/O 等待期间不占计算资源。
 */
function releaseBankerResources(os, proc) {
  const r = os.resources
  const n = r.allocation.length
  const i = proc.pid % n
  const alloc = r.allocation[i]

  if (alloc.some((v) => v > 0)) {
    r.available = r.available.map((v, j) => v + alloc[j])
    r.allocation[i] = alloc.map(() => 0)
    r.need = calcNeed(r.max, r.allocation)
    os.pushEvent('资源释放', 'resource', 'info', `${proc.name} 阻塞，释放全部资源 [${alloc}] 回收至可用池`)
    refreshBankerSafety(os, false)
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

/**
 * 因果同步：运行进程 → 生产者（产生数据到缓冲区）。
 * 仅运行进程可生产，缓冲区满时阻塞。
 */
function syncProduce(os, running) {
  if (!running || !running.name) return
  const s = os.sync
  if (s.buffer >= s.capacity) return  // 缓冲满，跳过（不主动阻塞运行进程）
  pvProduce(s, running.name, os)
}

/**
 * 因果同步：阻塞进程被唤醒 → 消费者（从缓冲区取数据）。
 * 仅当缓冲区有数据时消费。
 */
function syncConsume(os) {
  const s = os.sync
  const producer = (running && running.name) || os.processes[clampIndex(os.clock, os.processes.length)]?.name || 'proc'
  const consumer = os.processes[clampIndex(os.clock + 1, os.processes.length)]?.name || 'proc'
  const fillRatio = s.buffer / Math.max(1, s.capacity)
  const shouldProduce = s.buffer === 0 || (s.buffer < s.capacity && (os.clock + Math.round(fillRatio * 10)) % 2 === 0)
  if (shouldProduce) pvProduce(s, producer, os)
  else pvConsume(s, consumer, os)
  if (s.buffer <= 0) return  // 缓冲空，跳过
  const blocked = os.processes.filter(p => p.state === '阻塞')
  if (!blocked.length) return
  pvConsume(s, blocked[0].name, os)
}

function addDeterministicArrival(os, t) {
  const pid = os.nextPid++
  const name = `${JOB_NAMES[clampIndex(pid, JOB_NAMES.length)]}${pid}`
  os.processes.push({
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
  })
  os.pushEvent('作业到达', 'processor', 'info', `新作业 ${name} 进入就绪队列`)
  // 队列上限保护：超出 12 时砍掉最早一个非运行进程，避免 PCB 表无限增长
  if (os.processes.length > 12) {
    const idx = os.processes.findIndex((p) => p.state !== '运行')
    if (idx >= 0) os.processes.splice(idx, 1)
  }
  // 清除 CPU trace 缓存，下一 tick 重算包含新作业的甘特
  cpuTrace = null
  cpuTraceKey = ''
}

function recomputeRuntimeMetrics(os) {
  const used = os.memory.frames.filter((x) => x !== null).length
  const refs = os.memory.faults + os.memory.hits
  const busy = os.gantt.reduce((sum, seg) => sum + Math.max(0, seg.结束 - seg.开始), 0)
  const completed = os.processes.filter((p) => p.state === '完成')
  recomputeDiskBusyRate(os)

  os.metrics.cpuUtil = os.clock ? Math.round((busy / os.clock) * 100) : 0
  os.metrics.memUtil = Math.round((used / Math.max(1, os.memory.capacity)) * 100)
  os.metrics.diskQueueLen = os.disk.queue.length
  os.metrics.faultRate = refs ? Math.round((os.memory.faults / refs) * 100) : 0
  os.metrics.readyLen = os.processes.filter((p) => p.state === '就绪').length
  os.metrics.blockedLen = os.processes.filter((p) => p.state === '阻塞').length
  os.metrics.completed = completed.length
  os.metrics.throughput = +(completed.length / Math.max(1, os.clock)).toFixed(2)
}

// ———————————————————————— 主时钟步进 ————————————————————————
async function tick(os) {
  os.clock++
  const t = os.clock

  // —— 新作业到达：固定节拍与固定参数，保证重置后可复现 ——
  if (t % 7 === 0) addDeterministicArrival(os, t)

  // —— 处理机/存储：以后端 trace 为准逐周期回放 ——
  await prepareCpuTrace(os)
  await prepareMemoryTrace(os)
  const running = applyCpuTrace(os)

  // —— 因果联动：运行进程驱动一切 ——
  // 严格顺序：① 推进 ran 与甘特（CPU 真的跑了 1 拍）→ ② 再触发可能导致阻塞的副作用
  if (running && running.state === '运行' && running.ran < running.burst) {
    running.ran = Math.min(running.burst, running.ran + 1)
    // 甘特事实记录：上一段同名且首尾相接(结束===t-1) 则延伸；否则新段
    const last = os.gantt[os.gantt.length - 1]
    if (last && last.作业 === running.name && last.结束 === t - 1) {
      last.结束 = t
    } else {
      os.gantt.push({ 作业: running.name, 开始: t - 1, 结束: t })
      if (os.gantt.length > 40) os.gantt.shift()
    }
    if (running.ran >= running.burst) {
      running.finishTime = t
      running.state = '完成'
      os.pushEvent('进程完成', 'processor', 'info',
        `${running.name}(P${running.pid}) 服务时间用尽，周转 ${t - running.arrival}`)
    }
  }

  // 访存（CPU → 存储）：按 50% 概率触发——并非每拍都访存（CPU 也有"纯计算"拍），
  // 避免每拍都推 trace、几拍内全员缺页阻塞 CPU 空闲
  if (running && running.state === '运行' && Math.random() < 0.5) onCpuMemoryAccess(os, running)
  // 磁盘 I/O（CPU → 设备）：可能因 I/O 转阻塞
  if (running && running.state === '运行' && t % 6 === 0) onCpuDiskRequest(os, running)
  // 资源（CPU → 银行家）：运行进程按 Need 申请
  if (running && running.state === '运行' && t % 5 === 0) await serveBankerRequest(os, running)
  // PV 生产（CPU → 同步）：运行进程生产数据
  if (running && running.state === '运行' && t % 3 === 0) syncProduce(os, running)

  // —— 设备：磁盘驱动调度（fire-and-forget，后端服务后由协调器解阻塞）——
  if (os.disk.queue.length && t % 2 === 0) serveDisk(os)

  // —— 阻塞进程触发资源释放 / PV 消费（让矩阵呼吸）——
  const blocked = os.processes.filter((p) => p.state === '阻塞')
  if (blocked.length) {
    if (t % 4 === 0) releaseBankerResources(os, blocked[0])
    if (t % 3 === 0) syncConsume(os)
  }

  // —— 指标聚合 ——
  recomputeRuntimeMetrics(os)

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

  // —— 历史采样（指标已由 recomputeRuntimeMetrics 上方一次性聚合完成）——
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
