import { computed, ref } from 'vue'

/**
 * 通用「分步 trace」播放控制：运行 / 单步 / 上一步 / 重置 / 自动播放。
 * 各模块视图共用，只需把后端返回的 SimulationTrace 交给 setTrace()。
 */
export function useSimulation() {
  const trace = ref(null)
  const cursor = ref(-1) // -1 = 初始态；0..n-1 = 第 i 步
  const playing = ref(false)
  let timer = null

  const steps = computed(() => trace.value?.steps || [])
  const currentStep = computed(() =>
    cursor.value >= 0 && cursor.value < steps.value.length ? steps.value[cursor.value] : null
  )
  const metrics = computed(() => trace.value?.metrics || {})
  const finalState = computed(() => trace.value?.final_state || {})
  const total = computed(() => steps.value.length)

  function setTrace(t) {
    trace.value = t
    cursor.value = -1
    pause()
  }
  function next() {
    if (cursor.value < total.value - 1) cursor.value++
    else pause()
  }
  function prev() {
    if (cursor.value > -1) cursor.value--
  }
  function reset() {
    cursor.value = -1
    pause()
  }
  function toEnd() {
    cursor.value = total.value - 1
    pause()
  }
  function play() {
    if (!total.value) return
    if (cursor.value >= total.value - 1) cursor.value = -1
    playing.value = true
    timer = setInterval(() => {
      if (cursor.value >= total.value - 1) pause()
      else cursor.value++
    }, 650)
  }
  function pause() {
    playing.value = false
    if (timer) { clearInterval(timer); timer = null }
  }

  return {
    trace, cursor, steps, total, currentStep, metrics, finalState, playing,
    setTrace, next, prev, reset, toEnd, play, pause,
  }
}
