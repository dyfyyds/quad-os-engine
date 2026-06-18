import { useOsStore } from '../store/os'
import { api } from '../api/client'

/**
 * 驱动 —— 按虚拟时钟推进，向中央 store 写入「连贯」的 OS 运行叙事，
 * 让总览大屏与各核心页彼此联动地「活」起来。
 *
 * 重构后：实现真运行时动态联动，抛弃离线双轨 Trace 的伪联动。
 */
let timer = null
let diskBusy = false
let ticking = false
let cpuTrace = null
let cpuTraceKey = ''
let cpuTracePromise = null
let lastCpuRunning = null
let cpuFallbackNotified = false

let memTrace = null
let memTraceKey = ''
let memTracePromise = null
let memFallbackNotified = false

let bankerBusy = false
let bankerFallbackNotified = false

const JOB_NAMES = ['gcc', 'vim', 'sync', 'cron', 'http', 'db']
const DISK_BUSY_WINDOW = 10

// —— 运行时调度与时序控制状态 ——
let schedRrQueue = []
let schedCurrentPid = null
let schedQuantumUsed = 0

function clampIndex(n, len) {
  return len ? ((n % len) + len) % len : 0
}

function vecLe(a, b) {
  return a.every((x, j) => x <= b[j])
}

const calcNeed = (max, alloc) => max.map((row, i) => row.map((v, j) => v - alloc[i][j]))

// 辅助函数：将 'P0' 形式的名称翻译为进程真实名称
function translateProcessNames(os, list) {
  return (list || []).map(name => {
    const match = String(name).match(/^P(\d+)$/)
    if (match) {
      const idx = parseInt(match[1])
      return os.processes[idx]?.name || name
    }
    return name
  })
}

// 辅助函数：根据物理块索引查找其拥有的进程页表项
function findFrameOwner(os, slot) {
  for (const p of os.processes) {
    if (p.pageTable) {
      const pageIndex = p.pageTable.findIndex(row => row.标志 === 1 && row.主存块号 === slot)
      if (pageIndex >= 0) {
        return { proc: p, pageRow: p.pageTable[pageIndex] }
      }
    }
  }
  return null
}

// ———————————————————————— 处理机：后端调度 trace 准备（兼容旧逻辑，但不作为主调度源） ————————————————————————
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
        os.pushEvent('调度回退', 'processor', 'warning', `后端调度接口不可用，使用本地备用调度算法`)
        cpuFallbackNotified = true
      }
    } finally {
      cpuTracePromise = null
    }
    return cpuTrace
  })()

  return cpuTracePromise
}

/**
 * 运行时动态 CPU 调度器与 I/O 唤醒协调
 */
