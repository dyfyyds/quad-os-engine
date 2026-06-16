<template>
  <div style="display: flex; align-items: center; gap: 8px;">
    <el-button-group>
      <el-button :disabled="sim.cursor.value < 0" @click="sim.reset()"><el-icon><RefreshLeft /></el-icon></el-button>
      <el-button :disabled="sim.cursor.value < 0" @click="sim.prev()"><el-icon><ArrowLeft /></el-icon></el-button>
      <el-button v-if="!sim.playing.value" type="primary" :disabled="!sim.total.value" @click="sim.play()">
        <el-icon><VideoPlay /></el-icon> 播放
      </el-button>
      <el-button v-else type="warning" @click="sim.pause()">
        <el-icon><VideoPause /></el-icon> 暂停
      </el-button>
      <el-button :disabled="sim.cursor.value >= sim.total.value - 1" @click="sim.next()">单步 <el-icon><ArrowRight /></el-icon></el-button>
      <el-button :disabled="!sim.total.value || sim.cursor.value >= sim.total.value - 1" @click="sim.toEnd()"><el-icon><DArrowRight /></el-icon></el-button>
    </el-button-group>
    <span style="font-size: 12px; color: #8a94a6;">
      {{ sim.total.value ? (sim.cursor.value + 1) + ' / ' + sim.total.value + ' 步' : '未运行' }}
    </span>
  </div>
</template>

<script setup>
defineProps({ sim: { type: Object, required: true } })
</script>
