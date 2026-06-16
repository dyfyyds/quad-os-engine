<template>
  <div class="page">
    <h2 class="page-title">磁盘调度模拟</h2>
    <p class="page-sub">移臂调度算法 · 磁头移动轨迹与寻道指标（对应实习九 驱动调度）</p>

    <div class="toolbar">
      <el-select v-model="form.algorithm" style="width: 120px;">
        <el-option v-for="a in algorithms" :key="a" :label="a" :value="a" />
      </el-select>
      <el-button type="primary" :loading="loading" @click="run"><el-icon><VideoPlay /></el-icon> 运行</el-button>
      <StepControls :sim="sim" />
      <span class="spacer" />
      <el-dropdown @command="loadPreset">
        <el-button><el-icon><Folder /></el-icon> 教材预设</el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item v-for="(p, i) in presets" :key="i" :command="i">{{ p.name }}</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <el-button :disabled="!sim.trace.value" @click="exportReport"><el-icon><Download /></el-icon> 导出报告</el-button>
    </div>

    <el-row :gutter="14">
      <el-col :span="9">
        <div class="panel">
          <h3>输入配置</h3>
          <el-form label-width="92px" label-position="left">
            <el-form-item label="请求序列"><el-input v-model="form.requestsText" placeholder="逗号分隔，如 98,183,37" /></el-form-item>
            <el-form-item label="初始磁头"><el-input-number v-model="form.head" :min="0" :max="form.disk_size - 1" /></el-form-item>
            <el-form-item label="磁道数"><el-input-number v-model="form.disk_size" :min="2" :step="10" /></el-form-item>
            <el-form-item label="初始方向">
              <el-radio-group v-model="form.direction">
                <el-radio-button value="up">递增 ↑</el-radio-button>
                <el-radio-button value="down">递减 ↓</el-radio-button>
              </el-radio-group>
            </el-form-item>
          </el-form>
        </div>
        <div class="panel"><h3>调度指标</h3><MetricCards :metrics="sim.metrics.value" /></div>
      </el-col>
      <el-col :span="15">
        <div class="panel">
          <h3>磁头移动轨迹</h3>
          <DiskTrack :path="path" :disk-size="form.disk_size" :reveal="sim.cursor.value" />
          <div class="step-desc">{{ sim.currentStep.value?.description || '点击「运行」开始模拟，再用「单步 / 播放」观察磁头移动。' }}</div>
        </div>
        <div class="panel"><h3>分步过程</h3>
          <StepLog :steps="sim.steps.value" :reveal="sim.cursor.value" @select="(i) => (sim.cursor.value = i)" />
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../api/client'
import { useSimulation } from '../composables/useSimulation'
import { downloadReport } from '../utils/report'
import StepControls from '../components/StepControls.vue'
import MetricCards from '../components/MetricCards.vue'
import StepLog from '../components/StepLog.vue'
import DiskTrack from '../components/viz/DiskTrack.vue'

const algorithms = ['FCFS', 'SSTF', 'SCAN', 'C-SCAN', 'LOOK', 'C-LOOK']
const sim = useSimulation()
const loading = ref(false)
const presets = ref([])
const form = reactive({
  algorithm: 'SCAN',
  requestsText: '98,183,37,122,14,124,65,67',
  head: 53,
  disk_size: 200,
  direction: 'up',
})

const path = computed(() => sim.finalState.value['磁头轨迹'] || [])

function parseReqs() {
  return form.requestsText.split(/[,，\s]+/).filter((x) => x !== '').map(Number)
}

async function run() {
  loading.value = true
  try {
    const trace = await api.disk({
      algorithm: form.algorithm, requests: parseReqs(),
      head: form.head, disk_size: form.disk_size, direction: form.direction,
    })
    sim.setTrace(trace)
    api.recordHistory({ module: 'disk', algorithm: form.algorithm, input: trace.input_echo, metrics: trace.metrics }).catch(() => {})
  } catch (e) { ElMessage.error(e.message) } finally { loading.value = false }
}

async function loadPreset(i) {
  const p = presets.value[i]
  Object.assign(form, { algorithm: p.input.algorithm, requestsText: p.input.requests.join(','), head: p.input.head, disk_size: p.input.disk_size, direction: p.input.direction })
  ElMessage.success('已加载预设：' + p.name)
}
async function exportReport() {
  try { await downloadReport(sim.trace.value) } catch (e) { ElMessage.error(e.message) }
}

onMounted(async () => {
  try { presets.value = (await api.presets('disk')).presets } catch (e) { /* ignore */ }
})
</script>