function applyCpuTrace(os) {
  const time = os.clock

  // —— I/O 完成协调器 ——
  const queueNames = new Set(os.disk.queue.map((r) => r.进程名))
  const justUnblocked = new Set()
  for (let i = os.disk.ioBlocked.length - 1; i >= 0; i--) {
    const name = os.disk.ioBlocked[i]
    if (!queueNames.has(name)) {
      os.disk.ioBlocked.splice(i, 1)
      const proc = os.processes.find((p) => p.name === name)
      if (proc && proc.state === '阻塞') {
        proc.state = '就绪'
        proc.blockedReason = ''
        proc.pageWaitingFor = null
        proc.blockedAt = null
        justUnblocked.add(name)
        os.pushEvent('I/O完成', 'device', 'info',
          `${name} I/O 完成 → 解除阻塞，重新加入就绪队列`)
        if (os.config.schedAlgo === 'RR') {
          if (!schedRrQueue.includes(proc.pid)) {
            schedRrQueue.push(proc.pid)
          }
        }
      }
    }
  }

  // 第一轮：新建 → 就绪 转换，及服务时间到完成转换
  os.processes.forEach((p) => {
    if (p.ran >= p.burst && p.burst > 0) {
      if (p.state !== '完成') {
        p.state = '完成'
        p.finishTime = time
        os.pushEvent('进程完成', 'processor', 'info',
          `${p.name}(P${p.pid}) 服务时间用尽 → 完成`)
        
        // 释放其持有的所有银行家算法资源
        const r = os.resources
        const idx = os.processes.findIndex(x => x.pid === p.pid)
        if (idx >= 0) {
          const alloc = r.allocation[idx]
          if (alloc.some(v => v > 0)) {
            r.available = r.available.map((v, j) => v + alloc[j])
            r.allocation[idx] = alloc.map(() => 0)
            r.need[idx] = r.max[idx].map(() => 0)
            os.pushEvent('资源释放', 'resource', 'info', `${p.name} 完成，回收全部持有的资源 [${alloc}]`)
            refreshBankerSafety(os, false)
          }
        }
      }
    } else if (time < p.arrival) {
      p.state = '新建'
    } else if (p.state === '新建' && time >= p.arrival) {
      p.state = '就绪'
      if (os.config.schedAlgo === 'RR') {
        if (!schedRrQueue.includes(p.pid)) {
          schedRrQueue.push(p.pid)
        }
      }
      os.pushEvent('作业就绪', 'processor', 'info',
        `${p.name}(P${p.pid}) 到达 → 进入就绪队列`)
    }
  })

  // 第二轮：动态调度逻辑
  const currentRunning = os.processes.find(p => p.state === '运行')
  if (currentRunning) {
    if (currentRunning.ran >= currentRunning.burst) {
      schedCurrentPid = null
      schedQuantumUsed = 0
    } else if (os.config.schedAlgo === 'RR' && schedQuantumUsed >= os.config.quantum) {
      currentRunning.state = '就绪'
      if (!schedRrQueue.includes(currentRunning.pid)) {
        schedRrQueue.push(currentRunning.pid)
      }
      os.pushEvent('进程抢占', 'processor', 'info',
        `${currentRunning.name} 时间片到，让出 CPU 回就绪队列`)
      schedCurrentPid = null
      schedQuantumUsed = 0
    } else {
      schedQuantumUsed++
    }
  }

  // 调度核心：如果当前没有进程在运行，则从就绪队列挑选一个
  const runningNow = os.processes.find(p => p.state === '运行')
  if (!runningNow) {
    const readyProcs = os.processes.filter(p => p.state === '就绪' && !justUnblocked.has(p.name))
    if (readyProcs.length > 0) {
      let chosen = null
      const algo = os.config.schedAlgo

      if (algo === 'FCFS') {
        chosen = readyProcs.sort((a, b) => a.arrival - b.arrival || a.pid - b.pid)[0]
      } else if (algo === 'SJF') {
        chosen = readyProcs.sort((a, b) => (a.burst - a.ran) - (b.burst - b.ran) || a.arrival - b.arrival || a.pid - b.pid)[0]
      } else if (algo === 'HRRN') {
        const getRatio = (p) => {
          const wait = Math.max(0, time - p.arrival)
          const service = p.burst - p.ran
          return (wait + service) / Math.max(1, service)
        }
        chosen = readyProcs.sort((a, b) => getRatio(b) - getRatio(a) || a.pid - b.pid)[0]
      } else if (algo === 'PRIORITY') {
        chosen = readyProcs.sort((a, b) => a.priority - b.priority || a.arrival - b.arrival || a.pid - b.pid)[0]
      } else if (algo === 'RR') {
        let foundPid = null
        for (const pid of schedRrQueue) {
          if (readyProcs.some(c => c.pid === pid)) {
            foundPid = pid
            break
          }
        }
        if (foundPid !== null) {
          chosen = readyProcs.find(c => c.pid === foundPid)
          schedRrQueue = schedRrQueue.filter(pid => pid !== foundPid)
        } else {
          chosen = readyProcs.sort((a, b) => a.arrival - b.arrival || a.pid - b.pid)[0]
        }
      } else {
        chosen = readyProcs[0]
      }

      if (chosen) {
        chosen.state = '运行'
        schedCurrentPid = chosen.pid
        schedQuantumUsed = 1
        os.pushEvent('进程调度', 'processor', 'info',
          `${chosen.name}(P${chosen.pid}) 占用 CPU`)
      }
    }
  }

  // MMU 上下文切换
  const activeProc = os.processes.find(p => p.state === '运行')
  if (activeProc) {
    os.memory.pageTable = activeProc.pageTable.map(row => ({ ...row }))
    os.memory.lastReplace = { ...activeProc.lastReplace }
    os.memory.hits = activeProc.hits
    os.memory.faults = activeProc.faults
  }

  // 指标聚合
  const doneProcs = os.processes.filter((p) => p.state === '完成')
  os.metrics.completed = doneProcs.length
  os.metrics.readyLen = os.processes.filter((p) => p.state === '就绪').length
  os.metrics.blockedLen = os.processes.filter((p) => p.state === '阻塞').length
  os.metrics.throughput = +(doneProcs.length / Math.max(1, time)).toFixed(2)
  const turnarounds = doneProcs.map((p) => (p.finishTime ?? time) - p.arrival)
  os.metrics.avgTurnaround = turnarounds.length
    ? +(turnarounds.reduce((s, t) => s + t, 0) / turnarounds.length).toFixed(2)
    : 0

  return os.processes.find((p) => p.state === '运行') || null
}

