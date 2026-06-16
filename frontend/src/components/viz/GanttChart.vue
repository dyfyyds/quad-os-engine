<template>
  <div class="viz-wrap">
    <svg v-if="gantt.length" viewBox="0 0 720 130" style="width: 100%; height: auto;">
      <g v-for="(seg, i) in gantt" :key="i">
        <rect :x="x(seg.开始)" y="34" :width="Math.max(1, x(seg.结束) - x(seg.开始))" height="44"
          :fill="i <= reveal ? color(seg.作业) : '#eef1f7'"
          :stroke="i === reveal ? '#1746a2' : '#fff'" :stroke-width="i === reveal ? 2 : 1" rx="3" />
        <text v-if="i <= reveal" :x="(x(seg.开始) + x(seg.结束)) / 2" y="61" text-anchor="middle"
          font-size="13" fill="#fff" font-weight="600">{{ seg.作业 }}</text>
      </g>
      <g v-for="(b, i) in bounds" :key="'b' + i">
        <line :x1="x(b)" y1="78" :x2="x(b)" y2="84" stroke="#9aa4b6" />
        <text :x="x(b)" y="98" text-anchor="middle" font-size="11" fill="#6b77a0">{{ b }}</text>
      </g>
      <line x1="34" y1="78" :x2="x(maxTime)" y2="78" stroke="#cdd5e3" />
    </svg>
    <el-empty v-else description="点击「运行」查看甘特图" :image-size="60" />
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  gantt: { type: Array, default: () => [] },
  reveal: { type: Number, default: -1 },
})

const margin = 34
const plotW = 660
const palette = ['#2f6fec', '#13a394', '#e0823d', '#9b59d0', '#d4537e', '#3aa655', '#e0a800']

const maxTime = computed(() => Math.max(1, ...props.gantt.map((s) => s.结束)))
const minTime = computed(() => Math.min(0, ...props.gantt.map((s) => s.开始)))
const bounds = computed(() => {
  const s = new Set()
  props.gantt.forEach((g) => { s.add(g.开始); s.add(g.结束) })
  return [...s].sort((a, b) => a - b)
})

function x(t) {
  return margin + ((t - minTime.value) / (maxTime.value - minTime.value)) * plotW
}
function color(name) {
  let h = 0
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) % palette.length
  return palette[h]
}
</script>
