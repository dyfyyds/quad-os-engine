<template>
  <div class="qos-page">
    <div class="qos-page-head">
      <h2 class="qos-page-title">实验配置中心</h2>
      <p class="qos-page-sub">选择实验任务，调整关键输入，然后开始观察对应核心页面。</p>
    </div>

    <el-row :gutter="14" class="settings-layout">
      <el-col :xs="24" :lg="8">
        <SectionCard title="选择实验" icon="Guide">
          <div class="experiment-list">
            <button
              v-for="exp in experiments"
              :key="exp.id"
              type="button"
              class="experiment-item"
              :class="{ active: activeExperimentId === exp.id }"
              @click="selectExperiment(exp.id)"
            >
              <span class="experiment-icon" :style="{ color: exp.color }">
                <el-icon><component :is="exp.icon" /></el-icon>
              </span>
              <span class="experiment-body">
                <span class="experiment-title">
                  {{ exp.title }}
                  <el-tag v-if="activeExperimentId === exp.id" type="success" effect="plain" size="small">当前</el-tag>
                </span>
                <span class="experiment-copy">{{ exp.target }}</span>
                <span class="experiment-meta">查看：{{ exp.view }}</span>
              </span>
            </button>
          </div>
        </SectionCard>
      </el-col>

      <el-col :xs="24" :lg="16">
        <SectionCard title="当前实验配置" icon="Operation">
          <div class="current-head">
            <div>
              <div class="current-title">
                <el-icon :style="{ color: currentExperiment.color }"><component :is="currentExperiment.icon" /></el-icon>
                <b>{{ currentExperiment.title }}</b>
              </div>
              <p>{{ currentExperiment.target }}</p>
            </div>
            <el-tag effect="plain">{{ currentExperiment.route }}</el-tag>
          </div>

          <div class="summary-grid">
            <div><span>需要输入</span>{{ currentExperiment.inputs }}</div>
            <div><span>预期观察</span>{{ currentExperiment.expected }}</div>
            <div><span>结果位置</span>{{ currentExperiment.view }}</div>
          </div>

          <el-form class="primary-form" label-width="126px" label-position="left">
            <template v-if="activeExperimentId === 'processor'">
              <el-form-item label="调度算法">
                <el-select v-model="os.config.schedAlgo">
                  <el-option v-for="a in sched" :key="a" :label="a" :value="a" />
                </el-select>
              </el-form-item>
              <el-form-item label="时间片">
                <el-input-number v-model="os.config.quantum" :min="1" :max="10" />
              </el-form-item>
              <el-form-item label="自动新作业">
                <el-switch
                  v-model="os.config.processAutoArrival"
                  active-text="开启"
                  inactive-text="关闭"
                />
              </el-form-item>
              <div class="process-editor">
                <div class="table-head">
                  <h4>进程表</h4>
                  <el-button size="small" plain @click="addProcess"><el-icon><Plus /></el-icon> 添加进程</el-button>
                </div>
                <el-table :data="processConfig" size="small" max-height="260" empty-text="暂无进程，点击添加">
                  <el-table-column label="进程名" min-width="130">
                    <template #default="{ row, $index }">
                      <el-input v-model="row.name" size="small" :placeholder="`P${$index + 1}`" />
                    </template>
                  </el-table-column>
                  <el-table-column label="到达时间" width="120">
                    <template #default="{ row }">
                      <el-input-number v-model="row.arrival" size="small" :min="0" :max="99" controls-position="right" style="width: 100%;" />
                    </template>
                  </el-table-column>
                  <el-table-column label="服务时间" width="120">
                    <template #default="{ row }">
                      <el-input-number v-model="row.burst" size="small" :min="1" :max="99" controls-position="right" style="width: 100%;" />
                    </template>
                  </el-table-column>
                  <el-table-column label="优先级" width="110">
                    <template #default="{ row }">
                      <el-input-number v-model="row.priority" size="small" :min="1" :max="20" controls-position="right" style="width: 100%;" />
                    </template>
                  </el-table-column>
                  <el-table-column label="操作" width="70">
                    <template #default="{ $index }">
                      <el-button type="danger" link size="small" :disabled="processConfig.length <= 1" @click="removeProcess($index)">
                        <el-icon><Delete /></el-icon>
                      </el-button>
                    </template>
                  </el-table-column>
                </el-table>
              </div>
              <p class="hint"><el-icon><InfoFilled /></el-icon> 默认关闭自动新作业，开始后 PCB 只来自上方进程表；开启后每 7 拍会追加新作业。</p>
            </template>

            <template v-else-if="activeExperimentId === 'paging'">
              <el-form-item label="页面置换算法">
                <el-select v-model="os.config.pageAlgo">
                  <el-option v-for="a in page" :key="a" :label="a" :value="a" />
                </el-select>
              </el-form-item>
              <el-form-item label="内存块数">
                <el-input-number v-model="os.config.frameCount" :min="2" :max="32" />
              </el-form-item>
              <el-form-item label="块长">
                <el-input-number v-model="os.config.blockSize" :min="1" :max="4096" />
              </el-form-item>
              <el-form-item label="动态生成页面流">
                <el-switch v-model="os.config.dynamicPages" active-text="启用 (模拟真实OS访存)" />
              </el-form-item>
              <el-form-item v-if="!os.config.dynamicPages" label="页面访问串">
                <el-input
                  v-model="os.config.refStringText"
                  type="textarea"
                  :rows="4"
                  placeholder="逗号分隔页号，例如：7,0,1,2,0,3"
                />
              </el-form-item>
              <p class="hint">
                <el-icon><InfoFilled /></el-icon>
                <template v-if="os.config.dynamicPages">
                  已启用动态页面访问流。每个进程将在初始化/重置时，自动生成符合时间与空间局部性规律的独立访存序列。
                </template>
                <template v-else>
                  解析后页数：{{ parsedRef.length }} · 最大页号：{{ maxPage }} · 参考：FIFO=15 / LRU=12 / OPT=9。
                </template>
              </p>
            </template>

            <template v-else-if="activeExperimentId === 'disk'">
              <el-form-item label="磁盘算法">
                <el-select v-model="os.config.diskAlgo">
                  <el-option v-for="a in disk" :key="a" :label="a" :value="a" />
                </el-select>
              </el-form-item>
              <el-form-item label="请求柱面序列">
                <div class="request-cylinder-list">
                  <el-input-number
                    v-for="(req, index) in os.config.ioRequests"
                    :key="index"
                    v-model="req.柱面号"
                    size="small"
                    :min="0"
                    :max="os.config.cylinders - 1"
                    controls-position="right"
                  />
                  <el-button size="small" plain @click="addReq"><el-icon><Plus /></el-icon> 添加请求</el-button>
                </div>
              </el-form-item>
              <p class="hint"><el-icon><InfoFilled /></el-icon> 初始磁头位置由模拟器固定为 53；详细 I/O 请求表可在高级参数中调整。</p>
            </template>

            <template v-else>
              <el-form-item label="资源总量">
                <el-input-number v-model="os.config.resTotal" :min="1" :max="50" />
              </el-form-item>
              <div class="matrix-note">
                <div><span>Available</span><b>[3, 3, 2]</b></div>
                <div><span>资源矩阵</span><b>使用默认 Max / Allocation 教材样例</b></div>
                <div><span>预期结果</span><b>可观察安全序列；不满足条件时出现告警。</b></div>
              </div>
            </template>
          </el-form>

          <div class="action-bar">
            <el-button plain @click="loadExperiment(currentExperiment)"><el-icon><Download /></el-icon> 加载经典样例</el-button>
            <el-button type="primary" @click="startExperiment"><el-icon><VideoPlay /></el-icon> 开始实验并查看</el-button>
            <el-button @click="save"><el-icon><Check /></el-icon> 应用配置</el-button>
            <el-button type="danger" plain @click="reset"><el-icon><RefreshLeft /></el-icon> 恢复出厂默认</el-button>
          </div>
        </SectionCard>

        <el-collapse v-model="advancedOpen" class="advanced-panel">
          <el-collapse-item name="advanced">
            <template #title>
              <span class="advanced-title">全局参数</span>
              <span class="advanced-sub">以下参数对所有实验共用（不属于任何单一实验类型）</span>
            </template>

            <div class="advanced-block">
              <h4>系统级参数</h4>
              <el-form label-width="128px" label-position="left">
                <el-form-item label="时钟速度">
                  <el-radio-group v-model="os.config.clockSpeed">
                    <el-radio-button v-for="s in [0.5,1,2,4]" :key="s" :value="s">{{ s }}x</el-radio-button>
                  </el-radio-group>
                  <p class="form-hint">控制自动运行时每拍间隔（顶栏运行控制条同样可调，两处同步）</p>
                </el-form-item>
              </el-form>
            </div>

            <div class="advanced-block">
              <h4>磁盘物理几何（所有 I/O 与缺页计算共用）</h4>
              <el-form label-width="128px" label-position="left">
                <el-form-item label="柱面总数">
                  <el-input-number v-model="os.config.cylinders" :min="20" :max="500" :step="10" />
                </el-form-item>
                <el-form-item label="每柱面磁道数">
                  <el-input-number v-model="os.config.tracksPerCyl" :min="1" :max="16" />
                </el-form-item>
                <el-form-item label="每磁道记录数">
                  <el-input-number v-model="os.config.recordsPerTrack" :min="1" :max="32" />
                </el-form-item>
              </el-form>
              <p class="hint">
                <el-icon><InfoFilled /></el-icon>
                改动后请记得点上方"应用配置"重建模拟；磁盘实验的请求柱面号会按此 clamp。
              </p>
            </div>
          </el-collapse-item>
        </el-collapse>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { computed, onActivated, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useOsStore } from '../store/os'
