<template>
  <div class="page">
    <h2 class="page-title">资源分配 · 银行家算法</h2>
    <p class="page-sub">安全性算法 + 资源请求算法，避免死锁（对应实习五 资源分配）</p>

    <div class="toolbar">
      <el-radio-group v-model="opMode" @change="sim.reset">
        <el-radio-button value="safety">安全性检查</el-radio-button>
        <el-radio-button value="request">资源请求</el-radio-button>
      </el-radio-group>
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
          <h3>系统状态</h3>
          <el-form label-width="86px" label-position="left">
            <el-form-item label="Available"><el-input v-model="form.availableText" placeholder="3,3,2" /></el-form-item>
            <el-form-item label="Max"><el-input v-model="form.maxText" type="textarea" :rows="5" placeholder="每行一个进程" /></el-form-item>
            <el-form-item label="Allocation"><el-input v-model="form.allocText" type="textarea" :rows="5" /></el-form-item>
          </el-form>
          <template v-if="opMode === 'request'">
            <el-divider />
            <el-form label-width="86px" label-position="left">
              <el-form-item label="进程号"><el-input-number v-model="form.pid" :min="0" /></el-form-item>
              <el-form-item label="请求向量"><el-input v-model="form.requestText" placeholder="1,0,2" /></el-form-item>
              <el-form-item label="算法">
                <el-switch v-model="form.use_banker" active-text="银行家" inactive-text="随机分配" inline-prompt />
              </el-form-item>
            </el-form>
          </template>
        </div>
        <div class="panel"><h3>结果指标</h3><MetricCards :metrics="sim.metrics.value" /></div>
      </el-col>

      <el-col :span="15">
        <div class="panel">
          <h3>银行家推演</h3>
          <el-alert v-if="opMode === 'request' && sim.metrics.value['原因']" :closable="false" style="margin-bottom: 10px;"
            :type="sim.metrics.value['可分配'] ? 'success' : 'error'" :title="sim.metrics.value['原因']" />
          <BankerMatrix :final="sim.finalState.value" :steps="sim.steps.value" :reveal="sim.cursor.value" />
          <div class="step-desc">{{ sim.currentStep.value?.description || '点击「运行」执行安全性算法，逐步寻找安全序列。' }}</div>
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
import BankerMatrix from '../components/viz/BankerMatrix.vue'

const sim = useSimulation()
const loading = ref(false)
const presets = ref([])
const opMode = ref('safety')
const form = reactive({
  availableText: '3,3,2',
  maxText: '7,5,3\n3,2,2\n9,0,2\n2,2,2\n4,3,3',
  allocText: '0,1,0\n2,0,0\n3,0,2\n2,1,1\n0,0,2',
  pid: 1, requestText: '1,0,2', use_banker: true,
})

const vec = (s) => s.split(/[,，\s]+/).filter((x) => x !== '').map(Number)
const mat = (s) => s.trim().split(/\n+/).map((line) => vec(line))

async function run() {
  loading.value = true
  try {
    const base = { available: vec(form.availableText), max: mat(form.maxText), allocation: mat(form.allocText) }
    let trace
    if (opMode.value === 'safety') {
      trace = await api.bankerSafety(base)
    } else {
      trace = await api.bankerRequest({ ...base, pid: form.pid, request: vec(form.requestText), use_banker: form.use_banker })
    }
    sim.setTrace(trace)
    api.recordHistory({ module: 'banker', algorithm: trace.algorithm, input: trace.input_echo, metrics: trace.metrics }).catch(() => {})
  } catch (e) { ElMessage.error(e.message) } finally { loading.value = false }
}
function loadPreset(i) {
  const p = presets.value[i]
  form.availableText = p.input.available.join(',')
  form.maxText = p.input.max.map((r) => r.join(',')).join('\n')
  form.allocText = p.input.allocation.map((r) => r.join(',')).join('\n')
  ElMessage.success('已加载预设：' + p.name)
}
async function exportReport() {
  try { await downloadReport(sim.trace.value) } catch (e) { ElMessage.error(e.message) }
}
onMounted(async () => { try { presets.value = (await api.presets('banker')).presets } catch (e) { /* ignore */ } })
</script>
