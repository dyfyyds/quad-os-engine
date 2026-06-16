<template>
  <div class="viz-wrap">
    <svg v-if="path.length" :viewBox="`0 0 412 ${height}`" style="width: 100%; height: auto;">
      <!-- 纵向刻度网格 -->
      <g v-for="t in ticks" :key="'t' + t">
        <line :x1="x(t)" y1="18" :x2="x(t)" :y2="height - 12" stroke="#e6eaf2" />
        <text :x="x(t)" y="12" text-anchor="middle" font-size="10" fill="#9aa4b6">{{ t }}</text>
      </g>
      <!-- 未走到的轨迹（虚线浅色） -->
      <polyline :points="dimPoints" fill="none" stroke="#cdd8ee" stroke-width="2" stroke-dasharray="4 3" />
      <!-- 已走过的轨迹 -->
      <polyline :points="litPoints" fill="none" stroke="#2f6fec" stroke-width="2.5" />
      <!-- 节点 -->
      <g v-for="(p, i) in path" :key="'p' + i">
        <circle :cx="x(p)" :cy="y(i)" :r="i === reveal + 1 ? 6 : 4"
          :fill="i <= reveal + 1 ? (i === reveal + 1 ? '#1746a2' : '#2f6fec') : 'none'"
          :stroke="i <= reveal + 1 ? 'none' : '#cdd8ee'" stroke-width="1.5" />
        <text v-if="i === 0" :x="x(p)" :y="y(i) - 8" text-anchor="middle" font-size="9" fill="#6b77a0">{{ p }}起</text>
        <text v-else-if="i === reveal + 1" :x="x(p)" :y="y(i) - 8" text-anchor="middle" font-size="10" fill="#1746a2" font-weight="600">{{ p }}</text>
      </g>
    </svg>
    <el-empty v-else description="点击「运行」查看磁头移动轨迹" :image-size="60" />
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  path: { type: Array, default: () => [] },     // [head, w1, w2, ...]
  diskSize: { type: Number, default: 200 },
  reveal: { type: Number, default: -1 },         // 当前步 cursor，已走 reveal+1 段
})

const marginX = 36
const plotW = 340
const top = 26
const rowH = computed(() => Math.max(16, Math.min(30, 300 / Math.max(1, props.path.length - 1))))
const height = computed(() => top + (props.path.length - 1) * rowH.value + 22)

const ticks = computed(() => {
  const max = props.diskSize - 1
  return [0, Math.round(max * 0.25), Math.round(max * 0.5), Math.round(max * 0.75), max]
})

function x(t) { return marginX + (t / (props.diskSize - 1)) * plotW }
function y(i) { return top + i * rowH.value }

const litPoints = computed(() =>
  props.path.slice(0, props.reveal + 2).map((p, i) => `${x(p)},${y(i)}`).join(' ')
)
const dimPoints = computed(() =>
  props.path.slice(Math.max(0, props.reveal + 1)).map((p, i) =>
    `${x(p)},${y(i + Math.max(0, props.reveal + 1))}`).join(' ')
)
</script>
