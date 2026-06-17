import { defineStore } from 'pinia'
import { seedState } from '../mock/seed'

/**
 * 中央 OS 运行状态 —— 全平台唯一数据源（联动接缝 + 接口契约）。
 *
 * 各字段即「接口契约」：未来团队把 mock 驱动替换为调用真实算法引擎
 * (backend/app/engines/*) 时，只需保持这些字段的形状不变，所有页面无需改动。
 * 详见 docs/接口契约.md。
 */
export const useOsStore = defineStore('os', {
  state: () => seedState(),

  getters: {
    runningProc: (s) => s.processes.find((p) => p.state === '运行') || null,
    readyProcs: (s) => s.processes.filter((p) => p.state === '就绪'),
    blockedProcs: (s) => s.processes.filter((p) => p.state === '阻塞'),
    doneProcs: (s) => s.processes.filter((p) => p.state === '完成'),
    stateDist: (s) => {
      const d = { 新建: 0, 运行: 0, 就绪: 0, 阻塞: 0, 完成: 0 }
      s.processes.forEach((p) => { d[p.state] = (d[p.state] || 0) + 1 })
      return d
    },
    alarms: (s) => s.events.filter((e) => e.level === 'warning' || e.level === 'danger'),

    // 四核心健康度（0~100）——基于运行期联动信号的多维度评分。
    // 每核心列出 reasons 数组（{label, delta}）供 UI tooltip 解释为什么是这个分数。
    coreHealth: (s) => {
      const total = s.processes.length || 1
      const blocked = s.processes.filter((p) => p.state === '阻塞').length
      const running = s.processes.find((p) => p.state === '运行')
      const completed = s.processes.filter((p) => p.state === '完成').length
      const pageBlocked = s.processes.filter((p) => p.state === '阻塞' && p.pageWaitingFor != null).length
      const ioBlockedCount = (s.disk.ioBlocked || []).length
      const cu = s.metrics.cpuUtil
      const memUtil = s.metrics.memUtil
      const fr = s.metrics.faultRate
      const busy = s.disk.busyRate || 0

      // —— 处理机：CPU 真在工作=好；阻塞率高/空转=坏 ——
      const pr = []
      let processor = 100
      if (!running) { processor -= 20; pr.push({ label: '无运行进程（CPU 空闲）', delta: -20 }) }
      const blockRatio = blocked / total
      const blockPenalty = Math.min(40, Math.round(blockRatio * 80))
      if (blockPenalty > 0) { processor -= blockPenalty; pr.push({ label: `阻塞占比 ${Math.round(blockRatio * 100)}%`, delta: -blockPenalty }) }
      if (cu < 10) { processor -= 15; pr.push({ label: `CPU 利用率 ${cu}% 过低（空转）`, delta: -15 }) }
      else if (cu > 95) { processor -= 5; pr.push({ label: `CPU 利用率 ${cu}% 过载`, delta: -5 }) }
      const completedBonus = Math.min(15, completed * 3)
      if (completedBonus > 0) { processor += completedBonus; pr.push({ label: `已完成 ${completed} 进程`, delta: +completedBonus }) }

      // —— 存储：缺页率 + 缺页阻塞数 + 内存近满 ——
      const mr = []
      let memory = 100
      const frPenalty = Math.min(50, Math.round(fr * 0.7))
      if (frPenalty > 0) { memory -= frPenalty; mr.push({ label: `缺页率 ${fr}%`, delta: -frPenalty }) }
      const pbPenalty = Math.min(20, pageBlocked * 8)
      if (pbPenalty > 0) { memory -= pbPenalty; mr.push({ label: `缺页阻塞 ${pageBlocked} 进程`, delta: -pbPenalty }) }
      if (memUtil > 92) { memory -= 10; mr.push({ label: `内存占用 ${memUtil}% 趋满`, delta: -10 }) }
      if (mr.length === 0) mr.push({ label: '存储运行平稳', delta: 0 })

      // —— 资源：死锁/安全序列/可用资源 ——
      const rr = []
      let resource = 100
      if (s.resources.deadlock) { resource = 20; rr.push({ label: '系统死锁', delta: -80 }) }
      else if (!(s.resources.safeSeq && s.resources.safeSeq.length)) {
        resource = 65
        rr.push({ label: '安全序列未确认', delta: -35 })
      } else {
        const avail = (s.resources.available || []).reduce((a, b) => a + b, 0)
        if (avail === 0) { resource -= 15; rr.push({ label: '可用资源池为空', delta: -15 }) }
        else rr.push({ label: `安全序列 ${s.resources.safeSeq.join('→')}`, delta: 0 })
      }

      // —— 设备：I/O 阻塞数 + 磁盘忙碌率 + 队列积压 ——
      const dr = []
      let device = 100
      const ioPenalty = Math.min(35, ioBlockedCount * 10)
      if (ioPenalty > 0) { device -= ioPenalty; dr.push({ label: `I/O 阻塞 ${ioBlockedCount} 进程`, delta: -ioPenalty }) }
      const queuePenalty = Math.min(20, Math.max(0, s.disk.queue.length - 4) * 5)
      if (queuePenalty > 0) { device -= queuePenalty; dr.push({ label: `I/O 队列积压 ${s.disk.queue.length}`, delta: -queuePenalty }) }
      if (busy > 90) { device -= 12; dr.push({ label: `磁盘忙碌率 ${busy}% 过载`, delta: -12 }) }
      else if (busy < 5 && s.disk.queue.length > 0) { device -= 8; dr.push({ label: '队列有请求但磁盘几乎空转', delta: -8 }) }
      if (dr.length === 0) dr.push({ label: '设备运行平稳', delta: 0 })

      const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)))
      return {
        processor: clamp(processor), processorReasons: pr,
        memory: clamp(memory),       memoryReasons: mr,
        resource: clamp(resource),   resourceReasons: rr,
        device: clamp(device),       deviceReasons: dr,
      }
    },
  },

  actions: {
    pushEvent(type, core, level, desc) {
      this.events.unshift({ ts: this.clock, type, core, level, desc })
      if (this.events.length > 300) this.events.pop()
    },
    recordHistory() {
      const h = this.history
      h.labels.push(this.clock)
      h.cpu.push(this.metrics.cpuUtil)
      h.mem.push(this.metrics.memUtil)
      h.fault.push(this.metrics.faultRate)
      h.throughput.push(this.metrics.throughput)
      const cap = 40
      for (const k of ['labels', 'cpu', 'mem', 'fault', 'throughput']) {
        if (h[k].length > cap) h[k].shift()
      }
    },
    setPagingTrace(trace) {
      this.memory.pagingTrace = trace
      this.memory.traceCursor = -1
      this.memory.backendMode = 'backend'
      this.memory.backendError = ''
    },
    clearPagingTrace(message = '') {
      this.memory.pagingTrace = null
      this.memory.traceCursor = -1
      this.memory.backendMode = 'local'
      this.memory.backendError = message
    },
    resetState() {
      this.$state = seedState()
    },
    // 按当前（已编辑）config 重建 memory/disk —— 系统设置「保存配置」即生效
    applyConfig() {
      this.$state = seedState(this.config)
    },
  },
})