// I/O 概率
const IO_PROB = {
  vim: 0.25, http: 0.20, db: 0.25, sync: 0.15,
  cron: 0.03, gcc: 0.03, init: 0.01, shell: 0.05,
  logger: 0.10, daemon: 0.08, default: 0.08
}
function getIoProb(name) {
  const prefix = name.replace(/\d+$/, '')
  return IO_PROB[prefix] ?? IO_PROB.default
}

function onCpuDiskRequest(os, runningProc) {
  const d = os.disk
  if (d.queue.length >= 8) return
  if (Math.random() >= getIoProb(runningProc.name)) return
  
  const req = makeRequest(os)
  if (runningProc) {
    req.进程名 = runningProc.name
  }
  d.queue.push(req)
  
  if (runningProc && !d.ioBlocked.includes(runningProc.name)) {
    d.ioBlocked.push(runningProc.name)
    runningProc.state = '阻塞'
    runningProc.blockedReason = `等待磁盘 I/O - 柱面 ${req.柱面号} 磁道 ${req.磁道号} 记录 ${req.物理记录号}`
  }
  os.pushEvent('I/O请求', 'device', 'info',
    `${req.进程名} 发起 I/O → 进入阻塞态：柱面 ${req.柱面号}/磁道 ${req.磁道号}/记录 ${req.物理记录号}`)
}

// ———————————————————————— 存储：分页置换 ————————————————————————

