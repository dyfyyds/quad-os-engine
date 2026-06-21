// SimState 序列化契约自检。运行：node frontend/scripts/simstate_check.mjs
import { serializeSim, applySim, SIM_FIELDS } from '../src/mock/localTick.js'

const state = {
  clock: 3, rngState: 99, nextPid: 6, gantt: [{ 作业: 'a', 开始: 0, 结束: 1 }],
  scheduler: { rrQueue: [1, 2], currentPid: 1, quantumUsed: 2 },
  processes: [{ pid: 1, state: '运行' }], resources: { available: [1] },
  sync: { s1: 4 }, disk: { head: 53, queue: [] }, metrics: { cpuUtil: 0 },
  config: { schedAlgo: 'RR' },
  memory: { frames: [null], backendMode: 'backend', pagingTrace: { x: 1 } },
}
const sim = serializeSim(state)
console.assert(sim.memory.backendMode === undefined, 'UI-only 应被剔除')
console.assert(sim.clock === 3 && sim.scheduler.rrQueue.length === 2, '算法字段应保留')

const target = { memory: { frames: [], backendMode: 'local', backendError: 'e', pagingTrace: null, traceCursor: -1 } }
for (const k of SIM_FIELDS) if (!(k in target)) target[k] = undefined
applySim(target, sim)
console.assert(target.memory.backendMode === 'local', 'apply 应保留 target 的 UI-only')
console.assert(target.memory.frames[0] === null, 'apply 应覆盖算法字段')
console.assert(target.clock === 3 && target.scheduler.currentPid === 1, 'apply 应覆盖顶层算法字段')

console.log('simstate OK')
