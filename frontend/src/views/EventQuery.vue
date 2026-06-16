<template>
  <div class="qos-page">
    <div class="qos-page-head">
      <h2 class="qos-page-title">事件查询</h2>
      <p class="qos-page-sub">系统调度事件日志 —— 进程切换 / 缺页中断 / 资源分配 / I/O / 死锁</p>
    </div>

    <SectionCard>
      <template #extra>
        <el-button size="small" @click="exportCsv"><el-icon><Download /></el-icon> 导出</el-button>
      </template>
      <div class="filters">
        <span>核心</span>
        <el-select v-model="filterCore" size="small" style="width: 130px;">
          <el-option label="全部" value="" />
          <el-option v-for="c in cores" :key="c.v" :label="c.l" :value="c.v" />
        </el-select>
        <span>级别</span>
        <el-select v-model="filterLevel" size="small" style="width: 120px;">
          <el-option label="全部" value="" />
          <el-option label="信息" value="info" />
          <el-option label="警告" value="warning" />
          <el-option label="严重" value="danger" />
        </el-select>
        <el-input v-model="keyword" size="small" placeholder="关键字" style="width: 180px;" clearable />
        <span class="total">共 {{ filtered.length }} 条</span>
      </div>

      <el-table :data="paged" size="small" style="margin-top: 12px;">
        <el-table-column label="时刻" width="80"><template #default="{ row }">T{{ row.ts }}</template></el-table-column>
        <el-table-column prop="type" label="事件类型" width="120" />
        <el-table-column label="核心" width="110"><template #default="{ row }">{{ coreName(row.core) }}</template></el-table-column>
        <el-table-column label="级别" width="90"><template #default="{ row }"><StatusBadge :state="row.level" :label="levelName(row.level)" /></template></el-table-column>
        <el-table-column prop="desc" label="描述" />
      </el-table>

      <div style="display: flex; justify-content: flex-end; margin-top: 12px;">
        <el-pagination layout="prev, pager, next, total" :total="filtered.length"
          :page-size="pageSize" v-model:current-page="page" small background />
      </div>
    </SectionCard>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useOsStore } from '../store/os'
import SectionCard from '../components/widgets/SectionCard.vue'
import StatusBadge from '../components/widgets/StatusBadge.vue'

const os = useOsStore()
const cores = [
  { v: 'processor', l: '处理机' }, { v: 'memory', l: '存储' },
  { v: 'resource', l: '资源' }, { v: 'device', l: '设备' }, { v: 'system', l: '系统' },
]
const coreName = (c) => (cores.find((x) => x.v === c) || { l: c }).l
const levelName = (l) => ({ info: '信息', warning: '警告', danger: '严重' }[l] || l)

const filterCore = ref('')
const filterLevel = ref('')
const keyword = ref('')
const page = ref(1)
const pageSize = 12

const filtered = computed(() => os.events.filter((e) =>
  (!filterCore.value || e.core === filterCore.value) &&
  (!filterLevel.value || e.level === filterLevel.value) &&
  (!keyword.value || e.desc.includes(keyword.value) || e.type.includes(keyword.value))
))
const paged = computed(() => filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize))

function exportCsv() {
  const rows = [['时刻', '事件类型', '核心', '级别', '描述'],
    ...filtered.value.map((e) => [e.ts, e.type, coreName(e.core), levelName(e.level), e.desc])]
  const csv = '﻿' + rows.map((r) => r.join(',')).join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  a.download = '系统事件日志.csv'
  a.click()
  ElMessage.success('已导出 ' + filtered.value.length + ' 条事件')
}
</script>

<style scoped>
.filters { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; color: var(--qos-muted); }
.filters .total { margin-left: auto; }
</style>