import { useOsDriver } from '../mock/driver'
import { EXPERIMENTS, experimentById } from '../mock/experiments'
import { parseRefString } from '../mock/seed'
import SectionCard from '../components/widgets/SectionCard.vue'

const os = useOsStore()
const driver = useOsDriver()
const route = useRoute()
const router = useRouter()
const experiments = EXPERIMENTS
// 默认实验：query 参数 > 上次选择(localStorage) > 上一路由对应的实验 > 'paging' 兜底。
// 防止"我从处理机调度页过来，结果默认看到的是页面置换实验"的困惑。
const LAST_EXP_KEY = 'quad-os:last-experiment'
const ROUTE_TO_EXP = { '/core/processor': 'processor', '/core/memory': 'paging', '/core/device': 'disk', '/core/resource': 'banker' }
function inferInitialExperimentId() {
  const q = route.query.experiment
  if (q && experimentById(q)) return q
  try {
    const last = localStorage.getItem(LAST_EXP_KEY)
    if (last && experimentById(last)) return last
  } catch (e) { /* ignore */ }
  const backPath = router.options.history.state?.back
  if (backPath && ROUTE_TO_EXP[backPath]) return ROUTE_TO_EXP[backPath]
  return 'paging'
}
const activeExperimentId = ref(inferInitialExperimentId())
// 全局参数面板默认展开 —— 让用户一眼看到磁盘几何 / 时钟速度这类跨实验参数。
const advancedOpen = ref(['advanced'])
const sched = ['FCFS', 'SJF', 'HRRN', 'PRIORITY', 'RR']
const page = ['FIFO', 'LRU', 'OPT', 'CLOCK']
const disk = ['FCFS', 'SSTF', 'SCAN', 'C-SCAN', 'LOOK', 'C-LOOK']

