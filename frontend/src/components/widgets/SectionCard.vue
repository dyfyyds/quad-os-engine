<template>
  <div class="section-card">
    <div class="sc-head" v-if="title || $slots.extra">
      <div class="sc-title">
        <el-icon v-if="icon"><component :is="icon" /></el-icon>
        <span>{{ title }}</span>
      </div>
      <div class="sc-extra"><slot name="extra" /></div>
    </div>
    <div class="sc-body"><slot /></div>
  </div>
</template>

<script setup>
defineProps({ title: String, icon: String })
</script>

<style scoped>
.section-card { background: var(--qos-card); border: 1px solid var(--qos-border); border-radius: var(--qos-radius); box-shadow: var(--qos-shadow); }
.sc-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid var(--qos-border); }
.sc-title { display: flex; align-items: center; gap: 7px; font-size: 14px; font-weight: 600; color: var(--qos-text); }
.sc-title .el-icon { color: var(--qos-accent); }
.sc-body { padding: 14px; }
</style>
