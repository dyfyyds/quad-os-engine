import { ElMessage } from 'element-plus'
import { useOsStore } from '../store/os'
import { localTick, serializeSim, applySim } from './localTick'
import { api } from '../api/client'

let timer = null
let ticking = false
let backendDown = false

// 在 store 状态上推进一拍（本地纯整拍引擎），并把事件并入 UI 事件流。
function runLocalTick(os) {
  const { events } = localTick(os.$state)
  for (const e of events) os.pushEvent(e.type, e.core, e.level, e.desc)
  os.recordHistory()
}

// 推进一拍：后端优先 + 断网回退。
// 始终尝试后端，避免 localStorage 残留 backendMode='local' 导致永远不走后端。
async function tick(os) {
  try {
    const { state, events } = await api.twinTick({ state: serializeSim(os.$state) })
    applySim(os.$state, state)
    for (const e of events) os.pushEvent(e.type, e.core, e.level, e.desc)
    os.recordHistory()
    if (backendDown) {
      // 后端恢复：切回后端权威整拍，提示用户。
      backendDown = false
      os.pushEvent('整拍恢复', 'system', 'info', '后端整拍接口已恢复，切回后端权威仿真')
      ElMessage.success('后端已恢复，已切回后端整拍仿真')
    }
    os.memory.backendMode = 'backend'
    return
  } catch (e) {
    if (!backendDown) {
      // 后端不可用：降级到本地等价整拍，显式提示用户（仅在状态切换时弹一次，避免每拍刷屏）。
      backendDown = true
      os.memory.backendMode = 'local'
      os.pushEvent('整拍回退', 'system', 'warning', '后端整拍接口不可用，切换本地仿真')
      ElMessage.warning({
        message: '后端整拍接口不可用，已切换到本地等价仿真（本地与后端算法一致，结果可复现）',
        duration: 4000,
      })
    }
  }
  runLocalTick(os)
}

// 探活后端：成功 → backendMode='backend'；失败 → 'local'。
async function checkBackendImpl(os) {
  try {
    const res = await fetch('/api/health')
    if (res.ok) {
      os.memory.backendMode = 'backend'
      backendDown = false
    } else {
      os.memory.backendMode = 'local'
    }
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
