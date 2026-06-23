<template>
  <div class="qos-page">
    <div class="qos-page-head">
      <h2 class="qos-page-title">系统总览大屏</h2>
      <p class="qos-page-sub">虚拟操作系统实时运行态 —— 四核心联动 · 点击顶部「运行」驱动模拟</p>
    </div>

    <el-dialog v-model="guideVisible" title="欢迎使用 Quad-OS" width="720px" :close-on-click-modal="false" @closed="markGuideSeen">
      <div class="guide-dialog">
        <p class="guide-intro">Quad-OS 是一个综合操作系统模拟平台，把处理机调度、存储管理、进程资源、设备管理整合为一个<strong>运行中的虚拟 OS</strong>。</p>
        <div class="guide-flow">
          <div class="guide-flow-item">
            <div class="guide-flow-num">1</div>
            <div class="guide-flow-body">
              <b>选择实验场景</b>
              <span>点击下方任一实验卡片，系统将自动加载经典输入数据和推荐参数。</span>
            </div>
          </div>
          <div class="guide-flow-item">
            <div class="guide-flow-num">2</div>
            <div class="guide-flow-body">
              <b>确认配置并进入核心页</b>
              <span>在实验配置中心检查输入，点击「应用并前往」跳转到对应核心页面。</span>
            </div>
          </div>
          <div class="guide-flow-item">
            <div class="guide-flow-num">3</div>
            <div class="guide-flow-body">
              <b>运行模拟并观察</b>
              <span>使用顶部「单步」逐周期观察算法过程，或点「运行」连续推进查看联动效果。</span>
            </div>
          </div>
        </div>
        <div class="guide-cards">
          <div v-for="exp in experiments" :key="exp.id" class="guide-card" :style="{ '--card-color': exp.color }" @click="openExperiment(exp.id)">
            <span class="guide-card-icon"><el-icon :size="18"><component :is="exp.icon" /></el-icon></span>
            <span class="guide-card-title">{{ exp.title }}</span>
            <span class="guide-card-desc">{{ exp.target.slice(0, 40) }}…</span>
          </div>
        </div>
      </div>
      <template #footer>
        <el-checkbox v-model="dontShowAgain" style="float:left;margin-top:6px">不再显示</el-checkbox>
        <el-button @click="guideVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <SectionCard v-if="!quickStartCollapsed" title="快速开始" icon="Guide" style="margin-bottom: 14px;">
      <template #extra>
        <el-button text size="small" @click="quickStartCollapsed = true">收起</el-button>
      </template>
      <div class="quick-start">
        <div class="quick-steps">
          <div class="quick-step"><b>1</b> 选择实验<span class="step-desc">加载经典输入</span></div>
          <el-icon class="step-arrow"><ArrowRight /></el-icon>
          <div class="quick-step"><b>2</b> 确认配置<span class="step-desc">进入核心页</span></div>
          <el-icon class="step-arrow"><ArrowRight /></el-icon>
          <div class="quick-step"><b>3</b> 运行观察<span class="step-desc">看联动效果</span></div>
        </div>
        <div class="quick-cards">
          <div v-for="exp in experiments" :key="exp.id" class="quick-card" :style="{ '--card-color': exp.color }" @click="openExperiment(exp.id)">
            <span class="qc-icon"><el-icon><component :is="exp.icon" /></el-icon></span>
            <span class="qc-title">{{ exp.title }}</span>
          </div>
        </div>
      </div>
    </SectionCard>
    <div v-else class="quick-collapsed" @click="quickStartCollapsed = false; guideVisible = true">
      <el-icon><Guide /></el-icon> 需要帮助？点击展开快速开始或查看向导
    </div>

    <!-- KPI -->
    <el-row :gutter="14" style="margin-bottom: 14px;">
      <el-col :span="4" v-for="k in kpis" :key="k.label">
        <StatCard :label="k.label" :value="k.value" :unit="k.unit" :icon="k.icon" :color="k.color" />
      </el-col>
    </el-row>

    <!-- 趋势 + 状态分布 -->
    <el-row :gutter="14" style="margin-bottom: 14px;">
      <el-col :span="16">
        <SectionCard title="实时性能趋势" icon="TrendCharts">
          <TrendChart :labels="os.history.labels" :series="trendSeries" :height="230" />
        </SectionCard>
      </el-col>
      <el-col :span="8">
        <SectionCard title="进程状态分布" icon="PieChart">
          <RingChart :data="stateData" :height="230" />
        </SectionCard>
      </el-col>
    </el-row>

    <!-- 仪表盘 + 核心健康 -->
    <el-row :gutter="14" style="margin-bottom: 14px;">
      <el-col :span="6">
        <SectionCard title="CPU 利用率"><GaugePanel :value="os.metrics.cpuUtil" label="CPU" color="#15a98a" /></SectionCard>
      </el-col>
      <el-col :span="6">
        <SectionCard title="内存占用"><GaugePanel :value="os.metrics.memUtil" label="MEM" color="#3b82f6" /></SectionCard>
      </el-col>
      <el-col :span="6">
        <SectionCard title="磁盘忙碌率"><GaugePanel :value="diskLoad" label="DISK" color="#8b5cf6" /></SectionCard>
      </el-col>
      <el-col :span="6">
        <SectionCard title="四核心健康度" icon="Cpu">
          <div class="core-health">
            <el-tooltip
              v-for="c in coreCards" :key="c.path"
              placement="left" :show-after="200" effect="light">
              <template #content>
                <div class="health-tip">
                  <div class="health-tip-head"><b>{{ c.name }}</b> · 当前 {{ c.health }} 分</div>
                  <ul>
                    <li v-for="(r, i) in c.reasons" :key="i" :class="{ neg: r.delta < 0, pos: r.delta > 0 }">
                      <span>{{ r.label }}</span>
                      <span class="health-delta">{{ r.delta === 0 ? '—' : (r.delta > 0 ? '+' + r.delta : r.delta) }}</span>
                    </li>
                  </ul>
                </div>
              </template>
              <div class="ch-row" @click="$router.push(c.path)">
                <el-icon :style="{ color: c.color }"><component :is="c.icon" /></el-icon>
                <span class="ch-name">{{ c.name }}</span>
                <el-progress :percentage="c.health" :stroke-width="8" :color="c.color" style="flex:1" />
              </div>
            </el-tooltip>
          </div>
        </SectionCard>
      </el-col>
    </el-row>

    <!-- 事件流 + 当前快照 -->
    <el-row :gutter="14">
      <el-col :span="16">
        <SectionCard title="实时事件流" icon="Bell">
          <template #extra><el-link type="primary" @click="$router.push('/events')">查看全部</el-link></template>
          <EventFeed :events="os.events" :height="280" />
        </SectionCard>
      </el-col>
      <el-col :span="8">
        <SectionCard title="运行快照" icon="Monitor">
          <ul class="snap">
            <li><span>当前运行</span><b>{{ os.runningProc ? os.runningProc.name : '空闲' }}</b></li>
            <li><span>就绪 / 阻塞</span><b>{{ os.metrics.readyLen }} / {{ os.metrics.blockedLen }}</b></li>
            <li><span>已完成进程</span><b>{{ os.metrics.completed }}</b></li>
            <li><span>磁头位置</span><b>磁道 {{ os.disk.head }}</b></li>
            <li><span>累计寻道</span><b>{{ os.disk.totalSeek }}</b></li>
            <li><span>资源状态</span><b><StatusBadge :state="os.resources.deadlock ? '死锁' : '安全'" /></b></li>
            <li><span>缓冲区</span><b>{{ os.sync.buffer }} / {{ os.sync.capacity }}</b></li>
          </ul>
        </SectionCard>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useOsStore } from '../store/os'
