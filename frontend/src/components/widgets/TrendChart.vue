<template>
  <div ref="el" :style="{ height: height + 'px', width: '100%' }"></div>
</template>

<script setup>
import { useChart } from '../../composables/useChart'

const props = defineProps({
  labels: { type: Array, default: () => [] },
  series: { type: Array, default: () => [] }, // [{name,data,color}]
  height: { type: Number, default: 220 },
  area: { type: Boolean, default: true },
})

const { el } = useChart(
  () => ({
    grid: { left: 40, right: 16, top: 28, bottom: 26 },
    tooltip: { trigger: 'axis' },
    legend: { show: props.series.length > 1, top: 0, itemWidth: 12, itemHeight: 8, textStyle: { fontSize: 11 } },
    xAxis: { type: 'category', boundaryGap: false, data: props.labels, axisLine: { lineStyle: { color: '#dce3ea' } }, axisLabel: { color: '#8a96a6', fontSize: 10 } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: '#eef2f6' } }, axisLabel: { color: '#8a96a6', fontSize: 10 } },
    series: props.series.map((s) => ({
      name: s.name, type: 'line', smooth: true, showSymbol: false, data: s.data,
      lineStyle: { color: s.color, width: 2 }, itemStyle: { color: s.color },
      areaStyle: props.area ? { color: s.color + '22' } : undefined,
    })),
  }),
  () => [props.labels, props.series]
)
</script>
