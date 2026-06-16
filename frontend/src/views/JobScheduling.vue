<template>
  <div class="page">
    <h2 class="page-title">作业 / 进程调度模拟</h2>
    <p class="page-sub">FCFS · 短作业优先 · 最高响应比 · 优先级 · 时间片轮转（对应实习八 作业调度）</p>

    <div class="toolbar">
      <el-select v-model="form.algorithm" style="width: 130px;">
        <el-option v-for="a in algorithms" :key="a.v" :label="a.l" :value="a.v" />
      </el-select>
      <el-input-number v-if="form.algorithm === 'RR'" v-model="form.time_quantum" :min="1" size="small" />
      <el-button type="primary" :loading="loading" @click="run"><el-icon><VideoPlay /></el-icon> 运行</el-button>
      <StepControls :sim="sim" />
      <span class="spacer" />
      <el-dropdown @command="loadPreset">
        <el-button><el-icon><Folder /></el-icon> 教材预设</el-button>
        <template #dropdown><el-dropdown-menu>
          <el-dropdown-item v-for="(p, i) in presets" :key="i" :command="i">{{ p.name }}</el-dropdown-item>
        </el-dropdown-menu></template>
      </el-dropdown>
      <el-button :disabled="!sim.trace.value" @click="exportReport"><el-icon><Download /></el-icon> 导出报告</el-button>
    </div>

    <el-row :gutter="14">
      <el-col :span="9">
        <div class="panel">
          <h3>作业表 <el-button size="small" text @click="addJob"><el-icon><Plus /></el-icon>添加</el-button></h3>
          <el-table :data="form.jobs" size="small" max-height="240">
            <el-table-column label="作业" width="78"><template #default="{ row }"><el-input v-model="row.name" size="small" /></template></el-table-column>
            <el-table-column label="到达" width="74"><template #default="{ row }"><el-input-number v-model="row.arrival" :min="0" size="small" controls-position="right" /></template></el-table-column>
            <el-table-column label="服务" width="74"><template #default="{ row }"><el-input-number v-model="row.burst" :min="1" size="small" controls-position="right" /></template></el-table-column>
            <el-table-column label="优先级" width="78"><template #default="{ row }"><el-input-number v-model="row.priority" :min="1" size="small" controls-position="right" /></template></el-table-column>
            <el-table-column width="40"><template #default="{ $index }"><el-button size="small" text type="danger" @click="form.jobs.splice($index, 1)"><el-icon><Delete /></el-icon></el-button></template></el-table-column>
          </el-table>
          <p style="font-size: 12px; color: #9aa4b6; margin: 8px 0 0;">优先级数字越小级别越高（仅优先级算法用）</p>
        </div>
        <div class="panel"><h3>调度指标</h3><MetricCards :metrics="sim.metrics.value" /></div>
      </el-col>
      <el-col :span="15">
        <div class="panel">
          <h3>甘特图</h3>
          <GanttChart :gantt="gantt" :reveal="sim.cursor.value" />
          <div class="step-desc">{{ sim.currentStep.value?.description || '点击「运行」生成调度甘特图，用「单步 / 播放」逐段展开。' }}</div>
        </div>
        <div class="panel" v-if="detail.length">
          <h3>作业明细</h3>
          <el-table :data="detail" size="small">
            <el-table-column prop="作业" label="作业" />
            <el-table-column prop="到达" label="到达" />
            <el-table-column prop="服务" label="服务" />
            <el-table-column prop="完成" label="完成" />
            <el-table-column prop="周转" label="周转" />
            <el-table-column prop="带权周转" label="带权周转" />
            <el-table-column prop="等待" label="等待" />
          </el-table>
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
import GanttChart from '../components/viz/GanttChart.vue'

const algorithms = [
  { v: 'FCFS', l: 'FCFS 先来先服务' }, { v: 'SJF', l: 'SJF 短作业优先' },
  { v: 'HRRN', l: 'HRRN 最高响应比' }, { v: 'PRIORITY', l: '优先级' }, { v: 'RR', l: 'RR 时间片轮转' },
]
const sim = useSimulation()
const loading = ref(false)
const presets = ref([])
const form = reactive({
  algorithm: 'FCFS',
  time_quantum: 2,
  jobs: [
    { name: 'A', arrival: 0, burst: 4, priority: 3 },
    { name: 'B', arrival: 1, burst: 3, priority: 1 },
    { name: 'C', arrival: 2, burst: 5, priority: 4 },
    { name: 'D', arrival: 3, burst: 2, priority: 2 },
  ],
})

const gantt = computed(() => sim.finalState.value['甘特图'] || [])
const detail = computed(() => sim.finalState.value['作业明细'] || [])

function addJob() {
  form.jobs.push({ name: String.fromCharCode(65 + form.jobs.length), arrival: 0, burst: 1, priority: 1 })
}
async function run() {
  loading.value = true
  try {
    const trace = await api.scheduling({ algorithm: form.algorithm, jobs: form.jobs, time_quantum: form.time_quantum })
    sim.setTrace(trace)
    api.recordHistory({ module: 'scheduling', algorithm: form.algorithm, input: trace.input_echo, metrics: trace.metrics }).catch(() => {})
  } catch (e) { ElMessage.error(e.message) } finally { loading.value = false }
}
function loadPreset(i) {
  const p = presets.value[i]
  form.algorithm = p.input.algorithm
  form.time_quantum = p.input.time_quantum || 2
  form.jobs = p.input.jobs.map((j) => ({ priority: null, ...j }))
  ElMessage.success('已加载预设：' + p.name)
}
async function exportReport() {
  try { await downloadReport(sim.trace.value) } catch (e) { ElMessage.error(e.message) }
}
onMounted(async () => { try { presets.value = (await api.presets('scheduling')).presets } catch (e) { /* ignore */ } })
</script>