import { EXPERIMENTS } from '../mock/experiments'
import StatCard from '../components/widgets/StatCard.vue'
import SectionCard from '../components/widgets/SectionCard.vue'
import GaugePanel from '../components/widgets/GaugePanel.vue'
import TrendChart from '../components/widgets/TrendChart.vue'
import RingChart from '../components/widgets/RingChart.vue'
import EventFeed from '../components/widgets/EventFeed.vue'
import StatusBadge from '../components/widgets/StatusBadge.vue'

const os = useOsStore()
const router = useRouter()
const experiments = EXPERIMENTS
const guideVisible = ref(false)
const quickStartCollapsed = ref(false)
const dontShowAgain = ref(false)
const GUIDE_KEY = 'quad-os-guide-seen'

onMounted(() => {
  if (typeof window !== 'undefined' && window.localStorage.getItem(GUIDE_KEY) !== '1') {
    guideVisible.value = true
  }
})

function markGuideSeen() {
  if (typeof window !== 'undefined') {
    if (dontShowAgain.value) window.localStorage.setItem(GUIDE_KEY, '1')
  }
}

function openExperiment(id) {
  markGuideSeen()
  guideVisible.value = false
  router.push({ path: '/settings', query: { experiment: id } })
}

const kpis = computed(() => [
  { label: 'CPU 利用率', value: os.metrics.cpuUtil, unit: '%', icon: 'Cpu', color: '#15a98a' },
  { label: '内存占用', value: os.metrics.memUtil, unit: '%', icon: 'Coin', color: '#3b82f6' },
  { label: '进程总数', value: os.processes.length, unit: '', icon: 'Operation', color: '#8b5cf6' },
  { label: '就绪队列', value: os.metrics.readyLen, unit: '', icon: 'List', color: '#f0a020' },
  { label: '磁盘队列', value: os.metrics.diskQueueLen, unit: '', icon: 'Files', color: '#e64a45' },
  { label: '缺页率', value: os.metrics.faultRate, unit: '%', icon: 'Warning', color: '#0ea5e9' },
])

const trendSeries = computed(() => [
  { name: 'CPU%', data: os.history.cpu, color: '#15a98a' },
  { name: '内存%', data: os.history.mem, color: '#3b82f6' },
  { name: '缺页率%', data: os.history.fault, color: '#e64a45' },
])

