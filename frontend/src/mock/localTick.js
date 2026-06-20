// 前端离线整拍引擎 + SimState 序列化契约。
//
// 本文件分两部分：
//   1) 序列化契约 serializeSim/applySim（本任务）—— 决定哪些字段进后端 round-trip。
//   2) 纯函数 seedSim/localTick（Task 3 填充）—— 不触 store、不调后端、不用 Math.random。

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
