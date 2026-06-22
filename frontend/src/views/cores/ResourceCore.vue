<template>
  <div class="qos-page">
    <div class="qos-page-head">
      <h2 class="qos-page-title">进程与资源核心</h2>
      <p class="qos-page-sub">银行家算法死锁避免 · PV 信号量同步（银行家·同步引擎，进程驱动）</p>
    </div>

    <el-alert class="observe-tip" type="info" show-icon :closable="false"
      title="观察顺序：Available → Need → 安全序列 → 死锁/告警" />

    <el-alert v-if="os.resources.deadlock" type="error" :closable="false" show-icon style="margin-bottom: 14px;"
      title="死锁告警：系统检测到循环等待，处于不安全状态" />

    <el-row :gutter="14">
      <el-col :span="14">
        <SectionCard title="资源分配矩阵 · 安全序列" icon="Grid">
          <BankerMatrix :final="bankerFinal" :steps="[]" :reveal="-1" />
        </SectionCard>
      </el-col>
      <el-col :span="10">
        <SectionCard title="进程同步 · 生产者-消费者" icon="Switch" style="margin-bottom: 14px;">
          <div class="pv-roster">
            <div class="pv-roster-line">
              <span class="pv-roster-label">当前生产者</span>
              <el-tag v-for="p in pvProducers" :key="p.pid" type="success" size="small" effect="plain">{{ p.name }}</el-tag>
              <span v-if="!pvProducers.length" class="pv-roster-empty">无（进程表中 PV 角色 = 生产者 的进程会在此显示）</span>
            </div>
            <div class="pv-roster-line">
              <span class="pv-roster-label">当前消费者</span>
              <el-tag v-for="p in pvConsumers" :key="p.pid" type="warning" size="small" effect="plain">{{ p.name }}</el-tag>
              <span v-if="!pvConsumers.length" class="pv-roster-empty">无</span>
            </div>
          </div>
          <BufferRing :state="syncState" :capacity="os.sync.capacity" />
        </SectionCard>
        <el-row :gutter="14">
          <el-col :span="12"><StatCard label="累计生产" :value="os.sync.produced" icon="Top" color="#15a98a" /></el-col>
          <el-col :span="12"><StatCard label="累计消费" :value="os.sync.consumed" icon="Bottom" color="#3b82f6" /></el-col>
        </el-row>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useOsStore } from '../../store/os'
import StatCard from '../../components/widgets/StatCard.vue'
import SectionCard from '../../components/widgets/SectionCard.vue'
import BankerMatrix from '../../components/viz/BankerMatrix.vue'
import BufferRing from '../../components/viz/BufferRing.vue'

const os = useOsStore()

const pvProducers = computed(() => os.processes.filter(p => p.pvRole === 'producer'))
const pvConsumers = computed(() => os.processes.filter(p => p.pvRole === 'consumer'))

const bankerFinal = computed(() => ({
  Max: os.resources.max,
  Allocation: os.resources.allocation,
  Need: os.resources.need,
  Available: os.resources.available,
  安全序列: os.resources.deadlock ? [] : os.resources.safeSeq,
}))

const syncState = computed(() => ({
  s1_空闲: os.sync.s1,
  s2_产品: os.sync.s2,
  mutex_互斥: os.sync.mutex,
  缓冲区占用: os.sync.buffer,
  缓冲区容量: os.sync.capacity,
  生产者阻塞队列: os.sync.prodBlocked,
  消费者阻塞队列: os.sync.consBlocked,
  互斥阻塞队列: os.sync.mutexBlocked,
  当前持锁进程: os.sync.lockOwner,
}))
</script>

<style scoped>
.observe-tip { margin-bottom: 14px; }
.pv-roster { margin-bottom: 12px; padding: 10px 12px; border: 1px solid #eef2f7; border-radius: 6px; background: #fbfdff; }
.pv-roster-line { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.pv-roster-line + .pv-roster-line { margin-top: 6px; }
.pv-roster-label { font-size: 12px; color: var(--qos-muted); font-weight: 600; min-width: 76px; }
.pv-roster-empty { font-size: 12px; color: #b3bccd; }
</style>
