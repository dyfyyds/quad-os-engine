<template>
  <el-tag :type="type" effect="light" round size="small">{{ label || state }}</el-tag>
</template>

<script setup>
import { computed } from 'vue'
const props = defineProps({ state: String, label: String })

const MAP = {
  新建: 'info', 运行: 'success', 就绪: 'primary', 阻塞: 'warning', 完成: 'info',
  info: 'info', warning: 'warning', danger: 'danger', success: 'success',
  正常: 'success', 安全: 'success', 死锁: 'danger', 不安全: 'danger',
}
const type = computed(() => MAP[props.state] || 'info')
</script>
