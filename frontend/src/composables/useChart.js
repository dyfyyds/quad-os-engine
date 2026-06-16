import * as echarts from 'echarts'
import { onActivated, onBeforeUnmount, onMounted, ref, watch } from 'vue'

/** 通用 ECharts 封装：传入 option 工厂与响应式依赖，自动渲染/重绘/自适应。 */
export function useChart(getOption, watchSource) {
  const el = ref(null)
  let chart = null

  function render() {
    if (chart) chart.setOption(getOption(), true)
  }
  function resize() {
    if (chart) chart.resize()
  }

  onMounted(() => {
    chart = echarts.init(el.value)
    render()
    window.addEventListener('resize', resize)
  })
  onActivated(() => {
    resize()
  })
  onBeforeUnmount(() => {
    window.removeEventListener('resize', resize)
    if (chart) { chart.dispose(); chart = null }
  })

  if (watchSource) watch(watchSource, render, { deep: true })

  return { el, resize }
}
