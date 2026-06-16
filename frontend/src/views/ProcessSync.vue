<template>
  <div class="page">
    <h2 class="page-title">进程同步 · PV 操作</h2>
    <p class="page-sub">信号量机制与有界缓冲区生产者-消费者问题（对应实习六 同步机构）</p>

    <div class="toolbar">
      <span style="font-size: 13px; color: #6b77a0;">缓冲区容量</span>
      <el-input-number v-model="form.buffer_size" :min="1" :max="20" size="small" />
      <el-button type="success" plain @click="addOp('produce')"><el-icon><Plus /></el-icon> 生产者</el-button>
      <el-button type="danger" plain @click="addOp('consume')"><el-icon><Plus /></el-icon> 消费者</el-button>
      <el-button text @click="randomize">随机序列</el-button>
      <el-button text @click="form.operations = []">清空</el-button>
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
          <h3>操作序列（{{ form.operations.length }} 步）</h3>
          <div style="display: flex; flex-wrap: wrap; gap: 5px; min-height: 40px;">
            <el-tag v-for="(o, i) in form.operations" :key="i" :type="o.type === 'produce' ? 'success' : 'danger'"
              closable @close="form.operations.splice(i, 1)" effect="plain">
              {{ i }}.{{ o.type === 'produce' ? '生产' : '消费' }}
            </el-tag>
            <span v-if="!form.operations.length" style="color: #b3bccd; font-size: 12px;">用上方按钮添加生产/消费操作</span>
          </div>
        </div>
        <div class="panel"><h3>统计指标</h3><MetricCards :metrics="sim.metrics.value" /></div>
      </el-col>

      <el-col :span="15">
        <div class="panel">
          <h3>信号量与缓冲区状态</h3>
          <BufferRing :state="sim.currentStep.value?.state || null" :capacity="form.buffer_size" />
          <div class="step-desc">{{ sim.currentStep.value?.description || '添加操作并「运行」，用「单步 / 播放」观察 PV 操作与阻塞唤醒。' }}</div>
        </div>
        <div class="panel"><h3>分步过程</h3>
          <StepLog :steps="sim.steps.value" :reveal="sim.cursor.value" @select="(i) => (sim.cursor.value = i)" />
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../api/client'
import { useSimulation } from '../composables/useSimulation'
import { downloadReport } from '../utils/report'
import StepControls from '../components/StepControls.vue'
import MetricCards from '../components/MetricCards.vue'
import StepLog from '../components/StepLog.vue'
import BufferRing from '../components/viz/BufferRing.vue'

const sim = useSimulation()
const loading = ref(false)
const presets = ref([])
const form = reactive({
  buffer_size: 2,
  operations: [{ type: 'produce' }, { type: 'produce' }, { type: 'produce' }, { type: 'consume' }],
})

function addOp(t) { form.operations.push({ type: t }) }
function randomize() {
  form.operations = Array.from({ length: 8 }, () => ({ type: Math.random() > 0.5 ? 'produce' : 'consume' }))
}
async function run() {
  if (!form.operations.length) { ElMessage.warning('请先添加操作'); return }
  loading.value = true
  try {
    const trace = await api.sync({ operations: form.operations, buffer_size: form.buffer_size })
    sim.setTrace(trace)
    api.recordHistory({ module: 'sync', algorithm: trace.algorithm, input: trace.input_echo, metrics: trace.metrics }).catch(() => {})
  } catch (e) { ElMessage.error(e.message) } finally { loading.value = false }
}
function loadPreset(i) {
  const p = presets.value[i]
  form.buffer_size = p.input.buffer_size
  form.operations = p.input.operations.map((o) => ({ ...o }))
  ElMessage.success('已加载预设：' + p.name)
}
async function exportReport() {
  try { await downloadReport(sim.trace.value) } catch (e) { ElMessage.error(e.message) }
}
onMounted(async () => { try { presets.value = (await api.presets('sync')).presets } catch (e) { /* ignore */ } })
</script>
