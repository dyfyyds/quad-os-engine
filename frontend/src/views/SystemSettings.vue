<template>
  <div class="qos-page">
    <div class="qos-page-head">
      <h2 class="qos-page-title">系统设置</h2>
      <p class="qos-page-sub">模拟参数与实验数据配置 —— 保存后即重建并驱动模拟（页表 / 请求队列按新数据重置）</p>
    </div>

    <SectionCard title="实验任务模式" icon="Guide" style="margin-bottom: 14px;">
      <div class="experiment-grid">
        <div v-for="exp in experiments" :key="exp.id" class="experiment-card" :class="{ active: activeExperimentId === exp.id }">
          <div class="experiment-head">
            <el-icon :style="{ color: exp.color }"><component :is="exp.icon" /></el-icon>
            <b>{{ exp.title }}</b>
            <el-tag v-if="activeExperimentId === exp.id" type="success" effect="plain" size="small">已加载</el-tag>
          </div>
          <p><span>目标</span>{{ exp.target }}</p>
          <p><span>输入</span>{{ exp.inputs }}</p>
          <p><span>预期</span>{{ exp.expected }}</p>
          <p><span>查看</span>{{ exp.view }}</p>
          <div class="experiment-actions">
            <el-button size="small" plain @click="loadExperiment(exp)">加载实验</el-button>
            <el-button size="small" type="primary" @click="saveAndView(exp)">保存并查看</el-button>
          </div>
        </div>
      </div>
    </SectionCard>

    <el-row :gutter="14">
      <el-col :span="12">
        <SectionCard title="调度算法" icon="Setting">
          <el-form label-width="120px" label-position="left">
            <el-form-item label="作业/进程调度">
              <el-select v-model="os.config.schedAlgo"><el-option v-for="a in sched" :key="a" :label="a" :value="a" /></el-select>
            </el-form-item>
            <el-form-item label="页面置换">
              <el-select v-model="os.config.pageAlgo"><el-option v-for="a in page" :key="a" :label="a" :value="a" /></el-select>
            </el-form-item>
            <el-form-item label="磁盘驱动调度">
              <el-select v-model="os.config.diskAlgo"><el-option v-for="a in disk" :key="a" :label="a" :value="a" /></el-select>
            </el-form-item>
            <el-form-item label="时间片大小">
              <el-input-number v-model="os.config.quantum" :min="1" :max="10" />
            </el-form-item>
          </el-form>
          <p class="hint"><el-icon><InfoFilled /></el-icon> 算法切换即时生效，无需保存即可影响下一步调度。</p>
        </SectionCard>
      </el-col>
      <el-col :span="12">
        <SectionCard title="模拟参数（保存后重建）" icon="Operation">
          <el-form label-width="120px" label-position="left">
            <el-form-item label="内存块数">
              <el-input-number v-model="os.config.frameCount" :min="2" :max="32" />
            </el-form-item>
            <el-form-item label="块长">
              <el-input-number v-model="os.config.blockSize" :min="1" :max="4096" />
            </el-form-item>
            <el-form-item label="资源总量">
              <el-input-number v-model="os.config.resTotal" :min="1" :max="50" />
            </el-form-item>
            <el-form-item label="柱面总数">
              <el-input-number v-model="os.config.cylinders" :min="20" :max="500" :step="10" />
            </el-form-item>
            <el-form-item label="每柱面磁道数">
              <el-input-number v-model="os.config.tracksPerCyl" :min="1" :max="16" />
            </el-form-item>
            <el-form-item label="每磁道记录数">
              <el-input-number v-model="os.config.recordsPerTrack" :min="1" :max="32" />
            </el-form-item>
            <el-form-item label="时钟速度">
              <el-radio-group v-model="os.config.clockSpeed"><el-radio-button v-for="s in [0.5,1,2,4]" :key="s" :value="s">{{ s }}x</el-radio-button></el-radio-group>
            </el-form-item>
          </el-form>
        </SectionCard>
      </el-col>
    </el-row>

    <el-row :gutter="14" style="margin-top: 14px;">
      <el-col :span="10">
        <SectionCard title="页面访问串（虚拟存储实验数据）" icon="DocumentCopy">
          <el-input v-model="os.config.refStringText" type="textarea" :rows="4"
            placeholder="逗号分隔的页号序列，例如：7,0,1,2,0,3,0,4,2,3,0,3,2,1,2" />
          <p class="hint"><el-icon><InfoFilled /></el-icon> 解析后页数：{{ parsedRef.length }} · 最大页号：{{ maxPage }}（决定页表行数）</p>
        </SectionCard>
      </el-col>
      <el-col :span="14">
        <SectionCard title="I/O 请求队列（驱动调度实验数据）" icon="Files">
          <el-table :data="os.config.ioRequests" size="small" max-height="240" empty-text="暂无请求，点击下方添加">
            <el-table-column label="进程名" width="110"><template #default="{ row }">
              <el-input v-model="row.进程名" size="small" />
            </template></el-table-column>
            <el-table-column label="柱面号"><template #default="{ row }">
              <el-input-number v-model="row.柱面号" size="small" :min="0" :max="os.config.cylinders - 1" controls-position="right" style="width: 100%;" />
            </template></el-table-column>
            <el-table-column label="磁道号"><template #default="{ row }">
              <el-input-number v-model="row.磁道号" size="small" :min="0" :max="os.config.tracksPerCyl - 1" controls-position="right" style="width: 100%;" />
            </template></el-table-column>
            <el-table-column label="物理记录号"><template #default="{ row }">
              <el-input-number v-model="row.物理记录号" size="small" :min="0" :max="os.config.recordsPerTrack - 1" controls-position="right" style="width: 100%;" />
            </template></el-table-column>
            <el-table-column label="操作" width="70"><template #default="{ $index }">
              <el-button type="danger" link size="small" @click="removeReq($index)"><el-icon><Delete /></el-icon></el-button>
            </template></el-table-column>
          </el-table>
          <el-button size="small" plain style="margin-top: 10px;" @click="addReq"><el-icon><Plus /></el-icon> 添加请求</el-button>
        </SectionCard>
      </el-col>
    </el-row>

    <div style="margin-top: 14px; display: flex; gap: 10px;">
      <el-button type="primary" @click="save"><el-icon><Check /></el-icon> 保存并应用配置</el-button>
      <el-button @click="reset"><el-icon><RefreshLeft /></el-icon> 恢复默认并重置</el-button>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
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
const activeExperimentId = ref('')
const sched = ['FCFS', 'SJF', 'HRRN', 'PRIORITY', 'RR']
const page = ['FIFO', 'LRU', 'OPT', 'CLOCK']
const disk = ['FCFS', 'SSTF', 'SCAN', 'C-SCAN', 'LOOK', 'C-LOOK']

