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
    <el-popover placement="bottom" :width="280" trigger="hover">
      <template #reference>
        <el-tag :type="configTagType" effect="plain" round>配置: {{ configSourceLabel }}</el-tag>
      </template>
      <div class="cfg-pop">
        <p class="cfg-pop-title">当前实验配置来源</p>
        <p class="cfg-pop-body">{{ configSourceDetail }}</p>
        <ul class="cfg-pop-list">
          <li :class="{ active: os.configSource === 'backend' }"><b>后端</b> · /api/config 同步（持久化在 MySQL）</li>
          <li :class="{ active: os.configSource === 'local' }"><b>本地缓存</b> · 浏览器 localStorage（断网/未保存到后端时使用）</li>
          <li :class="{ active: os.configSource === 'default' }"><b>出厂默认</b> · 代码内置常量（首次打开或恢复默认后）</li>
        </ul>
      </div>
    </el-popover>
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

    <el-tooltip content="将当前仿真状态作为快照保存到数据库" placement="bottom">
      <el-button type="success" size="small" @click="saveCurrentSnapshot">
        <el-icon><FolderAdd /></el-icon> 保存快照
      </el-button>
    </el-tooltip>

    <el-select
      v-model="selectedScenarioId"
      placeholder="加载快照"
      size="small"
      style="width: 130px"
      @change="loadScenario"
      @visible-change="onVisibleChange"
      :loading="loadingScenarios"
    >
      <el-option
        v-for="item in scenarioList"
        :key="item.id"
        :label="item.name"
        :value="item.id"
      >
        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
          <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 90px;">
            {{ item.name }}
          </span>
          <el-button
            type="danger"
            link
            size="small"
            style="padding: 0 4px; height: auto;"
            @click.stop="deleteSnapshot(item.id)"
          >
            <el-icon><Delete /></el-icon>
          </el-button>
        </div>
      </el-option>
    </el-select>

    <el-tooltip content="调整自动运行速度" placement="bottom">
      <el-select v-model="speed" size="small" style="width: 92px" @change="driver.setSpeed(speed)">
        <el-option v-for="s in speeds" :key="s" :label="s + 'x'" :value="s" />
      </el-select>
    </el-tooltip>
  </div>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useOsStore } from '../../store/os'
import { useOsDriver } from '../../mock/driver'
import { api } from '../../api/client'
import { serializeSim, applySim } from '../../mock/localTick'

const os = useOsStore()
const driver = useOsDriver()
const speeds = [0.5, 1, 2, 4]
const speed = ref(os.speed)

const selectedScenarioId = ref(null)
const scenarioList = ref([])
const loadingScenarios = ref(false)

const fetchScenarios = async () => {
  loadingScenarios.value = true
  try {
    const list = await api.listScenarios('twin')
    scenarioList.value = list
  } catch (e) {
    ElMessage.error('获取快照列表失败: ' + e.message)
  } finally {
    loadingScenarios.value = false
  }
}

const onVisibleChange = (visible) => {
  if (visible) {
    fetchScenarios()
  }
}

const saveCurrentSnapshot = async () => {
  try {
    const { value: name } = await ElMessageBox.prompt('请输入快照名称', '保存状态快照', {
      confirmButtonText: '保存',
      cancelButtonText: '取消',
      inputPlaceholder: '如：运行中 - 死锁边缘',
      inputPattern: /\S+/,
      inputErrorMessage: '快照名称不能为空',
    })
    
    if (!name) return

    const snapshot = serializeSim(os.$state)
    await api.saveScenario({
      module: 'twin',
      name: name,
      description: 'Twin Engine State Snapshot',
      input: snapshot,
    })
    ElMessage.success('快照保存成功')
    fetchScenarios()
  } catch (e) {
    if (e !== 'cancel') {
      ElMessage.error('保存快照失败: ' + (e?.message || e))
    }
  }
}

const loadScenario = async (sid) => {
  if (!sid) return
  const scenario = scenarioList.value.find((s) => s.id === sid)
  if (scenario) {
    try {
      driver.pause()
      applySim(os.$state, scenario.input)
      os.pushEvent('状态恢复', 'system', 'info', `已成功从数据库加载状态快照 "${scenario.name}"`)
      ElMessage.success(`成功载入快照: ${scenario.name}`)
    } catch (e) {
      ElMessage.error('加载快照失败: ' + e.message)
    } finally {
      selectedScenarioId.value = null
    }
  }
}

const deleteSnapshot = async (id) => {
  try {
    await ElMessageBox.confirm('确定要删除此状态快照吗？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await api.deleteScenario(id)
    ElMessage.success('快照已删除')
    fetchScenarios()
  } catch (e) {
    if (e !== 'cancel') {
      ElMessage.error('删除快照失败: ' + (e?.message || e))
    }
  }
}

onMounted(() => {
  fetchScenarios()
})

const currentProc = computed(() => os.runningProc?.name || '空闲')
const recentEvent = computed(() => os.events[0] || null)
const recentEventType = computed(() => recentEvent.value?.type || '无事件')
const recentEventText = computed(() => {
  const e = recentEvent.value
  return e ? `T${e.ts} · ${e.type} · ${e.desc}` : '尚无运行事件'
})
// 配置来源 tag：default→info（灰）/ local→warning（黄，提醒未同步到后端）/ backend→success（绿）。
const CONFIG_LABEL = { default: '出厂默认', local: '本地缓存', backend: '后端' }
const CONFIG_DETAIL = {
  default: '尚未加载任何持久化配置；显示的是 seed.js 里的出厂常量。在【系统设置】调整后点"应用配置"才会变成"后端"或"本地"。',
  local: '配置已存在浏览器 localStorage，但未同步到后端。可能是后端不可达时点了"应用配置"，或之前的会话残留。',
  backend: '配置来自后端 /api/config（MySQL 持久化），多设备/会话之间一致。',
}
const configSourceLabel = computed(() => CONFIG_LABEL[os.configSource] || '未知')
const configSourceDetail = computed(() => CONFIG_DETAIL[os.configSource] || '')
const configTagType = computed(() => ({ default: 'info', local: 'warning', backend: 'success' })[os.configSource] || 'info')

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
<style>
.cfg-pop { font-size: 12px; line-height: 1.5; color: #475569; }
.cfg-pop-title { margin: 0 0 6px; font-size: 13px; font-weight: 600; color: #1a2436; }
.cfg-pop-body { margin: 0 0 8px; color: #5b6776; }
.cfg-pop-list { margin: 0; padding: 0; list-style: none; }
.cfg-pop-list li { padding: 5px 8px; border-radius: 4px; color: #94a3b8; }
.cfg-pop-list li b { color: #5b6776; margin-right: 4px; }
.cfg-pop-list li.active { background: #effaf6; color: #1a2436; }
.cfg-pop-list li.active b { color: #15a98a; }
</style>