const currentExperiment = computed(() => experimentById(activeExperimentId.value) || experiments[0])
const parsedRef = computed(() => parseRefString(os.config.refStringText))
const maxPage = computed(() => {
  if (os.config.dynamicPages) return 7
  return parsedRef.value.length ? Math.max(...parsedRef.value) : 0
})
const processConfig = computed(() => os.config.processes || [])

function selectExperiment(id) {
  activeExperimentId.value = id
  try { localStorage.setItem(LAST_EXP_KEY, id) } catch (e) { /* ignore */ }
}

function addReq() {
  os.config.ioRequests.push({
    进程名: '进程' + (os.config.ioRequests.length + 1),
    柱面号: Math.floor(os.config.cylinders / 2),
    磁道号: 0,
    物理记录号: 0,
  })
}
function removeReq(i) {
  os.config.ioRequests.splice(i, 1)
}

function nextProcessPid() {
  if (!os.config.processes) os.config.processes = []
  return Math.max(0, ...(os.config.processes || []).map((p) => Number(p.pid) || 0)) + 1
}

function addProcess() {
  if (!os.config.processes) os.config.processes = []
  const pid = nextProcessPid()
  os.config.processes.push({
    pid,
    name: `P${pid}`,
    arrival: 0,
    burst: 5,
    priority: 1,
  })
}

