import { useOsStore } from '../store/os'

/**
 * Mock 驱动 —— 按虚拟时钟推进，向中央 store 写入「连贯」的 OS 运行叙事，
 * 让总览大屏与各核心页彼此联动地「活」起来。
 *
 * 存储置换（FIFO/LRU/OPT/CLOCK）与磁盘驱动调度（FCFS/SSTF/SCAN/LOOK/C-SCAN/C-LOOK）
 * 均按 os.config 的算法选择真实分支执行，切换算法即刻改变行为。
 *
 * ⚠️ TODO(team): 本驱动为脚手架占位。团队接入真实逻辑时，用对
 * backend/app/engines/* 的真实编排替换 tick() 内的 mock 变更，
 * 保持对 store 字段的写入契约不变即可（详见 docs/接口契约.md）。
 */
let timer = null
const rand = (a, b) => a + Math.random() * (b - a)
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

// ———————————————————————— 处理机：就绪进程选择（按调度算法）————————————————————————
function chooseReady(ready, os) {
  const t = os.clock
  switch (os.config.schedAlgo) {
    case 'FCFS':
      return ready.reduce((a, b) => (a.arrival <= b.arrival ? a : b))
    case 'SJF':
      return ready.reduce((a, b) => ((a.burst - a.ran) <= (b.burst - b.ran) ? a : b))
    case 'HRRN':
      return ready.reduce((a, b) => {
        const ra = (t - a.arrival + a.burst) / Math.max(1, a.burst)
        const rb = (t - b.arrival + b.burst) / Math.max(1, b.burst)
        return ra >= rb ? a : b
      })
    case 'PRIORITY':
      return ready.reduce((a, b) => (a.priority <= b.priority ? a : b))
    case 'RR':
    default:
      return ready.reduce((a, b) => (a.arrival <= b.arrival ? a : b))
  }
}

// ———————————————————————— 存储：缺页置换的淘汰块选择 ————————————————————————
function chooseVictim(os) {
  const m = os.memory
  const occupied = m.frames.map((pg, idx) => ({ pg, idx })).filter((o) => o.pg !== null)

  switch (os.config.pageAlgo) {
    case 'FIFO':
      return occupied.reduce((a, b) => (m.pageTable[a.pg].loadTime <= m.pageTable[b.pg].loadTime ? a : b)).idx
    case 'OPT': {
      const ref = m.refString, L = ref.length
      // 从下一次访问起向后看一圈，淘汰「最久不再被使用」的驻留页
      const nextUse = (pg) => {
        for (let k = 0; k < L; k++) if (ref[(m.refPtr + k) % L] === pg) return k
        return Infinity
      }
      let best = occupied[0].idx, far = -1
      for (const o of occupied) {
        const d = nextUse(o.pg)
        if (d > far) { far = d; best = o.idx }
      }
      return best
    }
    case 'CLOCK': {
      const n = m.frames.length
      for (let guard = 0; guard < n * 2; guard++) {
        const ptr = m.clockPtr % n
        const pg = m.frames[ptr]
        if (pg === null || m.pageTable[pg].访问位 === 0) { m.clockPtr = (ptr + 1) % n; return ptr }
        m.pageTable[pg].访问位 = 0          // 给第二次机会，清访问位后前移
        m.clockPtr = (ptr + 1) % n
      }
      return 0
    }
    case 'LRU':
    default:
      return occupied.reduce((a, b) => (m.pageTable[a.pg].lastUsed <= m.pageTable[b.pg].lastUsed ? a : b)).idx
  }
}

