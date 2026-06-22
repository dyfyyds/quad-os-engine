<template>
  <div class="qos-page">
    <div class="qos-page-head">
      <h2 class="qos-page-title">处理机调度核心</h2>
      <p class="qos-page-sub">进程控制块(PCB) · 状态生命周期 · 与磁盘 I/O 联动 —— 当前调度算法：{{ os.config.schedAlgo }}（PCB 来自实验配置中心）</p>
    </div>

    <el-alert class="observe-tip" type="info" show-icon :closable="false"
      title="观察顺序：运行进程 → 就绪/阻塞队列 → 甘特图 → PCB 进度；如需修改进程表，请回到实验配置中心" />

    <el-row :gutter="14" style="margin-bottom: 14px;">
      <el-col :span="6"><StatCard label="运行进程" :value="os.runningProc ? os.runningProc.name : '空闲'" icon="VideoPlay" color="#15a98a" /></el-col>
      <el-col :span="6"><StatCard label="就绪队列" :value="os.metrics.readyLen" icon="List" color="#3b82f6" /></el-col>
      <el-col :span="6"><StatCard label="阻塞队列" :value="os.metrics.blockedLen" icon="Lock" color="#f0a020" /></el-col>
      <el-col :span="6"><StatCard label="已完成" :value="os.metrics.completed" icon="CircleCheck" color="#8b5cf6" /></el-col>
    </el-row>

    <SectionCard title="进程状态生命周期（与磁盘调度联动）" icon="Connection" style="margin-bottom: 14px;">
      <div class="lifecycle">
        <div class="lc-stage lc-new">
          <div class="lc-head"><span class="lc-name">新建</span><span class="lc-count">{{ newProcs.length }}</span></div>
          <div class="lc-procs">
            <el-tag v-for="p in newProcs" :key="p.pid" type="info" size="small" effect="plain">{{ p.name }}</el-tag>
            <span v-if="!newProcs.length" class="lc-empty">空</span>
          </div>
          <div class="lc-tip">到达后 →</div>
        </div>
        <div class="lc-arrow">➜</div>
        <div class="lc-stage lc-ready">
          <div class="lc-head"><span class="lc-name">就绪</span><span class="lc-count">{{ os.readyProcs.length }}</span></div>
          <div class="lc-procs">
            <el-tag v-for="p in os.readyProcs" :key="p.pid" type="primary" size="small" effect="plain">{{ p.name }}</el-tag>
            <span v-if="!os.readyProcs.length" class="lc-empty">空</span>
          </div>
          <div class="lc-tip">等待 CPU 调度</div>
        </div>
        <div class="lc-arrow">➜</div>
        <div class="lc-stage lc-running">
          <div class="lc-head"><span class="lc-name">运行</span><span class="lc-count">{{ os.runningProc ? 1 : 0 }}</span></div>
          <div class="lc-procs">
            <el-tag v-if="os.runningProc" type="success" size="small" effect="dark">{{ os.runningProc.name }}</el-tag>
            <span v-else class="lc-empty">CPU 空闲</span>
          </div>
          <div class="lc-tip">发起 I/O ⇄ 时间片到</div>
        </div>
        <div class="lc-arrow lc-arrow-loop">
          <span>⇅</span>
          <small>I/O</small>
        </div>
        <div class="lc-stage lc-blocked">
          <div class="lc-head"><span class="lc-name">阻塞</span><span class="lc-count">{{ os.blockedProcs.length }}</span></div>
          <div class="lc-procs">
            <el-tag v-for="p in os.blockedProcs" :key="p.pid" type="warning" size="small" effect="plain">{{ p.name }}</el-tag>
            <span v-if="!os.blockedProcs.length" class="lc-empty">空</span>
          </div>
          <div class="lc-tip">等待磁盘 I/O 完成</div>
        </div>
        <div class="lc-arrow">➜</div>
        <div class="lc-stage lc-done">
          <div class="lc-head"><span class="lc-name">完成</span><span class="lc-count">{{ os.doneProcs.length }}</span></div>
          <div class="lc-procs">
            <el-tag v-for="p in os.doneProcs" :key="p.pid" type="info" size="small" effect="light">{{ p.name }}</el-tag>
            <span v-if="!os.doneProcs.length" class="lc-empty">空</span>
          </div>
          <div class="lc-tip">服务时间到</div>
        </div>
      </div>
    </SectionCard>

    <SectionCard title="CPU 执行甘特图" icon="Histogram" style="margin-bottom: 14px;">
      <GanttChart :gantt="os.gantt" />
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
              <el-progress :percentage="Math.min(100, Math.round(row.ran / row.burst * 100))" :stroke-width="10" :format="() => `${row.ran}/${row.burst}`" />
            </template></el-table-column>
            <el-table-column prop="priority" label="优先级" width="72" />
            <el-table-column label="PV 角色" width="92">
              <template #default="{ row }">
                <el-tag v-if="row.pvRole === 'producer'" type="success" size="small" effect="plain">生产者</el-tag>
                <el-tag v-else-if="row.pvRole === 'consumer'" type="warning" size="small" effect="plain">消费者</el-tag>
                <span v-else class="no-reason">—</span>
              </template>
            </el-table-column>
            <el-table-column label="阻塞原因" width="120"><template #default="{ row }">
              <el-tooltip v-if="row.state === '阻塞' && row.blockedReason" :content="row.blockedReason" placement="top">
                <el-tag :type="blockedTagType(row.blockedReason)" size="small" effect="plain">{{ blockedTagLabel(row.blockedReason) }}</el-tag>
              </el-tooltip>
              <span v-else class="no-reason">—</span>
            </template></el-table-column>
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
        <SectionCard title="缺页等待队列（存储中断）" icon="Picture" style="margin-bottom: 14px;">
          <div v-if="!pageFaultDetails.length" class="queue">
            <span class="empty">无缺页等待</span>
          </div>
          <ul v-else class="io-block-list">
            <li v-for="d in pageFaultDetails" :key="d.name">
              <el-tag type="danger" effect="plain">{{ d.name }}</el-tag>
              <span class="io-meta">
                <span>等待页号 <b>{{ d.page }}</b></span>
                <span class="page-wait">
                  <span v-if="d.total">已等待 {{ d.waited }} 拍 / 服务中 (共 {{ d.total }} 拍)</span>
                  <span v-else>已等待 {{ d.waited }} 拍 / 磁盘排队中</span>
                </span>
              </span>
            </li>
          </ul>
        </SectionCard>
        <SectionCard title="I/O 阻塞队列（设备中断 · 等待磁盘）" icon="Lock" style="margin-bottom: 14px;">
          <div v-if="!ioBlockedDetails.length" class="queue">
            <span class="empty">无 I/O 阻塞</span>
          </div>
          <ul v-else class="io-block-list">
            <li v-for="d in ioBlockedDetails" :key="d.name">
              <el-tooltip :content="d.reason || '阻塞中'" placement="top">
                <el-tag type="warning" effect="plain">{{ d.name }}</el-tag>
              </el-tooltip>
              <span class="io-meta">
                <span>等待柱面 <b>{{ d.cyl }}</b></span>
                <span class="dist">
                  <span v-if="d.total">已等待 {{ d.waited }} 拍 / 服务中 (共 {{ d.total }} 拍)</span>
                  <span v-else-if="d.waited !== undefined">已等待 {{ d.waited }} 拍 / 磁盘排队中 (距磁头 {{ d.dist }} 柱)</span>
                  <span v-else>距磁头 {{ d.dist }} 柱</span>
                </span>
              </span>
            </li>
          </ul>
        </SectionCard>
        <SectionCard title="PV 同步阻塞队列（信号量 / 互斥）" icon="Switch">
          <div v-if="!pvBlockedAny" class="queue">
            <span class="empty">无 PV 阻塞</span>
          </div>
          <template v-else>
            <div v-if="os.sync.prodBlocked.length" class="pv-row">
              <span class="pv-row-label">生产者阻塞 · 等待空闲槽 (s1)</span>
              <el-tag v-for="n in os.sync.prodBlocked" :key="n" type="success" effect="plain" size="small">{{ n }}</el-tag>
            </div>
            <div v-if="os.sync.consBlocked.length" class="pv-row">
              <span class="pv-row-label">消费者阻塞 · 等待产品 (s2)</span>
              <el-tag v-for="n in os.sync.consBlocked" :key="n" type="warning" effect="plain" size="small">{{ n }}</el-tag>
            </div>
            <div v-if="os.sync.mutexBlocked.length" class="pv-row">
              <span class="pv-row-label">互斥阻塞 · 等待临界锁 (mutex)</span>
              <el-tag v-for="n in os.sync.mutexBlocked" :key="n" type="danger" effect="plain" size="small">{{ n }}</el-tag>
              <span class="pv-row-owner" v-if="os.sync.lockOwner">锁持有者: <b>{{ os.sync.lockOwner }}</b></span>
            </div>
          </template>
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

