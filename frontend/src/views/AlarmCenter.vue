<template>
  <div class="qos-page">
    <div class="qos-page-head">
      <h2 class="qos-page-title">系统告警</h2>
      <p class="qos-page-sub">死锁 / 缺页中断 / 资源耗尽 / 缓冲区异常等异常事件汇总</p>
    </div>

    <el-row :gutter="14" style="margin-bottom: 14px;">
      <el-col :span="8"><StatCard label="告警总数" :value="os.alarms.length" icon="Bell" color="#f0a020" /></el-col>
      <el-col :span="8"><StatCard label="严重告警" :value="dangerCount" icon="CircleClose" color="#e64a45" /></el-col>
      <el-col :span="8"><StatCard label="警告" :value="warnCount" icon="Warning" color="#0ea5e9" /></el-col>
    </el-row>

    <SectionCard title="告警列表" icon="Warning">
      <el-table :data="os.alarms" size="small" max-height="460" :empty-text="'暂无告警 —— 系统运行正常'">
        <el-table-column label="时刻" width="80"><template #default="{ row }">T{{ row.ts }}</template></el-table-column>
        <el-table-column label="级别" width="90"><template #default="{ row }">
          <StatusBadge :state="row.level" :label="row.level === 'danger' ? '严重' : '警告'" />
        </template></el-table-column>
        <el-table-column prop="type" label="告警类型" width="130" />
        <el-table-column prop="desc" label="描述" />
      </el-table>
    </SectionCard>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useOsStore } from '../store/os'
import StatCard from '../components/widgets/StatCard.vue'
import SectionCard from '../components/widgets/SectionCard.vue'
import StatusBadge from '../components/widgets/StatusBadge.vue'

const os = useOsStore()
const dangerCount = computed(() => os.alarms.filter((a) => a.level === 'danger').length)
const warnCount = computed(() => os.alarms.filter((a) => a.level === 'warning').length)
</script>
