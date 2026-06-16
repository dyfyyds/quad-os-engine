<template>
  <div style="display: flex; align-items: center; gap: 10px;">
    <el-tag type="info" effect="plain" round>
      <el-icon style="vertical-align: -2px;"><Clock /></el-icon>
      虚拟时钟 {{ os.clock }}
    </el-tag>
    <el-button-group>
      <el-button v-if="!os.running" type="primary" size="small" @click="driver.start()">
        <el-icon><VideoPlay /></el-icon> 运行
      </el-button>
      <el-button v-else type="warning" size="small" @click="driver.pause()">
        <el-icon><VideoPause /></el-icon> 暂停
      </el-button>
      <el-button size="small" :disabled="os.running" @click="driver.step()">单步</el-button>
      <el-button size="small" @click="driver.reset()"><el-icon><RefreshLeft /></el-icon></el-button>
    </el-button-group>
    <el-select v-model="speed" size="small" style="width: 92px" @change="driver.setSpeed(speed)">
      <el-option v-for="s in speeds" :key="s" :label="s + 'x'" :value="s" />
    </el-select>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useOsStore } from '../../store/os'
import { useOsDriver } from '../../mock/driver'

const os = useOsStore()
const driver = useOsDriver()
const speeds = [0.5, 1, 2, 4]
const speed = ref(os.speed)
</script>