function memKey(os) {
  return JSON.stringify({
    algorithm: os.config.pageAlgo,
    refs: os.memory.refString,
    frames: os.memory.frameCount,
  })
}

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
      os.setPagingTrace(memTrace)
    } catch (e) {
      memTrace = localPagingTrace(os)
      memTraceKey = key
      os.clearPagingTrace(e?.message || '后端分页接口不可用')
      if (!memFallbackNotified) {
        os.pushEvent('分页回退', 'memory', 'warning', `后端分页接口不可用，使用本地备用分析`)
        memFallbackNotified = true
      }
    } finally {
      memTracePromise = null
    }
    return memTrace
  })()

  return memTracePromise
}

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
        } else {
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
 * 运行时进程独立的访存动作
 */
function applyMemoryStep(os) {
  const runningProc = os.processes.find((p) => p.state === '运行')
  if (!runningProc) return

  const refs = runningProc.refString
  const stepIdx = runningProc.refPtr % refs.length
  const page = refs[stepIdx]
  runningProc.refPtr++

  const hit = runningProc.pageTable[page]?.标志 === 1
  const now = os.clock
  const blockSize = os.config.blockSize || 128
  const unit = (page * 31 + now * 17) % blockSize

  if (hit) {
    runningProc.hits++
    runningProc.pageTable[page].lastUsed = now
    if (os.config.pageAlgo === 'CLOCK') {
      runningProc.pageTable[page].访问位 = 1
    }
    const willWrite = ((page + now) % 5) < 2
    if (willWrite) {
      runningProc.pageTable[page].修改位 = 1
    }
    const slot = runningProc.pageTable[page].主存块号
    const absAddr = slot * blockSize + unit

    runningProc.lastReplace = {
      访问页: page, 单元号: unit, 缺页: false,
      调出页: null, 装入页: null, 装入块: null, 写回: false,
      绝对地址: absAddr
    }

    os.memory.hits = runningProc.hits
    os.memory.refPtr = runningProc.refPtr
    os.memory.pageTable = runningProc.pageTable.map(row => ({ ...row }))
    os.memory.lastReplace = { ...runningProc.lastReplace }
  } else {
    const exists = os.disk.queue.some(r => r.进程名 === runningProc.name && r.isPageFault && r.page === page)
    if (!exists) {
      runningProc.state = '阻塞'
      runningProc.blockedReason = `缺页中断: 等待装入页 ${page}`
      runningProc.pageWaitingFor = page
      runningProc.blockedAt = now

      if (!os.disk.ioBlocked.includes(runningProc.name)) {
        os.disk.ioBlocked.push(runningProc.name)
      }

      os.disk.queue.push({
        进程名: runningProc.name,
        柱面号: (page * 31) % os.disk.cylinders,
        磁道号: 0,
        物理记录号: 0,
        isPageFault: true,
        page: page
      })

      os.pushEvent('缺页中断', 'memory', 'warning',
        `访问 [页 ${page} 单元 ${unit}] 缺页 —— 向磁盘队列发送读入请求，${runningProc.name} 进入阻塞`)
    }
  }
}

// 缺页 I/O 完成后，由设备模块回调的实际页面载入与置换逻辑
function loadPageAfterDiskIo(os, req) {
  const p = os.processes.find(x => x.name === req.进程名)
  if (!p) return

  const page = req.page
  const algo = os.config.pageAlgo || 'LRU'
  const frameCount = os.memory.frameCount

  let slot = os.memory.frames.indexOf(null)
  let evicted = null
  let wroteBack = false

  if (slot >= 0) {
    p.pageTable[page].标志 = 1
    p.pageTable[page].主存块号 = slot
    p.pageTable[page].loadTime = os.clock
    p.pageTable[page].lastUsed = os.clock
    p.pageTable[page].访问位 = 1
    p.pageTable[page].修改位 = page % 2
    os.memory.frames[slot] = page
  } else {
    if (algo === 'FIFO') {
      let minLoad = Infinity
      let chosen = 0
      for (let k = 0; k < frameCount; k++) {
        const owner = findFrameOwner(os, k)
        const loadTime = owner ? owner.pageRow.loadTime : -1
        if (loadTime < minLoad) { minLoad = loadTime; chosen = k }
      }
      slot = chosen
    } else if (algo === 'CLOCK') {
      let hand = os.memory.clockPtr || 0
      let found = false
      let loops = 0
      while (!found && loops < 100) {
        const owner = findFrameOwner(os, hand)
        if (!owner || owner.pageRow.访问位 === 0) {
          slot = hand
          found = true
        } else {
          owner.pageRow.访问位 = 0
          hand = (hand + 1) % frameCount
        }
        loops++
      }
      os.memory.clockPtr = (hand + 1) % frameCount
      slot = slot ?? 0
    } else if (algo === 'OPT') {
      let maxNext = -1
      let chosen = 0
      for (let k = 0; k < frameCount; k++) {
        const owner = findFrameOwner(os, k)
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
        const owner = findFrameOwner(os, k)
        const lastUsed = owner ? owner.pageRow.lastUsed : -1
        if (lastUsed < minUsed) { minUsed = lastUsed; chosen = k }
      }
      slot = chosen
    }

    const owner = findFrameOwner(os, slot)
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
    p.pageTable[page].loadTime = os.clock
    p.pageTable[page].lastUsed = os.clock
    p.pageTable[page].访问位 = 1
    p.pageTable[page].修改位 = 0
    os.memory.frames[slot] = page
  }

  p.faults++
  p.lastReplace = {
    访问页: page,
    单元号: (page * 31 + os.clock * 17) % (os.config.blockSize || 128),
    缺页: true,
    调出页: evicted,
    装入页: page,
    装入块: slot,
    写回: wroteBack,
    绝对地址: slot * (os.config.blockSize || 128) + ((page * 31 + os.clock * 17) % (os.config.blockSize || 128))
  }

  os.memory.pageTable = p.pageTable.map(row => ({ ...row }))
  os.memory.lastReplace = { ...p.lastReplace }
  os.memory.faults = p.faults

  const detail = evicted === null
    ? `装入物理块 ${slot}`
    : `调出页 ${evicted}${wroteBack ? '(已修改,写回外存)' : ''}，装入页 ${page} → 物理块 ${slot}`

  os.pushEvent('缺页装入', 'memory', 'info', `缺页处理完成: 页 ${page} 已装入 —— ${detail}`)
}

// ———————————————————————— 设备：磁盘驱动调度 ————————————————————————

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
 * 磁盘寻道调度与物理计时器模拟
 */
function serveDisk(os) {
  const d = os.disk
  if (!d.queue.length || d.activeRequest) return

  let chosenIdx = 0
  const algo = os.config.diskAlgo

  if (algo === 'SSTF') {
    let minDist = Infinity
    d.queue.forEach((r, idx) => {
      const dist = Math.abs(r.柱面号 - d.head)
      if (dist < minDist) { minDist = dist; chosenIdx = idx }
    })
  } else if (algo === 'SCAN' || algo === 'LOOK') {
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
  } else {
    chosenIdx = 0
  }

  const req = d.queue[chosenIdx]
  const seek = Math.abs(req.柱面号 - d.head)
  const serviceTime = Math.max(2, Math.round(seek / 10) + 1)

  d.head = req.柱面号
  d.direction = req.柱面号 >= d.head ? 1 : -1
  d.path.push(d.head)
  if (d.path.length > 30) d.path.shift()

  d.activeRequest = {
    ...req,
    seek,
    serviceTime,
    startTime: os.clock,
    finishTime: os.clock + serviceTime
  }

  recordDiskBusy(os, req.进程名, serviceTime)
  os.pushEvent('设备调度', 'device', 'info',
    `磁盘选中 ${req.进程名} 请求 (柱面 ${req.柱面号})，开始移动磁头，预计耗时 ${serviceTime} 拍`)
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

// ———————————————————————— 资源：银行家算法 ————————————————————————

function localSafety(os, available, max, allocation) {
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
        finish[i] = true
        seq.push(os.processes[i]?.name || `P${i}`)
        changed = true
      }
    }
  }
  const safe = finish.every(Boolean)
  const deadlock = finish.map((f, i) => (f ? null : (os.processes[i]?.name || `P${i}`))).filter(Boolean)
  return {
    metrics: { 安全: safe, 安全序列: safe ? seq : null },
    final_state: { Available: [...available], Max: max, Allocation: allocation, Need: need, 安全序列: safe ? seq : [], 死锁进程: deadlock },
  }
}

