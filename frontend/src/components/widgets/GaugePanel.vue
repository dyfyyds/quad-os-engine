<template>
  <div ref="el" :style="{ height: height + 'px', width: '100%' }"></div>
</template>

<script setup>
import { useChart } from '../../composables/useChart'

const props = defineProps({
  value: { type: Number, default: 0 },
  label: { type: String, default: '' },
  color: { type: String, default: '#15a98a' },
  max: { type: Number, default: 100 },
  unit: { type: String, default: '%' },
  height: { type: Number, default: 170 },
})

const { el } = useChart(
  () => ({
    series: [{
      type: 'gauge', startAngle: 210, endAngle: -30, min: 0, max: props.max,
      progress: { show: true, width: 10, roundCap: true, itemStyle: { color: props.color } },
      axisLine: { lineStyle: { width: 10, color: [[1, '#eef2f6']] } },
      axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false },
      pointer: { show: false }, anchor: { show: false },
      detail: { valueAnimation: true, fontSize: 22, fontWeight: 700, offsetCenter: [0, '8%'], formatter: `{value}${props.unit}`, color: props.color },
      title: { offsetCenter: [0, '42%'], fontSize: 12, color: '#8a96a6' },
      data: [{ value: props.value, name: props.label }],
    }],
  }),
  () => [props.value, props.label]
)
</script>
