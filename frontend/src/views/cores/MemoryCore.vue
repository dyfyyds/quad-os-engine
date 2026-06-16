<template>
  <div class="qos-page">
    <div class="qos-page-head">
      <h2 class="qos-page-title">存储管理核心</h2>
      <p class="qos-page-sub">分页式虚拟存储 · 页框 · 页表 · 缺页中断 —— 当前置换算法：{{ os.config.pageAlgo }}（mock）</p>
    </div>

    <el-row :gutter="14" style="margin-bottom: 14px;">
      <el-col :span="6"><StatCard label="缺页次数" :value="os.memory.faults" icon="Warning" color="#e64a45" /></el-col>
      <el-col :span="6"><StatCard label="命中次数" :value="os.memory.hits" icon="CircleCheck" color="#15a98a" /></el-col>
      <el-col :span="6"><StatCard label="缺页率" :value="os.metrics.faultRate" unit="%" icon="DataLine" color="#f0a020" /></el-col>
      <el-col :span="6"><StatCard label="内存占用" :value="os.metrics.memUtil" unit="%" icon="Coin" color="#3b82f6" /></el-col>
    </el-row>

    <SectionCard title="物理内存页框" icon="Grid" style="margin-bottom: 14px;">
      <div class="frames">
        <div v-for="(f, i) in os.memory.frames" :key="i" class="frame" :class="{ filled: f !== null }">
          <div class="fno">块 {{ i }}</div>
          <div class="fpage">{{ f === null ? '空闲' : '页 ' + f }}</div>
        </div>
      </div>
      <el-progress :percentage="os.metrics.memUtil" :stroke-width="14" :text-inside="true" style="margin-top: 14px;" />
    </SectionCard>

    <SectionCard title="页表" icon="List">
      <el-table :data="os.memory.pageTable" size="small" max-height="280">
        <el-table-column prop="页号" label="页号" />
        <el-table-column label="状态"><template #default="{ row }">
          <el-tag :type="row.标志 === 1 ? 'success' : 'info'" effect="plain" size="small">{{ row.标志 === 1 ? '在主存' : '在外存' }}</el-tag>
        </template></el-table-column>
        <el-table-column label="主存块号"><template #default="{ row }">{{ row.主存块号 === null ? '—' : row.主存块号 }}</template></el-table-column>
      </el-table>
    </SectionCard>
  </div>
</template>

<script setup>
import { useOsStore } from '../../store/os'
import StatCard from '../../components/widgets/StatCard.vue'
import SectionCard from '../../components/widgets/SectionCard.vue'

const os = useOsStore()
</script>

<style scoped>
.frames { display: flex; flex-wrap: wrap; gap: 10px; }
.frame { width: 90px; border: 1.5px dashed #c7d0e0; border-radius: 8px; padding: 10px; text-align: center; }
.frame.filled { border-style: solid; border-color: var(--qos-accent); background: var(--qos-accent-soft); }
.frame .fno { font-size: 11px; color: var(--qos-muted); }
.frame .fpage { font-size: 15px; font-weight: 600; color: var(--qos-text); margin-top: 4px; }
</style>