// 一次访存：命中则更新访问/修改位；缺页则按算法置换并记录「调出页 / 装入页号」
function accessPage(os) {
  const m = os.memory
  const page = m.refString[m.refPtr % m.refString.length]
  m.refPtr++
  const now = os.clock
  const row = m.pageTable[page]
  const willWrite = Math.random() < 0.4   // 约四成访问为写操作 → 置「修改位」

  const fi = m.frames.indexOf(page)
  if (fi >= 0) {                            // —— 命中 ——
    m.hits++
    row.访问位 = 1
    row.lastUsed = now
    if (willWrite) row.修改位 = 1
    m.lastReplace = { 访问页: page, 缺页: false, 调出页: null, 装入页: page, 装入块: fi, 写回: false }
    return
  }

  // —— 缺页 ——
  m.faults++
  let slot = m.frames.indexOf(null)
  let victimPage = null
  let wroteBack = false
  if (slot < 0) {                           // 无空闲块 → 选淘汰块
    slot = chooseVictim(os)
    victimPage = m.frames[slot]
    const vrow = m.pageTable[victimPage]
    wroteBack = vrow.修改位 === 1            // 被淘汰页已修改 → 需写回外存
    vrow.标志 = 0; vrow.主存块号 = null; vrow.访问位 = 0; vrow.修改位 = 0
  }
  // 装入新页
  m.frames[slot] = page
  row.标志 = 1; row.主存块号 = slot; row.访问位 = 1; row.修改位 = willWrite ? 1 : 0
  row.loadTime = now; row.lastUsed = now
  m.lastReplace = { 访问页: page, 缺页: true, 调出页: victimPage, 装入页: page, 装入块: slot, 写回: wroteBack }

  const detail = victimPage === null
    ? `装入空闲块 ${slot}`
    : `调出页 ${victimPage}${wroteBack ? '(已修改,写回外存)' : ''}，装入页 ${page} → 主存块 ${slot}`
  os.pushEvent('缺页中断', 'memory', 'warning', `访问页 ${page} 缺页 —— ${detail}`)
}

// ———————————————————————— 设备：磁盘驱动调度（移臂 + 旋转）————————————————————————
function chooseDiskRequest(d, algo) {
  const q = d.queue
  if (algo === 'FCFS') return 0
  if (algo === 'SSTF') {
    let bi = 0, bd = Infinity
    q.forEach((r, i) => { const dist = Math.abs(r.柱面号 - d.head); if (dist < bd) { bd = dist; bi = i } })
    return bi
  }
  // SCAN / LOOK / C-SCAN / C-LOOK —— 沿当前方向取最近柱面，本方向无请求则换向
  const nearestIn = (dir) => {
    let bi = -1, bd = Infinity
    q.forEach((r, i) => {
      const ahead = dir > 0 ? r.柱面号 >= d.head : r.柱面号 <= d.head
      if (ahead) { const dist = Math.abs(r.柱面号 - d.head); if (dist < bd) { bd = dist; bi = i } }
    })
    return bi
  }
  let bi = nearestIn(d.direction)
  if (bi < 0) { d.direction = -d.direction; bi = nearestIn(d.direction) }
  return bi < 0 ? 0 : bi
}

