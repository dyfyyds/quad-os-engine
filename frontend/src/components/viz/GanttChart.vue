<template>
  <div class="viz-wrap">
    <div v-if="gantt.length" ref="scrollRef" class="gantt-scroll">
      <svg :width="contentWidth" height="130" :viewBox="`0 0 ${contentWidth} 130`" class="gantt-svg">
        <g v-for="(seg, i) in gantt" :key="i">
          <rect :x="x(seg.开始)" y="34" :width="barWidth(seg)" height="44"
            :fill="i <= effectiveReveal ? color(seg.作业) : '#eef1f7'"
            :stroke="i === effectiveReveal ? '#1746a2' : '#fff'" :stroke-width="i === effectiveReveal ? 2 : 1" rx="3" />
          <text v-if="i <= effectiveReveal" :x="(x(seg.开始) + x(seg.结束)) / 2" y="61" text-anchor="middle"
            font-size="13" :fill="seg.作业 === '空闲' ? '#9aa4b6' : '#fff'" font-weight="600">{{ seg.作业 }}</text>
          <text v-else :x="(x(seg.开始) + x(seg.结束)) / 2" y="61" text-anchor="middle"
            font-size="13" fill="#9aa4b6" font-weight="600">{{ seg.作业 }}</text>
        </g>
        <g v-for="b in quantumLines" :key="'q' + b">
          <line :x1="x(b)" y1="34" :x2="x(b)" y2="78" stroke="#3b82f6" stroke-width="1" stroke-dasharray="3 3" opacity="0.35" />
        </g>
        <g v-for="b in ticks" :key="'b' + b">
          <line :x1="x(b)" y1="78" :x2="x(b)" y2="84" stroke="#9aa4b6" />
          <text :x="x(b)" y="98" text-anchor="middle" font-size="11" fill="#6b77a0">{{ b }}</text>
        </g>
        <line :x1="margin" y1="78" :x2="x(maxTime)" y2="78" stroke="#cdd5e3" />
        <g v-if="cursorTime !== null && cursorTime >= 0 && cursorTime <= axisTime">
          <line :x1="x(cursorTime)" y1="20" :x2="x(cursorTime)" y2="90" stroke="#e64a45" stroke-width="2" />
          <polygon :points="`${x(cursorTime)-5},20 ${x(cursorTime)+5},20 ${x(cursorTime)},28`" fill="#e64a45" />
          <text :x="x(cursorTime)" y="16" text-anchor="middle" font-size="11" font-weight="600" fill="#e64a45">t={{ cursorTime }}</text>
        </g>
      </svg>
    </div>
    <el-empty v-else description="点击「运行」查看甘特图" :image-size="60" />
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  gantt: { type: Array, default: () => [] },
  reveal: { type: Number, default: -1 },
  // 当前时钟位置 —— 显示红色游标。null/undefined 时隐藏。
  cursorTime: { type: Number, default: null },
  // 时间片大小 —— 每 quantum 拍画浅蓝虚线，0/null 时不画。
  quantum: { type: Number, default: 0 },
})

const margin = 34
const rightMargin = 24
const visibleCycles = 13
const minUnitW = 42
const palette = ['#2f6fec', '#13a394', '#e0823d', '#9b59d0', '#d4537e', '#3aa655', '#e0a800']
const scrollRef = ref(null)
const viewportWidth = ref(734)
let resizeObserver = null

const effectiveReveal = computed(() => {
  return props.reveal === -1 ? props.gantt.length - 1 : props.reveal
})

const maxTime = computed(() => Math.max(1, ...props.gantt.map((s) => s.结束)))
const axisTime = computed(() => Math.max(visibleCycles, maxTime.value))
const unitW = computed(() => {
  const usable = Math.max(visibleCycles * minUnitW, viewportWidth.value - margin - rightMargin)
  return Math.max(minUnitW, usable / visibleCycles)
})
const contentWidth = computed(() => Math.max(viewportWidth.value, margin + axisTime.value * unitW.value + rightMargin))
const ticks = computed(() => Array.from({ length: axisTime.value + 1 }, (_, i) => i))
// quantum 边界：从 quantum、2*quantum…到 axisTime；不含 0（与 y 轴起点重合）。
const quantumLines = computed(() => {
  const q = Number(props.quantum) || 0
  if (q <= 0) return []
  const out = []
  for (let t = q; t <= axisTime.value; t += q) out.push(t)
  return out
})

function x(t) {
  return margin + t * unitW.value
}
function barWidth(seg) {
  return Math.max(4, (seg.结束 - seg.开始) * unitW.value)
}
function color(name) {
  if (name === '空闲') return '#eef1f7'
  let h = 0
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) % palette.length
  return palette[h]
}

function measure() {
  if (!scrollRef.value) return
  viewportWidth.value = scrollRef.value.clientWidth || 734
}

function scrollToReveal() {
  const el = scrollRef.value
  const rev = props.reveal === -1 ? props.gantt.length - 1 : props.reveal
  const seg = props.gantt[rev]
  if (!el || !seg) return
  const target = Math.max(0, x(seg.开始) - margin)
  const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth)
  el.scrollLeft = Math.min(target, maxLeft)
}

onMounted(() => {
  nextTick(() => {
    measure()
    scrollToReveal()
  })
  if (window.ResizeObserver) {
    resizeObserver = new ResizeObserver(measure)
    if (scrollRef.value) resizeObserver.observe(scrollRef.value)
  }
})

onBeforeUnmount(() => {
  if (resizeObserver) resizeObserver.disconnect()
})

watch(() => [props.gantt.length, props.reveal], () => {
  nextTick(() => {
    measure()
    scrollToReveal()
  })
})
</script>

<style scoped>
.gantt-scroll {
  width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 6px;
}

.gantt-svg {
  display: block;
  height: 130px;
  max-width: none;
}
</style>
