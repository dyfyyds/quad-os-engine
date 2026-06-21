<template>
  <div class="run-control">
    <el-tag type="info" effect="plain" round>
      <el-icon style="vertical-align: -2px;"><Clock /></el-icon>
      虚拟时钟 {{ os.clock }}
    </el-tag>
    <el-tag :type="os.running ? 'success' : 'info'" effect="plain" round>{{ os.running ? '运行中' : '已暂停' }}</el-tag>
    <el-tooltip :content="'当前运行进程：' + currentProc" placement="bottom">
      <el-tag effect="plain" round>进程 {{ currentProc }}</el-tag>
    </el-tooltip>
    <el-tooltip :content="recentEventText" placement="bottom">
      <el-tag type="warning" effect="plain" round>最近 {{ recentEventType }}</el-tag>
    </el-tooltip>
    <el-tooltip :content="backendTip" placement="bottom">
      <el-tag :type="backendTagType" effect="plain" round>{{ backendLabel }}</el-tag>
    </el-tooltip>
    <el-button-group>
      <el-tooltip v-if="!os.running" content="自动推进虚拟时钟，适合观察四核心联动" placement="bottom">
        <el-button type="primary" size="small" @click="driver.start()">
          <el-icon><VideoPlay /></el-icon> 运行
        </el-button>
      </el-tooltip>
      <el-tooltip v-else content="暂停自动推进，保留当前运行状态" placement="bottom">
        <el-button type="warning" size="small" @click="driver.pause()">
          <el-icon><VideoPause /></el-icon> 暂停
        </el-button>
      </el-tooltip>
      <el-tooltip content="只推进一个时钟周期，适合观察算法过程" placement="bottom">
        <el-button size="small" :disabled="os.running" @click="driver.step()">单步</el-button>
      </el-tooltip>
      <el-tooltip content="重置运行过程（保留实验配置；恢复默认请到系统设置）" placement="bottom">
        <el-button size="small" @click="driver.reset(true)"><el-icon><RefreshLeft /></el-icon></el-button>
      </el-tooltip>
    </el-button-group>
    <el-tooltip content="调整自动运行速度" placement="bottom">
      <el-select v-model="speed" size="small" style="width: 92px" @change="driver.setSpeed(speed)">
        <el-option v-for="s in speeds" :key="s" :label="s + 'x'" :value="s" />
      </el-select>
    </el-tooltip>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useOsStore } from '../../store/os'
import { useOsDriver } from '../../mock/driver'

const os = useOsStore()
const driver = useOsDriver()
const speeds = [0.5, 1, 2, 4]
const speed = ref(os.speed)

const currentProc = computed(() => os.runningProc?.name || '空闲')
const recentEvent = computed(() => os.events[0] || null)
const recentEventType = computed(() => recentEvent.value?.type || '无事件')
const recentEventText = computed(() => {
  const e = recentEvent.value
  return e ? `T${e.ts} · ${e.type} · ${e.desc}` : '尚无运行事件'
})
// fallbackCount：本会话累计的回退/恢复事件数，仅用于 tip 文案，不影响 tag 颜色。
const fallbackCount = computed(() => os.events.filter((e) => e.type === '整拍回退' || e.type === '整拍恢复').length)
const backendLabel = computed(() => `引擎: ${os.memory.backendMode === 'backend' ? '后端' : '本地'}`)
const backendTagType = computed(() => (os.memory.backendMode === 'backend' ? 'success' : 'warning'))
const backendTip = computed(() => {
  const base = os.memory.backendMode === 'backend'
    ? '当前使用后端权威整拍引擎（/api/twin/tick）'
    : '当前使用本地等价整拍引擎（localTick.js，与后端逐字节一致）'
  return fallbackCount.value ? `${base}；本会话已发生 ${fallbackCount.value} 次回退/恢复` : base
})
</script>

<style scoped>
.run-control { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
</style>