function serveDisk(os) {
  const d = os.disk
  const idx = chooseDiskRequest(d, os.config.diskAlgo)
  const req = d.queue[idx]
  const seek = Math.abs(req.柱面号 - d.head)
  if (req.柱面号 !== d.head) d.direction = req.柱面号 > d.head ? 1 : -1
  // 移臂调度：移动到目标柱面
  d.totalSeek += seek
  d.head = req.柱面号
  d.path.push(req.柱面号)
  if (d.path.length > 30) d.path.shift()
  // 旋转调度：柱面内旋转到目标物理记录
  d.currentRecord = req.物理记录号
  d.queue.splice(idx, 1)
  d.served++
  d.servedLog.unshift({ ...req, 寻道: seek, ts: os.clock })
  if (d.servedLog.length > 8) d.servedLog.pop()
  os.pushEvent('驱动调度', 'device', 'info',
    `${req.进程名}：移臂至柱面 ${req.柱面号}(寻道 ${seek}) → 磁道 ${req.磁道号}/旋转至记录 ${req.物理记录号}`)
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

// ———————————————————————— 主时钟步进 ————————————————————————
function tick(os) {
  os.clock++
  const t = os.clock

  // —— 处理机：运行态进程推进 ——
  let running = os.processes.find((p) => p.state === '运行')
  if (running) {
    running.ran++
    if (running.ran >= running.burst) {
      running.state = '完成'
      const seg = os.gantt[os.gantt.length - 1]
      if (seg && seg.作业 === running.name) seg.结束 = t
      os.metrics.completed++
      os.pushEvent('进程完成', 'processor', 'info', `进程 ${running.name}(P${running.pid}) 执行完毕，周转 ${t - running.arrival}`)
      running = null
    } else if (t % os.config.quantum === 0) {
      running.state = '就绪'
      os.pushEvent('进程切换', 'processor', 'info', `时间片到，${running.name} 让出 CPU`)
      running = null
    }
  }
  // 调度下一个就绪进程（按 schedAlgo）
  if (!running) {
    const ready = os.processes.filter((p) => p.state === '就绪')
    if (ready.length) {
      const next = chooseReady(ready, os)
      next.state = '运行'
      os.gantt.push({ 作业: next.name, 开始: t, 结束: t + 1 })
      if (os.gantt.length > 24) os.gantt.shift()
      os.pushEvent('进程调度', 'processor', 'info', `${os.config.schedAlgo} 调度器选中 ${next.name}(P${next.pid}) 占用 CPU`)
    }
  } else {
    const seg = os.gantt[os.gantt.length - 1]
    if (seg && seg.作业 === running.name) seg.结束 = t
  }

  // —— 存储：访存与缺页置换 ——
  if (running && Math.random() < 0.7) accessPage(os)

  // —— 新作业到达 ——
  if (t % 7 === 0) {
    const name = pick(['gcc', 'vim', 'sync', 'cron', 'http', 'db'])
    os.processes.push({ pid: os.nextPid++, name, state: '就绪', arrival: t, burst: Math.round(rand(4, 10)), ran: 0, priority: Math.round(rand(1, 4)) })
    os.pushEvent('作业到达', 'processor', 'info', `新作业 ${name} 进入就绪队列`)
    if (os.processes.length > 12) os.processes.shift()
  }

  // —— 阻塞进程唤醒 ——
  const blocked = os.processes.filter((p) => p.state === '阻塞')
  if (blocked.length && Math.random() < 0.3) {
    const p = pick(blocked)
    p.state = '就绪'
    os.pushEvent('进程唤醒', 'processor', 'info', `${p.name} I/O 完成，回到就绪队列`)
  }

  // —— 资源：银行家分配（mock）——
  if (t % 5 === 0) {
    const r = os.resources
    if (Math.random() < 0.12) {
      r.deadlock = true
      os.pushEvent('死锁告警', 'resource', 'danger', '检测到循环等待，系统进入不安全状态')
    } else {
      r.deadlock = false
      r.safeSeq = ['P1', 'P3', 'P4', 'P0', 'P2']
      os.pushEvent('资源分配', 'resource', 'info', `银行家算法通过安全性检查，安全序列 ${r.safeSeq.join(',')}`)
    }
  }

  // —— 设备：磁盘驱动调度 ——
  if (os.disk.queue.length && t % 2 === 0) serveDisk(os)
  if (os.disk.queue.length < 6 && t % 6 === 0) {
    const req = makeRequest(os)
    os.disk.queue.push(req)
    os.pushEvent('I/O请求', 'device', 'info', `新增 I/O 请求：${req.进程名} 柱面 ${req.柱面号}/磁道 ${req.磁道号}/记录 ${req.物理记录号}`)
  }

  // —— 同步：生产者-消费者 ——
  if (Math.random() < 0.4) {
    const s = os.sync
    if (Math.random() < 0.5 && s.buffer < s.capacity) { s.buffer++; s.s1--; s.s2++; s.produced++ }
    else if (s.buffer > 0) { s.buffer--; s.s1++; s.s2--; s.consumed++ }
  }

  // —— 指标聚合 ——
  const used = os.memory.frames.filter((x) => x !== null).length
  const refs = os.memory.faults + os.memory.hits
  const target = running ? rand(72, 96) : rand(6, 18)
  os.metrics.cpuUtil = Math.round(os.metrics.cpuUtil + (target - os.metrics.cpuUtil) * 0.45)
  os.metrics.memUtil = Math.round((used / os.memory.capacity) * 100)
  os.metrics.readyLen = os.processes.filter((p) => p.state === '就绪').length
  os.metrics.blockedLen = os.processes.filter((p) => p.state === '阻塞').length
  os.metrics.diskQueueLen = os.disk.queue.length
  os.metrics.faultRate = refs ? Math.round((os.memory.faults / refs) * 100) : 0
  os.metrics.throughput = +(os.metrics.completed / Math.max(1, t)).toFixed(2)
  os.metrics.avgTurnaround = os.metrics.completed
    ? Math.round(os.doneProcs.reduce((a, p) => a + (p.burst + p.arrival), 0) / os.metrics.completed)
    : 0
  os.recordHistory()
}

export function useOsDriver() {
  const os = useOsStore()

  function schedule() {
    if (timer) clearInterval(timer)
    timer = setInterval(() => tick(os), Math.max(120, 900 / os.speed))
  }
  function start() { if (os.running) return; os.running = true; schedule() }
  function pause() { os.running = false; if (timer) { clearInterval(timer); timer = null } }
  function step() { tick(os) }
  function setSpeed(s) { os.speed = s; if (os.running) schedule() }
  function reset() { pause(); os.resetState() }

  return { start, pause, step, setSpeed, reset }
}
