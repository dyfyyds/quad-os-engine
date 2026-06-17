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
      const d = { 运行: 0, 就绪: 0, 阻塞: 0, 完成: 0 }
      s.processes.forEach((p) => { d[p.state] = (d[p.state] || 0) + 1 })
      return d
    },
    alarms: (s) => s.events.filter((e) => e.level === 'warning' || e.level === 'danger'),
    // 四核心健康度（mock：由指标派生 0~100）
    coreHealth: (s) => ({
      processor: Math.round(100 - s.metrics.cpuUtil * 0.3),
      memory: Math.round(100 - s.metrics.faultRate * 60),
      resource: s.resources.deadlock ? 20 : 96,
      device: Math.max(40, 100 - s.disk.queue.length * 6),
    }),
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
    applyPagingStep(stepIndex) {
      const trace = this.memory.pagingTrace
      const step = trace?.steps?.[stepIndex]
      if (!step) return false

      const state = step.state || {}
      const frames = Array.isArray(state['页框']) ? state['页框'] : []
      const page = state['引用页']
      const fault = Boolean(state['缺页'])
      const evicted = state['换出页'] ?? null
      const faults = Number(state['累计缺页'] ?? this.memory.faults)

      this.memory.frames = frames.slice(0, this.memory.capacity)
      while (this.memory.frames.length < this.memory.capacity) this.memory.frames.push(null)

      this.memory.pageTable.forEach((row) => {
        row.标志 = 0
        row.主存块号 = null
        row.访问位 = 0
        row.修改位 = 0
      })
      this.memory.frames.forEach((pg, idx) => {
        if (pg === null || pg === undefined) return
        const row = this.memory.pageTable[pg]
        if (!row) return
        row.标志 = 1
        row.主存块号 = idx
        row.访问位 = pg === page ? 1 : 0
        row.lastUsed = stepIndex
        if (row.loadTime < 0) row.loadTime = stepIndex
      })

      const slot = this.memory.frames.indexOf(page)
      this.memory.faults = Number.isFinite(faults) ? faults : this.memory.faults
      this.memory.hits = Math.max(0, stepIndex + 1 - this.memory.faults)
      this.memory.refPtr = stepIndex + 1
      this.memory.traceCursor = stepIndex
      this.memory.lastReplace = {
        访问页: page ?? null,
        缺页: fault,
        调出页: evicted,
        装入页: page ?? null,
        装入块: slot >= 0 ? slot : null,
        写回: false,
      }

      if (fault) {
        const detail = evicted === null
          ? `装入空闲块 ${slot >= 0 ? slot : '—'}`
          : `换出页 ${evicted}，装入页 ${page} → 主存块 ${slot >= 0 ? slot : '—'}`
        this.pushEvent('缺页中断', 'memory', 'warning', `后端引擎：访问页 ${page} 缺页 —— ${detail}`)
      }
      return true
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
