<template>
  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px;">
    <div v-for="(v, k) in flat" :key="k" class="metric-card">
      <div class="m-label">{{ k }}</div>
      <div class="m-value" :class="{ small: String(v).length > 8 }">{{ format(v) }}</div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({ metrics: { type: Object, default: () => ({}) } })

const flat = computed(() => {
  const out = {}
  for (const [k, v] of Object.entries(props.metrics)) {
    if (v === null || v === undefined) out[k] = '—'
    else if (Array.isArray(v)) out[k] = v.join(', ') || '—'
    else if (typeof v === 'boolean') out[k] = v ? '是' : '否'
    else out[k] = v
  }
  return out
})

function format(v) {
  return v === '' ? '—' : v
}
</script>

<style scoped>
.metric-card { background: #f5f8ff; border: 1px solid #e4ecfb; border-radius: 8px; padding: 10px 12px; }
.m-label { font-size: 12px; color: #6b77a0; margin-bottom: 4px; }
.m-value { font-size: 22px; font-weight: 600; color: #1f2a44; word-break: break-all; }
.m-value.small { font-size: 14px; font-weight: 500; }
</style>
