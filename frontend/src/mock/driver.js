import { useOsStore } from '../store/os'

/**
 * Mock 驱动 —— 按虚拟时钟推进，向中央 store 写入「连贯」的 OS 运行叙事，
 * 让总览大屏与各核心页彼此联动地「活」起来。
 *
 * ⚠️ TODO(team): 本驱动为脚手架占位。团队接入真实逻辑时，用对
 * backend/app/engines/* 的真实编排替换 tick() 内的 mock 变更，
 * 保持对 store 字段的写入契约不变即可（详见 docs/接口契约.md）。
 */
let timer = null
const rand = (a, b) => a + Math.random() * (b - a)
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

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
  // 调度下一个就绪进程
  if (!running) {
    const ready = os.processes.filter((p) => p.state === '就绪')
    if (ready.length) {
      const next = ready.reduce((a, b) => (a.priority <= b.priority ? a : b))
      next.state = '运行'
      os.gantt.push({ 作业: next.name, 开始: t, 结束: t + 1 })
      if (os.gantt.length > 24) os.gantt.shift()
      os.pushEvent('进程调度', 'processor', 'info', `调度器选中 ${next.name}(P${next.pid}) 占用 CPU`)
    }
  } else {
    const seg = os.gantt[os.gantt.length - 1]
    if (seg && seg.作业 === running.name) seg.结束 = t
  }

  // —— 存储：访存与缺页 ——
  if (running && Math.random() < 0.7) {
    const m = os.memory
    const page = m.refString[m.refPtr % m.refString.length]
    m.refPtr++
    if (m.frames.includes(page)) {
      m.hits++
    } else {
      m.faults++
      const free = m.frames.indexOf(null)
      const victimIdx = free >= 0 ? free : Math.floor(rand(0, m.frames.length))
      m.frames[victimIdx] = page
      os.pushEvent('缺页中断', 'memory', 'warning', `访问页 ${page} 缺页，装入主存块 ${victimIdx}`)
    }
  }

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

  // —— 设备：磁盘 I/O ——
  if (os.disk.queue.length && t % 2 === 0) {
    const d = os.disk
    const nearest = d.queue.reduce((a, b) => (Math.abs(b - d.head) < Math.abs(a - d.head) ? b : a))
    d.totalSeek += Math.abs(nearest - d.head)
    d.head = nearest
    d.path.push(nearest)
    if (d.path.length > 30) d.path.shift()
    d.queue = d.queue.filter((x) => x !== nearest)
    d.served++
    os.pushEvent('I/O完成', 'device', 'info', `磁头移动至磁道 ${nearest}，本次寻道服务完成`)
  }
  if (os.disk.queue.length < 3 && t % 6 === 0) {
    os.disk.queue.push(Math.round(rand(0, os.disk.trackCount - 1)))
    os.pushEvent('I/O请求', 'device', 'info', '新增磁盘访问请求')
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