function localBankerRequest(os, r, pid, req) {
  const need = r.need
  if (!vecLe(req, need[pid])) return { metrics: { 可分配: false, 原因: `请求超过进程最大需求`, 安全: false }, final_state: { Need: need, Available: [...r.available] } }
  if (!vecLe(req, r.available)) return { metrics: { 可分配: false, 原因: `资源不足，请求 ${req} > 可用 ${r.available}，须等待`, 安全: false }, final_state: { Need: need, Available: [...r.available] } }
  const newAvail = r.available.map((v, j) => v - req[j])
  const newAlloc = r.allocation.map((row, i) => (i === pid ? row.map((v, j) => v + req[j]) : [...row]))
  const safety = localSafety(os, newAvail, r.max, newAlloc)
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

async function refreshBankerSafety(os, announce = true) {
  const r = os.resources
  let trace
  try {
    trace = await api.bankerSafety({ available: r.available, max: r.max, allocation: r.allocation })
    bankerFallbackNotified = false
  } catch (e) {
    trace = localSafety(os, r.available, r.max, r.allocation)
    if (!bankerFallbackNotified) {
      os.pushEvent('银行家回退', 'resource', 'warning', `后端银行家接口不可用，使用本地安全分析`)
      bankerFallbackNotified = true
    }
  }
  const safe = trace.metrics.安全
  r.safeSeq = translateProcessNames(os, trace.final_state.安全序列 || [])
  r.deadlock = !safe
  if (announce) {
    if (safe) os.pushEvent('安全性检查', 'resource', 'info', `银行家安全性检查通过，安全序列 ${r.safeSeq.join(',')}`)
    else os.pushEvent('死锁告警', 'resource', 'danger', `系统不安全！死锁挂起进程 ${translateProcessNames(os, trace.final_state.死锁进程 || []).join(',')}`)
  }
}

async function serveBankerRequest(os, proc) {
  if (bankerBusy || !proc) return
  bankerBusy = true
  try {
    const r = os.resources
    const n = r.allocation.length
    const i = os.processes.findIndex(x => x.pid === proc.pid)
    if (i < 0) return
    const phase = Math.floor(os.clock / 5)

    if (phase % 3 === 0) {
      const releaseIdx = clampIndex(phase, n)
      const alloc = r.allocation[releaseIdx]
      const ownerProc = os.processes[releaseIdx]
      if (ownerProc && ownerProc.state !== '完成' && ownerProc.state !== '新建' && alloc.some((v) => v > 0)) {
        const rel = alloc.map((v, j) => (v > 0 && (phase + j) % 2 === 0 ? 1 : 0))
        if (rel.some((v) => v > 0)) {
          r.available = r.available.map((v, j) => v + rel[j])
          r.allocation = r.allocation.map((row, ri) => (ri === releaseIdx ? row.map((v, j) => v - rel[j]) : row))
          r.need = calcNeed(r.max, r.allocation)
          os.pushEvent('资源释放', 'resource', 'info', `${ownerProc.name} 释放资源 [${rel}]，回收至可用资源池`)
          await refreshBankerSafety(os, false)
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

    let trace
    try {
      trace = await api.bankerRequest({ available: r.available, max: r.max, allocation: r.allocation, pid: i, request, use_banker: true })
      bankerFallbackNotified = false
    } catch (e) {
      trace = localBankerRequest(os, r, i, request)
      if (!bankerFallbackNotified) {
        os.pushEvent('银行家回退', 'resource', 'warning', `后端银行家接口不可用，使用前端分配逻辑`)
        bankerFallbackNotified = true
      }
    }

    const fs = trace.final_state || {}
    if (trace.metrics.可分配) {
      r.available = fs.Available
      r.allocation = fs.Allocation
      r.need = fs.Need
      r.safeSeq = translateProcessNames(os, fs.安全序列 || r.safeSeq)
      r.deadlock = false
      os.pushEvent('资源分配', 'resource', 'info', `${proc.name} 申请 [${request}] 获准，安全序列 ${r.safeSeq.join(',')}`)
    } else {
      os.pushEvent('资源请求', 'resource', 'warning', `${proc.name} 申请 [${request}] 未获准：${trace.metrics.原因 || '不安全 / 资源不足'}`)
      r.safeSeq = translateProcessNames(os, fs.安全序列 || [])
      if ((fs.死锁进程 || []).length) r.deadlock = true
    }
  } finally {
    bankerBusy = false
  }
}

// ———————————————————————— 同步：PV 生产者-消费者（与调度挂钩） ————————————————————————

function pvWakeConsumer(s, os, w) {
  const p = os.processes.find(x => x.name === w)
  if (p) {
    p.state = '就绪'
    p.blockedReason = ''
    if (os.config.schedAlgo === 'RR' && !schedRrQueue.includes(p.pid)) {
      schedRrQueue.push(p.pid)
    }
  }
  s.buffer--; s.consumed++; s.s1++
  if (s.s1 <= 0 && s.prodBlocked.length) {
    const nextW = s.prodBlocked.shift()
    os.pushEvent('同步唤醒', 'resource', 'info', `V(s1) 唤醒生产者 ${nextW}`)
    pvWakeProducer(s, os, nextW)
  }
}

function pvWakeProducer(s, os, w) {
  const p = os.processes.find(x => x.name === w)
  if (p) {
    p.state = '就绪'
    p.blockedReason = ''
    if (os.config.schedAlgo === 'RR' && !schedRrQueue.includes(p.pid)) {
      schedRrQueue.push(p.pid)
    }
  }
  s.buffer++; s.produced++; s.s2++
  if (s.s2 <= 0 && s.consBlocked.length) {
    const nextW = s.consBlocked.shift()
    os.pushEvent('同步唤醒', 'resource', 'info', `V(s2) 唤醒消费者 ${nextW}`)
    pvWakeConsumer(s, os, nextW)
  }
}

function pvProduce(s, proc, os) {
  s.s1--
  if (s.s1 < 0) {
    s.prodBlocked.push(proc)
    os.pushEvent('生产阻塞', 'resource', 'warning', `P(s1) 缓冲区满，生产者 ${proc} 进入同步阻塞`)
    const p = os.processes.find(x => x.name === proc)
    if (p) {
      p.state = '阻塞'
      p.blockedReason = 'PV同步阻塞: 缓冲区满'
    }
  } else {
    s.buffer++; s.produced++; s.s2++
    if (s.s2 <= 0 && s.consBlocked.length) {
      const w = s.consBlocked.shift()
      os.pushEvent('同步唤醒', 'resource', 'info', `V(s2) 唤醒消费者 ${w}`)
      pvWakeConsumer(s, os, w)
    }
  }
}

function pvConsume(s, proc, os) {
  s.s2--
  if (s.s2 < 0) {
    s.consBlocked.push(proc)
    os.pushEvent('消费阻塞', 'resource', 'warning', `P(s2) 缓冲区空，消费者 ${proc} 进入同步阻塞`)
    const p = os.processes.find(x => x.name === proc)
    if (p) {
      p.state = '阻塞'
      p.blockedReason = 'PV同步阻塞: 缓冲区空'
    }
  } else {
    s.buffer--; s.consumed++; s.s1++
    if (s.s1 <= 0 && s.prodBlocked.length) {
      const w = s.prodBlocked.shift()
      os.pushEvent('同步唤醒', 'resource', 'info', `V(s1) 唤醒生产者 ${w}`)
      pvWakeProducer(s, os, w)
    }
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

function syncProduce(os, running) {
  if (!running || !running.name) return
  const s = os.sync
  pvProduce(s, running.name, os)
}

function syncConsume(os, running) {
  if (!running || !running.name) return
  const s = os.sync
  pvConsume(s, running.name, os)
}

function addDeterministicArrival(os, t) {
  const pid = os.nextPid++
  const name = `${JOB_NAMES[clampIndex(pid, JOB_NAMES.length)]}${pid}`
  
  const refString = [...os.memory.refString]
  const maxPage = Math.max(...refString)
  const extAddr = (page) => '0' + String(11 + page).padStart(2, '0')
  const pageTableTemplate = []
  for (let p = 0; p <= maxPage; p++) {
    pageTableTemplate.push({
      页号: p, 标志: 0, 主存块号: null, 访问位: 0, 修改位: 0,
      外存地址: extAddr(p), loadTime: -1, lastUsed: -1,
    })
  }

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
    refString: refString,
    refPtr: 0,
    hits: 0,
    faults: 0,
    pageTable: pageTableTemplate,
    lastReplace: { 访问页: null, 缺页: false, 调出页: null, 装入页: null, 装入块: null, 写回: false }
  })
  
  os.resources.max.push([
    Math.floor(Math.random() * 4) + 1,
    Math.floor(Math.random() * 4) + 1,
    Math.floor(Math.random() * 3) + 1,
  ])
  os.resources.allocation.push([0, 0, 0])
  const newIdx = os.resources.max.length - 1
  os.resources.need.push(os.resources.max[newIdx].map((v, j) => v - os.resources.allocation[newIdx][j]))

  os.pushEvent('作业到达', 'processor', 'info', `新作业 ${name} 到达并加入就绪队列`)
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

  if (os.config.processAutoArrival && t % 7 === 0) addDeterministicArrival(os, t)

  // —— 设备：物理寻道计时器进度 ——
  if (os.disk.activeRequest) {
    if (t >= os.disk.activeRequest.finishTime) {
      const req = os.disk.activeRequest
      const globalIdx = os.disk.queue.findIndex(r => r.进程名 === req.进程名 && r.柱面号 === req.柱面号)
      if (globalIdx >= 0) os.disk.queue.splice(globalIdx, 1)

      if (req.isPageFault) {
        loadPageAfterDiskIo(os, req)
      }
      os.disk.served++
      os.disk.servedLog.unshift({ ...req, 寻道: req.seek, 服务时间: req.serviceTime, ts: t })
      if (os.disk.servedLog.length > 8) os.disk.servedLog.pop()
      os.pushEvent('设备完成', 'device', 'info', `${req.进程名} I/O 服务完成 (柱面 ${req.柱面号})`)
      os.disk.activeRequest = null
    }
  }

  if (!os.disk.activeRequest && os.disk.queue.length > 0) {
    serveDisk(os)
  }

  // —— 处理机调度 ——
  const running = applyCpuTrace(os)

  // —— 推进执行 ran ——
  if (running && running.state === '运行') {
    if (running.ran < running.burst) {
      running.ran = Math.min(running.burst, running.ran + 1)
      const last = os.gantt[os.gantt.length - 1]
      if (last && last.作业 === running.name && last.结束 === t - 1) {
        last.结束 = t
      } else {
        os.gantt.push({ 作业: running.name, 开始: t - 1, 结束: t })
      }
      if (running.ran >= running.burst) {
        running.finishTime = t
        running.state = '完成'
        os.pushEvent('进程完成', 'processor', 'info',
          `${running.name}(P${running.pid}) 服务时间用尽，周转 ${t - running.arrival}`)
      }
    }
  } else {
    // CPU 空闲
    const last = os.gantt[os.gantt.length - 1]
    if (last && last.作业 === '空闲' && last.结束 === t - 1) {
      last.结束 = t
    } else {
      os.gantt.push({ 作业: '空闲', 开始: t - 1, 结束: t })
    }
  }

  // 访存（CPU → 存储）：每个 tick 运行进程有 40% 的概率访存
  if (running && running.state === '运行' && Math.random() < 0.4) {
    applyMemoryStep(os)
  }
  // 磁盘 I/O（CPU → 设备）
  if (running && running.state === '运行' && t % 6 === 0) {
    onCpuDiskRequest(os, running)
  }
  // 资源（CPU → 银行家）
  if (running && running.state === '运行' && t % 5 === 0) {
    await serveBankerRequest(os, running)
  }
  // PV 同步（CPU → 同步）：运行中的生产者/消费者进程执行相应操作
  if (running && running.state === '运行' && t % 3 === 0) {
    if (isProducer(running)) {
      syncProduce(os, running)
    } else if (isConsumer(running)) {
      syncConsume(os, running)
    }
  }

  recomputeRuntimeMetrics(os)
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
    
    schedRrQueue = os.processes.filter(p => p.state === '就绪').map(p => p.pid)
    schedCurrentPid = os.processes.find(p => p.state === '运行')?.pid || null
    schedQuantumUsed = 0
    
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
    
    schedRrQueue = []
    schedCurrentPid = null
    schedQuantumUsed = 0
    
    os.resetState()
  }

  return { start, pause, step, setSpeed, reset }
}
