<template>
  <div class="stat-card">
    <div class="ic" :style="{ background: soft, color: color }">
      <el-icon><component :is="icon" /></el-icon>
    </div>
    <div class="body">
      <div class="label">{{ label }}</div>
      <div class="value">{{ value }}<span class="unit">{{ unit }}</span></div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
const props = defineProps({
  label: String,
  value: [String, Number],
  unit: { type: String, default: '' },
  icon: { type: String, default: 'DataLine' },
  color: { type: String, default: '#15a98a' },
})
const soft = computed(() => props.color + '1a')
</script>

<style scoped>
.stat-card { display: flex; align-items: center; gap: 12px; background: var(--qos-card); border: 1px solid var(--qos-border); border-radius: var(--qos-radius); box-shadow: var(--qos-shadow); padding: 14px 16px; }
.ic { width: 44px; height: 44px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 22px; flex-shrink: 0; }
.label { font-size: 12px; color: var(--qos-muted); margin-bottom: 4px; }
.value { font-size: 24px; font-weight: 700; color: var(--qos-text); line-height: 1; }
.unit { font-size: 12px; font-weight: 400; color: var(--qos-muted); margin-left: 3px; }
</style>
