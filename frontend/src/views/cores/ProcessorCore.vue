<template>
  <div class="qos-page">
    <div class="qos-page-head">
      <h2 class="qos-page-title">处理机调度核心</h2>
      <p class="qos-page-sub">进程控制块(PCB) · 就绪/阻塞队列 · 甘特图 —— 当前调度算法：{{ os.config.schedAlgo }}（调度引擎）</p>
    </div>

    <el-row :gutter="14" style="margin-bottom: 14px;">
      <el-col :span="6"><StatCard label="运行进程" :value="os.runningProc ? os.runningProc.name : '空闲'" icon="VideoPlay" color="#15a98a" /></el-col>
      <el-col :span="6"><StatCard label="就绪队列" :value="os.metrics.readyLen" icon="List" color="#3b82f6" /></el-col>
      <el-col :span="6"><StatCard label="阻塞队列" :value="os.metrics.blockedLen" icon="Lock" color="#f0a020" /></el-col>
      <el-col :span="6"><StatCard label="已完成" :value="os.metrics.completed" icon="CircleCheck" color="#8b5cf6" /></el-col>
    </el-row>

    <SectionCard title="CPU 执行甘特图" icon="Histogram" style="margin-bottom: 14px;">
      <GanttChart :gantt="os.gantt" :reveal="ganttReveal" />
    </SectionCard>

    <el-row :gutter="14">
      <el-col :span="15">
        <SectionCard title="进程控制块 (PCB)" icon="Grid">
          <el-table :data="os.processes" size="small" max-height="320">
            <el-table-column prop="pid" label="PID" width="60" />
            <el-table-column prop="name" label="进程名" />
            <el-table-column label="状态" width="90"><template #default="{ row }"><StatusBadge :state="row.state" /></template></el-table-column>
            <el-table-column prop="arrival" label="到达" width="64" />
            <el-table-column prop="burst" label="服务" width="64" />
            <el-table-column label="进度" width="140"><template #default="{ row }">
              <el-progress :percentage="Math.min(100, Math.round(row.ran / row.burst * 100))" :stroke-width="10" />
            </template></el-table-column>
            <el-table-column prop="priority" label="优先级" width="72" />
          </el-table>
        </SectionCard>
      </el-col>
      <el-col :span="9">
        <SectionCard title="就绪队列" icon="Sort" style="margin-bottom: 14px;">
          <div class="queue">
            <el-tag v-for="p in os.readyProcs" :key="p.pid" type="primary" effect="plain">{{ p.name }}</el-tag>
            <span v-if="!os.readyProcs.length" class="empty">空</span>
          </div>
        </SectionCard>
        <SectionCard title="阻塞队列" icon="Lock">
          <div class="queue">
            <el-tag v-for="p in os.blockedProcs" :key="p.pid" type="warning" effect="plain">{{ p.name }}</el-tag>
            <span v-if="!os.blockedProcs.length" class="empty">空</span>
          </div>
        </SectionCard>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useOsStore } from '../../store/os'
import StatCard from '../../components/widgets/StatCard.vue'
import SectionCard from '../../components/widgets/SectionCard.vue'
import StatusBadge from '../../components/widgets/StatusBadge.vue'
import GanttChart from '../../components/viz/GanttChart.vue'

const os = useOsStore()
const ganttReveal = computed(() => {
  for (let i = os.gantt.length - 1; i >= 0; i--) {
    if (os.gantt[i].开始 < os.clock) return i
  }
  return -1
})
</script>

<style scoped>
.queue { display: flex; flex-wrap: wrap; gap: 6px; min-height: 30px; align-items: center; }
.queue .empty { color: #b3bccd; font-size: 12px; }
</style>
