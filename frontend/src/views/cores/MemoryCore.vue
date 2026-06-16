<template>
  <div class="qos-page">
    <div class="qos-page-head">
      <h2 class="qos-page-title">存储管理核心</h2>
      <p class="qos-page-sub">分页式虚拟存储 · 修改位/访问位/外存地址 · 缺页置换 —— 当前置换算法：{{ os.config.pageAlgo }}（mock）</p>
    </div>

    <el-row :gutter="14" style="margin-bottom: 14px;">
      <el-col :span="6"><StatCard label="缺页次数" :value="os.memory.faults" icon="Warning" color="#e64a45" /></el-col>
      <el-col :span="6"><StatCard label="命中次数" :value="os.memory.hits" icon="CircleCheck" color="#15a98a" /></el-col>
      <el-col :span="6"><StatCard label="缺页率" :value="os.metrics.faultRate" unit="%" icon="DataLine" color="#f0a020" /></el-col>
      <el-col :span="6"><StatCard label="内存占用" :value="os.metrics.memUtil" unit="%" icon="Coin" color="#3b82f6" /></el-col>
    </el-row>

    <SectionCard title="物理内存页框" icon="Grid" style="margin-bottom: 14px;">
      <div class="frames">
        <div v-for="(f, i) in os.memory.frames" :key="i" class="frame"
          :class="{ filled: f !== null, hot: lr.装入块 === i }">
          <div class="fno">块 {{ i }}</div>
          <div class="fpage">{{ f === null ? '空闲' : '页 ' + f }}</div>
        </div>
      </div>
      <el-progress :percentage="os.metrics.memUtil" :stroke-width="14" :text-inside="true" style="margin-top: 14px;" />
    </SectionCard>

    <SectionCard title="最近一次访存 / 缺页置换" icon="Switch" style="margin-bottom: 14px;">
      <el-descriptions :column="6" border size="small">
        <el-descriptions-item label="访问页号">
          <span class="big">{{ lr.访问页 === null ? '—' : '页 ' + lr.访问页 }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="结果">
          <el-tag v-if="lr.访问页 === null" type="info" effect="plain" size="small">待运行</el-tag>
          <el-tag v-else-if="lr.缺页" type="danger" effect="dark" size="small">缺页中断</el-tag>
          <el-tag v-else type="success" effect="dark" size="small">命中</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="调出页面">
          <span class="big out">{{ swapOutText }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="装入页号">
          <span class="big in">{{ lr.缺页 ? '页 ' + lr.装入页 : '—' }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="装入主存块">
          {{ lr.装入块 === null ? '—' : '块 ' + lr.装入块 }}
        </el-descriptions-item>
        <el-descriptions-item label="是否写回外存">
          <el-tag :type="lr.写回 ? 'warning' : 'info'" effect="plain" size="small">{{ lr.写回 ? '是 · 修改位=1 写回' : '否' }}</el-tag>
        </el-descriptions-item>
      </el-descriptions>
    </SectionCard>

    <SectionCard title="页表（页号 · 标志 · 主存块号 · 访问位 · 修改位 · 外存地址）" icon="List">
      <el-table :data="os.memory.pageTable" size="small" max-height="320" :row-class-name="rowClass">
        <el-table-column prop="页号" label="页号" width="70" />
        <el-table-column label="标志（状态位）" width="120"><template #default="{ row }">
          <el-tag :type="row.标志 === 1 ? 'success' : 'info'" effect="plain" size="small">{{ row.标志 === 1 ? '1 · 在主存' : '0 · 在外存' }}</el-tag>
        </template></el-table-column>
        <el-table-column label="主存块号" width="100"><template #default="{ row }">{{ row.主存块号 === null ? '—' : row.主存块号 }}</template></el-table-column>
        <el-table-column label="访问位 A" width="100"><template #default="{ row }">
          <span class="bit" :class="{ on: row.访问位 === 1 }">{{ row.访问位 }}</span>
        </template></el-table-column>
        <el-table-column label="修改位 M" width="100"><template #default="{ row }">
          <span class="bit" :class="{ warn: row.修改位 === 1 }">{{ row.修改位 }}</span>
        </template></el-table-column>
        <el-table-column label="外存地址（磁盘位置）"><template #default="{ row }">
          <span class="addr">{{ row.外存地址 }}</span>
        </template></el-table-column>
      </el-table>
    </SectionCard>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useOsStore } from '../../store/os'
import StatCard from '../../components/widgets/StatCard.vue'
import SectionCard from '../../components/widgets/SectionCard.vue'

const os = useOsStore()
const lr = computed(() => os.memory.lastReplace)

const swapOutText = computed(() => {
  const r = lr.value
  if (!r.缺页) return '—'
  return r.调出页 === null ? '无（装入空闲块）' : '页 ' + r.调出页
})

// 命中/装入的页所在行高亮
const rowClass = ({ row }) => (lr.value.装入页 === row.页号 && lr.value.装入块 !== null ? 'row-active' : '')
</script>

<style scoped>
.frames { display: flex; flex-wrap: wrap; gap: 10px; }
.frame { width: 90px; border: 1.5px dashed #c7d0e0; border-radius: 8px; padding: 10px; text-align: center; transition: all .25s; }
.frame.filled { border-style: solid; border-color: var(--qos-accent); background: var(--qos-accent-soft); }
.frame.hot { border-color: #f0a020; box-shadow: 0 0 0 3px rgba(240, 160, 32, .18); }
.frame .fno { font-size: 11px; color: var(--qos-muted); }
.frame .fpage { font-size: 15px; font-weight: 600; color: var(--qos-text); margin-top: 4px; }

.big { font-size: 14px; font-weight: 700; color: var(--qos-text); }
.big.out { color: #e64a45; }
.big.in { color: #15a98a; }

.bit { display: inline-block; min-width: 22px; text-align: center; color: #9aa4b6; font-variant-numeric: tabular-nums; }
.bit.on { color: #15a98a; font-weight: 700; }
.bit.warn { color: #f0a020; font-weight: 700; }
.addr { font-family: 'Consolas', 'Menlo', monospace; color: #6b77a0; }

:deep(.row-active) { background: var(--qos-accent-soft) !important; }
</style>
