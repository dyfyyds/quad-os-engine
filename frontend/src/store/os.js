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
    resetState() {
      this.$state = seedState()
    },
  },
})