const newProcs = computed(() => os.processes.filter((p) => p.state === '新建'))
const pvBlockedAny = computed(() => (os.sync.prodBlocked?.length || 0) + (os.sync.consBlocked?.length || 0) + (os.sync.mutexBlocked?.length || 0) > 0)

// 阻塞原因分类：把长长的中文 reason 字符串归一为简短 tag，悬停展开完整文案。
function blockedTagLabel(reason) {
  const r = String(reason || '')
  if (r.includes('缺页')) return '缺页'
  if (r.includes('PV互斥')) return 'PV 互斥'
  if (r.includes('PV同步')) return 'PV 同步'
  if (r.includes('磁盘 I/O') || r.includes('I/O')) return '磁盘 I/O'
  return '阻塞'
}
function blockedTagType(reason) {
  const r = String(reason || '')
  if (r.includes('缺页')) return 'danger'
  if (r.includes('PV')) return 'info'
  if (r.includes('I/O') || r.includes('磁盘')) return 'warning'
  return ''
}

// 缺页等待队列：state=阻塞 且 pageWaitingFor !== null —— 源于"存储中断"，等待页面装入主存
const pageFaultDetails = computed(() => {
  return os.processes
    .filter((p) => p.state === '阻塞' && p.pageWaitingFor !== null && p.pageWaitingFor !== undefined)
    .map((p) => {
      const active = os.disk.activeRequest
      let total = null
      if (active && active.进程名 === p.name && active.isPageFault) {
        total = active.serviceTime
      }
      return {
        name: p.name,
        page: p.pageWaitingFor,
        waited: p.blockedAt != null ? Math.max(0, os.clock - p.blockedAt) : 0,
        total: total
      }
    })
})

