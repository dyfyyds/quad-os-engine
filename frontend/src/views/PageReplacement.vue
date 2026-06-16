<template>
  <div class="page">
    <h2 class="page-title">页面置换模拟</h2>
    <p class="page-sub">FIFO · LRU · OPT · CLOCK 置换算法，含分页地址转换与缺页中断（对应实习一 虚拟存储器）</p>

    <div class="toolbar">
      <el-radio-group v-model="mode" @change="sim.reset">
        <el-radio-button value="replace">页面置换</el-radio-button>
        <el-radio-button value="translate">地址转换</el-radio-button>
      </el-radio-group>
      <el-select v-if="mode === 'replace'" v-model="form.algorithm" style="width: 110px;">
        <el-option v-for="a in algorithms" :key="a" :label="a" :value="a" />
      </el-select>
      <el-button type="primary" :loading="loading" @click="run"><el-icon><VideoPlay /></el-icon> 运行</el-button>
      <StepControls :sim="sim" />
      <span class="spacer" />
      <el-dropdown v-if="mode === 'replace'" @command="loadPreset">
        <el-button><el-icon><Folder /></el-icon> 教材预设</el-button>
        <template #dropdown><el-dropdown-menu>
          <el-dropdown-item v-for="(p, i) in presets" :key="i" :command="i">{{ p.name }}</el-dropdown-item>
        </el-dropdown-menu></template>
      </el-dropdown>
      <el-button :disabled="!sim.trace.value" @click="exportReport"><el-icon><Download /></el-icon> 导出报告</el-button>
    </div>

    <el-row :gutter="14">
      <el-col :span="9">
        <div class="panel" v-if="mode === 'replace'">
          <h3>输入配置</h3>
          <el-form label-width="86px" label-position="left">
            <el-form-item label="引用串"><el-input v-model="form.refText" type="textarea" :rows="2" placeholder="逗号分隔" /></el-form-item>
            <el-form-item label="物理块数"><el-input-number v-model="form.frames" :min="1" :max="10" /></el-form-item>
          </el-form>
        </div>
        <div class="panel" v-else>
          <h3>页表（实习一，块长 {{ trans.block_size }}B）</h3>
          <el-table :data="trans.page_table" size="small" max-height="220">
            <el-table-column prop="页号" label="页号" />
            <el-table-column prop="标志" label="标志" />
            <el-table-column prop="主存块号" label="块号" />
            <el-table-column prop="磁盘位置" label="磁盘位置" />
          </el-table>
        </div>
        <div class="panel"><h3>{{ mode === 'replace' ? '缺页统计' : '转换统计' }}</h3><MetricCards :metrics="sim.metrics.value" /></div>
      </el-col>

      <el-col :span="15">
        <div class="panel">
          <h3>{{ mode === 'replace' ? '页框置换过程' : '地址转换过程' }}</h3>
          <PageFrames v-if="mode === 'replace'" :steps="sim.steps.value" :reveal="sim.cursor.value" :frames="form.frames" />
          <div v-else class="viz-wrap">
            <el-table v-if="transResults.length" :data="transResults" size="small"
              :row-class-name="({ rowIndex }) => (rowIndex === sim.cursor.value ? 'cur-row' : '')">
              <el-table-column label="#" type="index" width="50" />
              <el-table-column prop="页号" label="页号" />
              <el-table-column prop="单元号" label="单元号" />
              <el-table-column prop="主存块号" label="主存块号" />
              <el-table-column label="结果">
                <template #default="{ row }">
                  <span v-if="row.缺页" style="color: #d4573c;">缺页中断 *{{ row.页号 }}</span>
                  <span v-else style="color: #1f9254;">绝对地址 {{ row.绝对地址 }}</span>
                </template>
              </el-table-column>
            </el-table>
            <el-empty v-else description="点击「运行」执行地址转换" :image-size="60" />
          </div>
          <div class="step-desc">{{ sim.currentStep.value?.description || '点击「运行」开始模拟。' }}</div>
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
import PageFrames from '../components/viz/PageFrames.vue'

const algorithms = ['FIFO', 'LRU', 'OPT', 'CLOCK']
const sim = useSimulation()
const loading = ref(false)
const presets = ref([])
const mode = ref('replace')
const form = reactive({ algorithm: 'LRU', refText: '7,0,1,2,0,3,0,4,2,3,0,3,2,1,2,0,1,7,0,1', frames: 3 })
const trans = reactive({ block_size: 128, page_table: [], instructions: [] })

const transResults = computed(() => sim.finalState.value['转换结果'] || [])

async function run() {
  loading.value = true
  try {
    let trace
    if (mode.value === 'replace') {
      const refs = form.refText.split(/[,，\s]+/).filter((x) => x !== '').map(Number)
      trace = await api.paging({ algorithm: form.algorithm, reference_string: refs, frames: form.frames })
    } else {
      trace = await api.pagingTranslate({ page_table: trans.page_table, instructions: trans.instructions, block_size: trans.block_size })
    }
    sim.setTrace(trace)
    api.recordHistory({ module: 'paging', algorithm: trace.algorithm, input: trace.input_echo, metrics: trace.metrics }).catch(() => {})
  } catch (e) { ElMessage.error(e.message) } finally { loading.value = false }
}
function loadPreset(i) {
  const p = presets.value[i]
  form.algorithm = p.input.algorithm
  form.refText = p.input.reference_string.join(',')
  form.frames = p.input.frames
  ElMessage.success('已加载预设：' + p.name)
}
async function exportReport() {
  try { await downloadReport(sim.trace.value) } catch (e) { ElMessage.error(e.message) }
}
onMounted(async () => {
  try { presets.value = (await api.presets('paging')).presets } catch (e) { /* ignore */ }
  try {
    const tp = (await api.presets('paging_translate')).presets[0]
    Object.assign(trans, tp.input)
  } catch (e) { /* ignore */ }
})
</script>

<style>
.cur-row { background: #eef3ff !important; }
</style>
