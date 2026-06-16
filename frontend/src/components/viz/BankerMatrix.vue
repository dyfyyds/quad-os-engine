<template>
  <div class="viz-wrap">
    <div v-if="max.length">
      <div style="margin-bottom: 10px; font-size: 13px;">
        <span style="color: #6b77a0;">Work 向量：</span>
        <el-tag type="info" effect="plain">[{{ work.join(', ') }}]</el-tag>
        <span v-if="current" style="margin-left: 12px; color: #2f6fec;">当前考察：{{ current }}</span>
      </div>
      <table class="matrix-table">
        <thead>
          <tr>
            <th rowspan="2">进程</th>
            <th :colspan="m">Max</th>
            <th :colspan="m">Allocation</th>
            <th :colspan="m">Need</th>
          </tr>
          <tr>
            <th v-for="j in m" :key="'mx' + j">R{{ j - 1 }}</th>
            <th v-for="j in m" :key="'al' + j">R{{ j - 1 }}</th>
            <th v-for="j in m" :key="'nd' + j">R{{ j - 1 }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in max" :key="i" :class="{ done: completed.includes('P' + i) }">
            <td :style="current === 'P' + i ? 'background:#eef3ff;font-weight:600' : ''">P{{ i }}</td>
            <td v-for="(v, j) in row" :key="'m' + j">{{ v }}</td>
            <td v-for="(v, j) in alloc[i]" :key="'a' + j">{{ v }}</td>
            <td v-for="(v, j) in need[i]" :key="'n' + j">{{ v }}</td>
          </tr>
        </tbody>
      </table>
      <div style="margin-top: 12px;">
        <span style="color: #6b77a0; font-size: 13px;">安全序列：</span>
        <template v-if="sequence.length">
          <el-tag v-for="(p, i) in sequence" :key="i" :type="i <= reveal ? 'success' : 'info'"
            :effect="i <= reveal ? 'dark' : 'plain'" style="margin: 0 4px 4px 0;">{{ p }}</el-tag>
        </template>
        <el-tag v-else type="danger">无安全序列（不安全 / 死锁）</el-tag>
      </div>
    </div>
    <el-empty v-else description="点击「安全性检查」查看银行家推演" :image-size="60" />
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  final: { type: Object, default: () => ({}) },
  steps: { type: Array, default: () => [] },
  reveal: { type: Number, default: -1 },
})

const max = computed(() => props.final.Max || [])
const alloc = computed(() => props.final.Allocation || [])
const need = computed(() => props.final.Need || [])
const m = computed(() => (props.final.Available || []).length || (max.value[0] || []).length)
const sequence = computed(() => props.final['安全序列'] || [])
const curStep = computed(() => (props.reveal >= 0 ? props.steps[props.reveal] : null))
const work = computed(() => curStep.value?.state['Work后'] || props.final.Available || [])
const current = computed(() => curStep.value?.state['选中进程'] || '')
const completed = computed(() => curStep.value?.state['已完成'] || [])
</script>
