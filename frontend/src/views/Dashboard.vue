<template>
  <div class="qos-page">
    <div class="qos-page-head">
      <h2 class="qos-page-title">系统总览大屏</h2>
      <p class="qos-page-sub">虚拟操作系统实时运行态 —— 四核心联动 · 点击顶部「运行」驱动模拟</p>
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
            <div v-for="c in coreCards" :key="c.path" class="ch-row" @click="$router.push(c.path)">
              <el-icon :style="{ color: c.color }"><component :is="c.icon" /></el-icon>
              <span class="ch-name">{{ c.name }}</span>
              <el-progress :percentage="c.health" :stroke-width="8" :color="c.color" style="flex:1" />
            </div>
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
import { computed } from 'vue'
import { useOsStore } from '../store/os'
import StatCard from '../components/widgets/StatCard.vue'
import SectionCard from '../components/widgets/SectionCard.vue'
import GaugePanel from '../components/widgets/GaugePanel.vue'
import TrendChart from '../components/widgets/TrendChart.vue'
import RingChart from '../components/widgets/RingChart.vue'
import EventFeed from '../components/widgets/EventFeed.vue'
import StatusBadge from '../components/widgets/StatusBadge.vue'

const os = useOsStore()

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
    { name: '处理机', path: '/core/processor', icon: 'Cpu', color: '#15a98a', health: h.processor },
    { name: '存储', path: '/core/memory', icon: 'Coin', color: '#3b82f6', health: h.memory },
    { name: '资源', path: '/core/resource', icon: 'Share', color: '#8b5cf6', health: h.resource },
    { name: '设备', path: '/core/device', icon: 'Files', color: '#f0a020', health: h.device },
  ]
})
</script>

<style scoped>
.core-health { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }
.ch-row { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; }
.ch-row .ch-name { width: 46px; color: #5b6776; }
.snap { list-style: none; margin: 0; padding: 0; }
.snap li { display: flex; justify-content: space-between; align-items: center; padding: 9px 2px; border-bottom: 1px solid #f1f4f8; font-size: 13px; }
.snap li span { color: var(--qos-muted); }
.snap li b { color: var(--qos-text); }
</style>
