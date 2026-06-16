<template>
  <div class="event-feed" :style="{ maxHeight: height + 'px' }">
    <div v-for="(e, i) in events" :key="i" class="ev">
      <span class="dot" :class="e.level"></span>
      <span class="ts">T{{ e.ts }}</span>
      <el-tag size="small" effect="plain" :type="tagType(e.level)">{{ e.type }}</el-tag>
      <span class="desc">{{ e.desc }}</span>
    </div>
    <div v-if="!events.length" class="empty">暂无事件，点击顶部「运行」开始模拟</div>
  </div>
</template>

<script setup>
defineProps({ events: { type: Array, default: () => [] }, height: { type: Number, default: 320 } })
const tagType = (l) => ({ info: 'info', warning: 'warning', danger: 'danger' }[l] || 'info')
</script>

<style scoped>
.event-feed { overflow-y: auto; }
.ev { display: flex; align-items: center; gap: 8px; padding: 7px 4px; border-bottom: 1px solid #f1f4f8; font-size: 12px; }
.ev .dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; background: #909bab; }
.ev .dot.warning { background: var(--qos-amber); }
.ev .dot.danger { background: var(--qos-red); }
.ev .ts { color: var(--qos-muted); width: 34px; flex-shrink: 0; font-variant-numeric: tabular-nums; }
.ev .desc { color: #5b6776; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.empty { padding: 24px; text-align: center; color: #b3bccd; font-size: 12px; }
</style>