// I/O 阻塞队列：仅取 disk.ioBlocked 中的进程且非缺页 —— 源于"设备中断"，等待磁盘驱动调度
const ioBlockedDetails = computed(() => {
  const blockedNames = new Set(os.disk.ioBlocked || [])
  return os.processes
    .filter((p) => p.state === '阻塞' && blockedNames.has(p.name) && (p.pageWaitingFor === null || p.pageWaitingFor === undefined))
    .map((p) => {
      const req = os.disk.queue.find((r) => r.进程名 === p.name && !r.isPageFault)
      const base = { name: p.name, reason: p.blockedReason || '等待磁盘 I/O' }
      const active = os.disk.activeRequest
      
      if (!req) {
        if (active && active.进程名 === p.name && !active.isPageFault) {
          return {
            ...base,
            cyl: active.柱面号,
            dist: 0,
            waited: p.blockedAt != null ? Math.max(0, os.clock - p.blockedAt) : 0,
            total: active.serviceTime
          }
        }
        return { ...base, cyl: '—', dist: '—' }
      }
      
      let total = null
      if (active && active.进程名 === p.name && !active.isPageFault) {
        total = active.serviceTime
      }
      return {
        ...base,
        cyl: req.柱面号,
        dist: Math.abs(req.柱面号 - os.disk.head),
        waited: p.blockedAt != null ? Math.max(0, os.clock - p.blockedAt) : 0,
        total: total
      }
    })
})

</script>

<style scoped>
.observe-tip { margin-bottom: 14px; }
.queue { display: flex; flex-wrap: wrap; gap: 6px; min-height: 30px; align-items: center; }
.queue .empty { color: #b3bccd; font-size: 12px; }

.lifecycle {
  display: flex;
  align-items: stretch;
  gap: 4px;
}
.lc-stage {
  flex: 1;
  background: #f8fafc;
  border: 1px solid #e8eef5;
  border-radius: 8px;
  padding: 10px 12px;
  min-height: 110px;
  display: flex; flex-direction: column;
}
.lc-stage.lc-new { border-left: 3px solid #94a3b8; }
.lc-stage.lc-ready { border-left: 3px solid #3b82f6; }
.lc-stage.lc-running { border-left: 3px solid #15a98a; background: #effaf6; }
.lc-stage.lc-blocked { border-left: 3px solid #f0a020; }
.lc-stage.lc-done { border-left: 3px solid #8b5cf6; }

.lc-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.lc-name { font-size: 13px; font-weight: 600; color: #1a2436; }
.lc-count {
  font-size: 14px; font-weight: 700; color: #15a98a;
  background: #fff; border: 1px solid #e8eef5; border-radius: 999px;
  padding: 1px 10px; min-width: 28px; text-align: center;
}
.lc-procs {
  display: flex; flex-wrap: wrap; gap: 4px;
  min-height: 26px; align-items: center;
  flex: 1;
}
.lc-empty { color: #b3bccd; font-size: 12px; }
.lc-tip {
  font-size: 11px; color: var(--qos-muted);
  margin-top: 6px; padding-top: 6px;
  border-top: 1px dashed #e8eef5;
}

.lc-arrow {
  display: flex; align-items: center; justify-content: center;
  color: #cbd5e1; font-size: 22px;
  flex: 0 0 22px;
}
.lc-arrow-loop {
  flex-direction: column;
  color: #f0a020; font-size: 18px; font-weight: 700;
  gap: 2px;
}
.lc-arrow-loop small { font-size: 10px; line-height: 1; font-weight: 500; }

.io-block-list {
  list-style: none; margin: 0; padding: 0;
}
.io-block-list li {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 4px; border-bottom: 1px dashed #eef2f7;
}
.io-block-list li:last-child { border-bottom: none; }
.io-meta {
  display: flex; flex-direction: column; gap: 2px;
  font-size: 12px; color: var(--qos-muted);
  flex: 1;
}
.io-meta b { color: #1a2436; font-weight: 600; }
.io-meta .dist { color: #8b5cf6; }
.io-meta .page-wait { color: #e64a45; }
.block-reason { color: #e64a45; font-size: 12px; font-weight: 500; }
.no-reason { color: #b3bccd; }
.pv-row { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; padding: 8px 4px; border-bottom: 1px dashed #eef2f7; }
.pv-row:last-child { border-bottom: none; }
.pv-row-label { font-size: 12px; color: var(--qos-muted); min-width: 100%; margin-bottom: 4px; }
.pv-row-owner { font-size: 12px; color: var(--qos-muted); margin-left: 6px; }
.pv-row-owner b { color: #15a98a; }
</style>
