<template>
  <div class="qos-page">
    <div class="qos-page-head">
      <h2 class="qos-page-title">设备管理核心 · 磁盘驱动调度</h2>
      <p class="qos-page-sub">移臂调度（按柱面号） + 旋转调度（按物理记录号） · 真实盘面几何 —— 当前算法：{{ os.config.diskAlgo }}（驱动调度引擎）</p>
    </div>

    <el-row :gutter="14" style="margin-bottom: 14px;">
      <el-col :span="6"><StatCard label="磁头柱面" :value="os.disk.head" unit="柱" icon="Position" color="#8b5cf6" /></el-col>
      <el-col :span="6"><StatCard label="累计移臂" :value="os.disk.totalSeek" unit="柱" icon="Odometer" color="#15a98a" /></el-col>
      <el-col :span="6"><StatCard label="等待请求" :value="os.disk.queue.length" icon="Files" color="#f0a020" /></el-col>
      <el-col :span="6"><StatCard label="已服务" :value="os.disk.served" icon="CircleCheck" color="#3b82f6" /></el-col>
    </el-row>

    <el-row :gutter="14" style="margin-bottom: 14px;">
      <el-col :span="16">
        <SectionCard title="移臂轨迹（柱面号）" icon="TrendCharts">
          <DiskTrack :path="os.disk.path" :disk-size="os.disk.cylinders" :reveal="os.disk.path.length" />
        </SectionCard>
      </el-col>
      <el-col :span="8">
        <SectionCard title="设备状态" icon="Monitor">
          <ul class="snap">
            <li><span>磁盘设备</span><StatusBadge state="正常" /></li>
            <li><span>柱面总数</span><b>{{ os.disk.cylinders }}</b></li>
            <li><span>每柱面磁道数</span><b>{{ os.disk.tracksPerCyl }}</b></li>
            <li><span>每磁道记录数</span><b>{{ os.disk.recordsPerTrack }}</b></li>
            <li><span>当前物理记录</span><b>{{ os.disk.currentRecord }}</b></li>
            <li><span>平均寻道</span><b>{{ os.disk.served ? (os.disk.totalSeek / os.disk.served).toFixed(1) : 0 }} 柱</b></li>
          </ul>
        </SectionCard>
      </el-col>
    </el-row>

    <el-row :gutter="14">
      <el-col :span="12">
        <SectionCard title="I/O 请求队列" icon="List">
          <el-table :data="os.disk.queue" size="small" max-height="280" empty-text="队列为空">
            <el-table-column prop="进程名" label="进程名" />
            <el-table-column prop="柱面号" label="柱面号" sortable />
            <el-table-column prop="磁道号" label="磁道号" />
            <el-table-column prop="物理记录号" label="物理记录号" />
            <el-table-column label="距磁头" width="80"><template #default="{ row }">
              <span class="dist">{{ Math.abs(row.柱面号 - os.disk.head) }}</span>
            </template></el-table-column>
          </el-table>
        </SectionCard>
      </el-col>
      <el-col :span="12">
        <SectionCard title="最近服务记录" icon="Finished">
          <el-table :data="os.disk.servedLog" size="small" max-height="280" empty-text="尚未开始调度">
            <el-table-column prop="进程名" label="进程名" />
            <el-table-column prop="柱面号" label="柱面号" />
            <el-table-column prop="磁道号" label="磁道号" />
            <el-table-column prop="物理记录号" label="记录号" />
            <el-table-column label="寻道" width="70"><template #default="{ row }">
              <span class="seek">{{ row.寻道 }}</span>
            </template></el-table-column>
          </el-table>
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
.snap { list-style: none; margin: 0; padding: 0; }
.snap li { display: flex; justify-content: space-between; align-items: center; padding: 9px 2px; border-bottom: 1px solid #f1f4f8; font-size: 13px; }
.snap li:last-child { border-bottom: none; }
.snap li span { color: var(--qos-muted); }
.dist { color: #8b5cf6; font-weight: 600; }
.seek { color: #15a98a; font-weight: 600; }
</style>