function removeProcess(i) {
  if (!os.config.processes) os.config.processes = []
  if (os.config.processes.length <= 1) {
    ElMessage.warning('至少保留一个进程')
    return
  }
  os.config.processes.splice(i, 1)
}

function clone(v) {
  return JSON.parse(JSON.stringify(v))
}

function loadExperiment(exp) {
  Object.assign(os.config, clone(exp.config))
  if (exp.config.ioRequests) os.config.ioRequests = clone(exp.config.ioRequests)
  if (exp.config.processes) os.config.processes = clone(exp.config.processes)
  activeExperimentId.value = exp.id
  ElMessage.success('已加载：' + exp.title + '，可直接开始实验或继续调整关键输入')
}

async function save() {
  driver.pause()
  os.applyConfig()
  await driver.checkBackend()
  ElMessage.success('配置已应用，模拟已按当前参数重建')
}
async function startExperiment() {
  driver.pause()
  os.applyConfig()
  await driver.checkBackend()
  ElMessage.success('已开始：' + currentExperiment.value.title + '，请使用顶部“单步/运行”观察过程')
  router.push(currentExperiment.value.route)
}
async function reset() {
  try {
    await ElMessageBox.confirm(
      '将清除你修改过的进程表 / I/O 请求 / 页面访问串 / 时间片等所有自定义参数（包括本地缓存与后端持久化），并按出厂默认重建模拟。继续？',
      '恢复出厂默认',
      { type: 'warning', confirmButtonText: '确认清除', cancelButtonText: '取消', confirmButtonClass: 'el-button--danger' }
    )
  } catch (e) {
    return  // 用户取消
  }
  await driver.reset(false)
  activeExperimentId.value = 'paging'
  try { localStorage.removeItem(LAST_EXP_KEY) } catch (e) { /* ignore */ }
  ElMessage.success('已恢复出厂默认并重置模拟')
}

function loadFromRoute(id) {
  const exp = experimentById(id)
  if (exp) loadExperiment(exp)
}

onMounted(() => loadFromRoute(route.query.experiment))
// keep-alive 下组件被复用：每次重新激活时按"路由 + 上次选择"重新推断默认实验，
// 避免"从处理机调度页过来却看到页面置换"的困惑。
onActivated(() => {
  activeExperimentId.value = inferInitialExperimentId()
})
watch(() => route.query.experiment, loadFromRoute)
</script>

