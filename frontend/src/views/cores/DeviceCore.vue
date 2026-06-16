<template>
  <div class="qos-page">
    <div class="qos-page-head">
      <h2 class="qos-page-title">设备管理核心</h2>
      <p class="qos-page-sub">磁盘移臂调度 · 磁头移动轨迹 · I/O 请求队列 —— 当前算法：{{ os.config.diskAlgo }}（mock）</p>
    </div>

    <el-row :gutter="14" style="margin-bottom: 14px;">
      <el-col :span="6"><StatCard label="磁头位置" :value="os.disk.head" unit="道" icon="Position" color="#8b5cf6" /></el-col>
      <el-col :span="6"><StatCard label="累计寻道" :value="os.disk.totalSeek" unit="道" icon="Odometer" color="#15a98a" /></el-col>
      <el-col :span="6"><StatCard label="等待请求" :value="os.disk.queue.length" icon="Files" color="#f0a020" /></el-col>
      <el-col :span="6"><StatCard label="已服务" :value="os.disk.served" icon="CircleCheck" color="#3b82f6" /></el-col>
    </el-row>

    <el-row :gutter="14">
      <el-col :span="16">
        <SectionCard title="磁头移动轨迹" icon="TrendCharts">
          <DiskTrack :path="os.disk.path" :disk-size="os.disk.trackCount" :reveal="os.disk.path.length" />
        </SectionCard>
      </el-col>
      <el-col :span="8">
        <SectionCard title="I/O 请求队列" icon="List" style="margin-bottom: 14px;">
          <div class="queue">
            <el-tag v-for="(t, i) in os.disk.queue" :key="i" effect="plain">磁道 {{ t }}</el-tag>
            <span v-if="!os.disk.queue.length" class="empty">队列为空</span>
          </div>
        </SectionCard>
        <SectionCard title="设备状态" icon="Monitor">
          <ul class="snap">
            <li><span>磁盘设备</span><StatusBadge state="正常" /></li>
            <li><span>磁道总数</span><b>{{ os.disk.trackCount }}</b></li>
            <li><span>平均寻道</span><b>{{ os.disk.served ? Math.round(os.disk.totalSeek / os.disk.served) : 0 }} 道</b></li>
          </ul>
        </SectionCard>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { useOsStore } from '../../store/os'
import StatCard from '../../components/widgets/StatCard.vue'
import SectionCard from '../../components/widgets/SectionCard.vue'
import StatusBadge from '../../components/widgets/StatusBadge.vue'
import DiskTrack from '../../components/viz/DiskTrack.vue'

const os = useOsStore()
</script>

<style scoped>
.queue { display: flex; flex-wrap: wrap; gap: 6px; min-height: 30px; align-items: center; }
.queue .empty { color: #b3bccd; font-size: 12px; }
.snap { list-style: none; margin: 0; padding: 0; }
.snap li { display: flex; justify-content: space-between; align-items: center; padding: 9px 2px; border-bottom: 1px solid #f1f4f8; font-size: 13px; }
.snap li span { color: var(--qos-muted); }
</style>