const parsedRef = computed(() => parseRefString(os.config.refStringText))
const maxPage = computed(() => Math.max(...parsedRef.value))

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

function clone(v) {
  return JSON.parse(JSON.stringify(v))
}

function loadExperiment(exp) {
  Object.assign(os.config, clone(exp.config))
  if (exp.config.ioRequests) os.config.ioRequests = clone(exp.config.ioRequests)
  activeExperimentId.value = exp.id
  ElMessage.success('已加载：' + exp.title + '，点击“保存并查看”开始观察')
}

function save() {
  driver.pause()
  os.applyConfig()
  ElMessage.success('配置已应用 —— 模拟按新参数重建（页表 / 请求队列已重置），点「运行」开始')
}
function saveAndView(exp) {
  if (activeExperimentId.value !== exp.id) loadExperiment(exp)
  driver.pause()
  os.applyConfig()
  ElMessage.success('已应用：' + exp.title + '，请使用顶部“单步/运行”观察过程')
  router.push(exp.route)
}
function reset() {
  driver.reset()
  activeExperimentId.value = ''
  ElMessage.success('已恢复出厂默认并重置模拟')
}

function loadFromRoute(id) {
  const exp = experimentById(id)
  if (exp) loadExperiment(exp)
}

onMounted(() => loadFromRoute(route.query.experiment))
watch(() => route.query.experiment, loadFromRoute)
</script>

<style scoped>
.hint { display: flex; align-items: center; gap: 5px; margin: 10px 0 0; font-size: 12px; color: var(--qos-muted); }
.experiment-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.experiment-card { border: 1px solid #e8eef5; border-radius: 8px; background: #f8fafc; padding: 12px; }
.experiment-card.active { border-color: var(--qos-accent); background: var(--qos-accent-soft); }
.experiment-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; color: var(--qos-text); }
.experiment-head b { flex: 1; font-size: 14px; }
.experiment-card p { display: grid; grid-template-columns: 38px 1fr; gap: 8px; margin: 6px 0; font-size: 12px; line-height: 1.55; color: #5b6776; }
.experiment-card p span { color: var(--qos-muted); font-weight: 600; }
.experiment-actions { display: flex; gap: 8px; margin-top: 10px; }
</style>