const stateData = computed(() => {
  const d = os.stateDist
  return [
    { name: '新建', value: d.新建, color: '#94a3b8' },
    { name: '运行', value: d.运行, color: '#15a98a' },
    { name: '就绪', value: d.就绪, color: '#3b82f6' },
    { name: '阻塞', value: d.阻塞, color: '#f0a020' },
    { name: '完成', value: d.完成, color: '#b3bccd' },
  ]
})

const diskLoad = computed(() => os.disk.busyRate || 0)

const coreCards = computed(() => {
  const h = os.coreHealth
  return [
    { name: '处理机', path: '/core/processor', icon: 'Cpu',   color: '#15a98a', health: h.processor, reasons: h.processorReasons },
    { name: '存储',   path: '/core/memory',    icon: 'Coin',  color: '#3b82f6', health: h.memory,    reasons: h.memoryReasons },
    { name: '资源',   path: '/core/resource',  icon: 'Share', color: '#8b5cf6', health: h.resource,  reasons: h.resourceReasons },
    { name: '设备',   path: '/core/device',    icon: 'Files', color: '#f0a020', health: h.device,    reasons: h.deviceReasons },
  ]
})
</script>

<style scoped>
.core-health { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

/* —— 弹窗引导 —— */
.guide-intro { color: #5b6776; font-size: 13px; margin: 0 0 18px; line-height: 1.7; }
.guide-flow { display: flex; flex-direction: column; gap: 14px; margin-bottom: 20px; }
.guide-flow-item { display: flex; gap: 12px; align-items: flex-start; }
.guide-flow-num { width: 28px; height: 28px; border-radius: 50%; background: var(--qos-accent); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; flex-shrink: 0; }
.guide-flow-body b { display: block; font-size: 13px; color: var(--qos-text); margin-bottom: 2px; }
.guide-flow-body span { font-size: 12px; color: var(--qos-muted); line-height: 1.5; }
.guide-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; }
.guide-card { border: 1.5px solid #e8eef5; border-radius: 10px; padding: 14px; cursor: pointer; transition: all .18s; display: flex; flex-direction: column; gap: 6px; }
.guide-card:hover { border-color: var(--card-color); background: color-mix(in srgb, var(--card-color) 6%, #fff); transform: translateY(-1px); box-shadow: 0 2px 8px rgba(0,0,0,.06); }
.guide-card-icon { color: var(--card-color); }
.guide-card-title { font-size: 13px; font-weight: 600; color: var(--qos-text); }
.guide-card-desc { font-size: 11px; color: var(--qos-muted); line-height: 1.4; }

/* —— 快速开始区块 —— */
.quick-start { display: flex; flex-direction: column; gap: 14px; }
.quick-steps { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.quick-step { display: flex; align-items: center; gap: 6px; background: #f8fafc; border: 1px solid #e8eef5; border-radius: 8px; padding: 8px 14px; font-size: 13px; color: var(--qos-text); }
.quick-step b { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; background: var(--qos-accent); color: #fff; font-size: 11px; flex-shrink: 0; }
.step-desc { font-size: 11px; color: var(--qos-muted); margin-left: 4px; }
.step-arrow { color: #cdd5e3; font-size: 14px; }
.quick-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
.quick-card { display: flex; align-items: center; gap: 8px; border: 1.5px solid #e8eef5; border-radius: 8px; padding: 10px 14px; cursor: pointer; transition: all .15s; }
.quick-card:hover { border-color: var(--card-color); background: color-mix(in srgb, var(--card-color) 5%, #fff); }
.qc-icon { color: var(--card-color); font-size: 16px; display: flex; }
.qc-title { font-size: 13px; font-weight: 600; color: var(--qos-text); }
.quick-collapsed { text-align: center; padding: 10px; margin-bottom: 14px; background: #f8fafc; border: 1px dashed #d3dce5; border-radius: 8px; color: var(--qos-muted); font-size: 12px; cursor: pointer; transition: all .15s; }
.quick-collapsed:hover { border-color: var(--qos-accent); color: var(--qos-accent); }

.ch-row { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; }
.ch-row .ch-name { width: 46px; color: #5b6776; }
.snap { list-style: none; margin: 0; padding: 0; }
.snap li { display: flex; justify-content: space-between; align-items: center; padding: 9px 2px; border-bottom: 1px solid #f1f4f8; font-size: 13px; }
.snap li span { color: var(--qos-muted); }
.snap li b { color: var(--qos-text); }
</style>
<style>
/* tooltip 内容样式（el-tooltip 内容渲染在外部，故不能 scoped）*/
.health-tip { min-width: 200px; font-size: 12px; }
.health-tip-head { font-size: 13px; margin-bottom: 6px; color: #1a2436; }
.health-tip ul { list-style: none; margin: 0; padding: 0; }
.health-tip li { display: flex; justify-content: space-between; gap: 12px; padding: 3px 0; color: #5b6776; }
.health-tip li.neg { color: #e64a45; }
.health-tip li.pos { color: #15a98a; }
.health-tip .health-delta { font-weight: 600; font-variant-numeric: tabular-nums; }
</style>
