<template>
  <div class="viz-wrap">
    <div v-if="cols.length" style="overflow-x: auto;">
      <table class="pf-table">
        <tbody>
          <tr>
            <th class="rowhead">访问页</th>
            <td v-for="(c, i) in cols" :key="'r' + i" :class="{ cur: i === reveal }" class="ref-cell">{{ c.ref }}</td>
          </tr>
          <tr v-for="f in frames" :key="'f' + f">
            <th class="rowhead">块{{ f - 1 }}</th>
            <td v-for="(c, i) in cols" :key="'c' + i"
              :class="{ cur: i === reveal, evict: c.evicted !== null && c.frame[f - 1] === c.ref && !c.hit }">
              {{ c.frame[f - 1] === null || c.frame[f - 1] === undefined ? '' : c.frame[f - 1] }}
            </td>
          </tr>
          <tr>
            <th class="rowhead">状态</th>
            <td v-for="(c, i) in cols" :key="'s' + i" :class="{ cur: i === reveal }">
              <span :style="{ color: c.hit ? '#1f9254' : '#d4573c' }">{{ c.hit ? '√' : '×' }}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p style="font-size: 12px; color: #8a94a6; margin: 8px 0 0;">
        × 缺页（橙底为被换出/装入的块），√ 命中
      </p>
    </div>
    <el-empty v-else description="点击「运行」查看页框置换过程" :image-size="60" />
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  steps: { type: Array, default: () => [] },
  reveal: { type: Number, default: -1 },
  frames: { type: Number, default: 3 },
})

const cols = computed(() =>
  props.steps.slice(0, props.reveal + 1).map((s) => ({
    ref: s.state['引用页'],
    frame: s.state['页框'] || [],
    hit: s.state['命中'],
    evicted: s.state['换出页'] ?? null,
  }))
)
</script>

<style scoped>
.pf-table { border-collapse: collapse; font-size: 13px; }
.pf-table th, .pf-table td { border: 1px solid #e3e8f0; padding: 5px 9px; text-align: center; min-width: 26px; }
.pf-table .rowhead { background: #f5f7fb; color: #56627a; font-weight: 500; position: sticky; left: 0; }
.pf-table .ref-cell { font-weight: 600; color: #1f2a44; }
.pf-table td.cur { background: #eef3ff; }
.pf-table td.evict { background: #fff4e0; font-weight: 600; }
</style>
