<template>
  <div ref="el" :style="{ height: height + 'px', width: '100%' }"></div>
</template>

<script setup>
import { useChart } from '../../composables/useChart'

const props = defineProps({
  data: { type: Array, default: () => [] }, // [{name,value,color}]
  height: { type: Number, default: 200 },
})

const { el } = useChart(
  () => ({
    tooltip: { trigger: 'item' },
    legend: { bottom: 0, itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 11 } },
    series: [{
      type: 'pie', radius: ['46%', '68%'], center: ['50%', '44%'], avoidLabelOverlap: true,
      label: { show: true, fontSize: 11, formatter: '{b} {c}' }, labelLine: { length: 6, length2: 8 },
      data: props.data.map((d) => ({ name: d.name, value: d.value, itemStyle: { color: d.color } })),
    }],
  }),
  () => props.data
)
</script>