<style scoped>
.settings-layout { align-items: flex-start; }
.experiment-list { display: flex; flex-direction: column; gap: 10px; }
.experiment-item {
  width: 100%;
  display: grid;
  grid-template-columns: 34px 1fr;
  gap: 10px;
  text-align: left;
  border: 1px solid #e3eaf2;
  border-radius: 8px;
  background: #f8fafc;
  padding: 12px;
  cursor: pointer;
  transition: border-color .18s ease, background .18s ease, box-shadow .18s ease;
}
.experiment-item:hover { border-color: #b8c7d8; background: #fff; }
.experiment-item.active { border-color: var(--qos-accent); background: var(--qos-accent-soft); box-shadow: 0 0 0 2px rgba(43, 108, 176, .08); }
.experiment-icon {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: #fff;
  border: 1px solid #e7eef6;
  font-size: 17px;
}
.experiment-body { min-width: 0; display: flex; flex-direction: column; gap: 5px; }
.experiment-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--qos-text); font-size: 14px; font-weight: 700; }
.experiment-copy { color: #4f5d6e; font-size: 12px; line-height: 1.5; }
.experiment-meta { color: var(--qos-muted); font-size: 12px; line-height: 1.45; }
.current-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.current-title { display: flex; align-items: center; gap: 8px; color: var(--qos-text); font-size: 16px; }
.current-head p { margin: 7px 0 0; color: #5b6776; font-size: 13px; line-height: 1.55; }
.summary-grid { display: grid; gap: 8px; margin-bottom: 14px; }
.summary-grid div {
  display: grid;
  grid-template-columns: 74px 1fr;
  gap: 10px;
  color: #5b6776;
  font-size: 13px;
  line-height: 1.55;
  padding: 8px 10px;
  border: 1px solid #eef2f7;
  border-radius: 8px;
  background: #fbfdff;
}
.summary-grid span { color: var(--qos-muted); font-weight: 700; }
.primary-form { margin-top: 10px; }
.hint { display: flex; align-items: center; gap: 5px; margin: 10px 0 0; font-size: 12px; color: var(--qos-muted); line-height: 1.45; }
.matrix-note { display: grid; gap: 8px; margin-top: 4px; }
.matrix-note div { display: grid; grid-template-columns: 86px 1fr; gap: 10px; padding: 9px 10px; border: 1px solid #eef2f7; border-radius: 8px; background: #fbfdff; font-size: 13px; }
.matrix-note span { color: var(--qos-muted); font-weight: 700; }
.matrix-note b { color: var(--qos-text); font-weight: 600; }
.process-editor { border: 1px solid #eef2f7; border-radius: 8px; background: #fbfdff; padding: 12px; margin-top: 4px; }
.request-cylinder-list { display: flex; flex-wrap: wrap; gap: 8px; width: 100%; }
.request-cylinder-list .el-input-number { width: 104px; }
.action-bar { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }
.advanced-panel { margin-top: 14px; border: 1px solid #e8eef5; border-radius: 8px; background: #fff; padding: 0 12px; }
.advanced-title { margin-right: 10px; font-weight: 700; color: var(--qos-text); }
.advanced-sub { color: var(--qos-muted); font-size: 12px; }
.advanced-block { border: 1px solid #edf2f7; border-radius: 8px; background: #fbfdff; padding: 12px; margin-bottom: 14px; }
.advanced-block h4 { margin: 0 0 12px; font-size: 14px; color: var(--qos-text); }
.form-hint { margin: 4px 0 0; font-size: 12px; color: var(--qos-muted); line-height: 1.45; }
.advanced-data { margin-top: 2px; }
.table-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.table-head h4 { margin: 0; }
@media (max-width: 1199px) {
  .settings-layout :deep(.el-col) + :deep(.el-col) { margin-top: 14px; }
}
@media (max-width: 640px) {
  .current-head { display: block; }
  .current-head .el-tag { margin-top: 8px; }
  .summary-grid div,
  .matrix-note div { grid-template-columns: 1fr; gap: 4px; }
  .action-bar .el-button { width: 100%; margin-left: 0; }
}
</style>
