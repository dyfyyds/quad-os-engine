<template>
  <div class="qos-page">
    <div class="qos-page-head">
      <h2 class="qos-page-title">实时监控</h2>
      <p class="qos-page-sub">操作系统运行态实时快照 —— 处理机 / 存储 / 设备 / 资源 全维度</p>
    </div>

    <el-row :gutter="14" style="margin-bottom: 14px;">
      <el-col :span="6"><SectionCard title="CPU 利用率"><GaugePanel :value="os.metrics.cpuUtil" label="CPU" color="#15a98a" :height="150" /></SectionCard></el-col>
      <el-col :span="6"><SectionCard title="内存占用"><GaugePanel :value="os.metrics.memUtil" label="MEM" color="#3b82f6" :height="150" /></SectionCard></el-col>
      <el-col :span="6"><SectionCard title="缺页率"><GaugePanel :value="os.metrics.faultRate" label="FAULT" color="#e64a45" :height="150" /></SectionCard></el-col>
      <el-col :span="6"><SectionCard title="磁盘忙碌率"><GaugePanel :value="diskLoad" label="DISK" color="#8b5cf6" :height="150" /></SectionCard></el-col>
    </el-row>

    <el-row :gutter="14">
      <el-col :span="8">
        <SectionCard title="处理机" icon="Cpu">
          <ul class="snap">
            <li><span>当前运行</span><b>{{ os.runningProc ? os.runningProc.name : '空闲' }}</b></li>
            <li><span>就绪队列长度</span><b>{{ os.metrics.readyLen }}</b></li>
            <li><span>阻塞队列长度</span><b>{{ os.metrics.blockedLen }}</b></li>
            <li><span>已完成进程</span><b>{{ os.metrics.completed }}</b></li>
            <li><span>吞吐量</span><b>{{ os.metrics.throughput }}</b></li>
          </ul>
        </SectionCard>
      </el-col>
      <el-col :span="8">
        <SectionCard title="存储 / 资源" icon="Coin">
          <ul class="snap">
            <li><span>缺页次数</span><b>{{ os.memory.faults }}</b></li>
            <li><span>命中次数</span><b>{{ os.memory.hits }}</b></li>
            <li><span>资源状态</span><StatusBadge :state="os.resources.deadlock ? '死锁' : '安全'" /></li>
            <li><span>安全序列</span><b>{{ os.resources.deadlock ? '—' : os.resources.safeSeq.join(',') }}</b></li>
            <li><span>缓冲区</span><b>{{ os.sync.buffer }} / {{ os.sync.capacity }}</b></li>
          </ul>
        </SectionCard>
      </el-col>
      <el-col :span="8">
        <SectionCard title="设备" icon="Files">
          <ul class="snap">
            <li><span>磁头位置</span><b>磁道 {{ os.disk.head }}</b></li>
            <li><span>等待请求</span><b>{{ os.disk.queue.length }}</b></li>
            <li><span>累计寻道</span><b>{{ os.disk.totalSeek }} 道</b></li>
            <li><span>已服务</span><b>{{ os.disk.served }}</b></li>
            <li><span>设备状态</span><StatusBadge state="正常" /></li>
          </ul>
        </SectionCard>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useOsStore } from '../store/os'
import SectionCard from '../components/widgets/SectionCard.vue'
import GaugePanel from '../components/widgets/GaugePanel.vue'
import StatusBadge from '../components/widgets/StatusBadge.vue'

const os = useOsStore()
const diskLoad = computed(() => os.disk.busyRate || 0)
</script>

<style scoped>
.snap { list-style: none; margin: 0; padding: 0; }
.snap li { display: flex; justify-content: space-between; align-items: center; padding: 9px 2px; border-bottom: 1px solid #f1f4f8; font-size: 13px; }
.snap li span { color: var(--qos-muted); }
.snap li b { color: var(--qos-text); }
</style>
