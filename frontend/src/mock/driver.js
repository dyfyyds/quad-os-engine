import { useOsStore } from '../store/os'
import { localTick } from './localTick'

/**
 * 驱动 —— 按虚拟时钟推进数字孪生。
 *
 * 整拍算法已抽到纯函数 localTick(state)（见 mock/localTick.js），本文件只负责：
 *   - 定时器编排（运行 / 单步 / 暂停 / 速度）
 *   - 把纯函数产出的事件并入 UI 事件流、记录历史曲线
 *   - 后端探活（backendMode）
 *
 * Task 7 将在 tick() 内加入「每拍先调后端 /api/twin/tick，断网回退本地 localTick」。
 */
let timer = null
let ticking = false

// 在 store 状态上推进一拍（本地纯整拍引擎），并把事件并入 UI 事件流。
function runLocalTick(os) {
  const { events } = localTick(os.$state)
  for (const e of events) os.pushEvent(e.type, e.core, e.level, e.desc)
  os.recordHistory()
}

// 推进一拍。Task 7 将在此加入「后端优先 + 断网回退」。
async function tick(os) {
  runLocalTick(os)
}

// 探活后端：成功 → backendMode='backend'；失败 → 'local'。
async function checkBackendImpl(os) {
  try {
    const res = await fetch('/api/health')
    os.memory.backendMode = res.ok ? 'backend' : 'local'
  } catch (e) {
    os.memory.backendMode = 'local'
  }
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

  function start() {
    if (os.running) return
    os.running = true
    schedule()
  }

  function pause() {
    os.running = false
    if (timer) { clearInterval(timer); timer = null }
  }

  async function step() {
    if (ticking) return
    ticking = true
    try {
      await tick(os)
    } finally {
      ticking = false
    }
  }

  function setSpeed(s) {
    os.speed = s
    if (os.running) schedule()
  }

  async function reset(keepConfig = false) {
    pause()
    // keepConfig=true：顶栏「刷新」——保留实验配置，仅重置运行态
    // keepConfig=false：系统设置「恢复默认」——清除持久化配置回到出厂默认
    if (keepConfig) os.resetRun()
    else os.resetState()
    await checkBackendImpl(os)
  }

  async function checkBackend() {
    await checkBackendImpl(os)
  }

  return { start, pause, step, setSpeed, reset, checkBackend }
}
