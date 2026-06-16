<template>
  <div class="page">
    <h2 class="page-title">Quad-OS 多算法操作系统调度模拟平台</h2>
    <p class="page-sub">作业调度 · 资源分配 · 页面置换 · 磁盘调度 · 进程同步 —— 输入参数，观察分步调度过程、状态表与指标</p>

    <el-row :gutter="14">
      <el-col v-for="m in modules" :key="m.path" :span="8" style="margin-bottom: 14px;">
        <div class="home-card" @click="$router.push(m.path)">
          <div class="ic" :style="{ background: m.color }"><el-icon><component :is="m.icon" /></el-icon></div>
          <div>
            <div class="t">{{ m.title }}</div>
            <div class="d">{{ m.desc }}</div>
            <div class="algos"><el-tag v-for="a in m.algos" :key="a" size="small" effect="plain">{{ a }}</el-tag></div>
          </div>
        </div>
      </el-col>
    </el-row>

    <div class="panel" style="margin-top: 6px;">
      <h3>使用说明</h3>
      <ol style="margin: 0; padding-left: 20px; color: #56627a; font-size: 13px; line-height: 1.9;">
        <li>进入任一模块，<b>加载教材预设</b>或自行输入作业 / 内存 / 资源 / 磁盘请求；</li>
        <li>点击<b>运行</b>得到完整调度结果，再用<b>单步 / 播放</b>逐步观察过程动画与状态表；</li>
        <li>右侧实时展示<b>指标汇总</b>（周转时间 / 缺页次数 / 寻道道数 / 安全序列等）与<b>分步日志</b>；</li>
        <li>点击<b>导出报告</b>生成含输入、过程表与指标的 Markdown 实验报告。</li>
      </ol>
    </div>
  </div>
</template>

<script setup>
const modules = [
  { path: '/scheduling', title: '作业调度', icon: 'List', color: '#2f6fec', desc: '先来先服务 / 短作业优先等，输出甘特图与周转时间', algos: ['FCFS', 'SJF', 'HRRN', '优先级', 'RR'] },
  { path: '/banker', title: '资源分配', icon: 'OfficeBuilding', color: '#13a394', desc: '银行家算法避免死锁，给出安全序列', algos: ['银行家', '随机分配'] },
  { path: '/paging', title: '页面置换', icon: 'Files', color: '#e0823d', desc: '统计缺页次数与缺页率，含地址转换', algos: ['FIFO', 'LRU', 'OPT', 'CLOCK'] },
  { path: '/disk', title: '磁盘调度', icon: 'Coin', color: '#9b59d0', desc: '移臂调度，绘制磁头移动轨迹与寻道指标', algos: ['FCFS', 'SSTF', 'SCAN', 'C-SCAN', 'LOOK'] },
  { path: '/sync', title: '进程同步', icon: 'Switch', color: '#d4537e', desc: 'PV 操作信号量与生产者-消费者', algos: ['PV', '生产者-消费者'] },
]
</script>

<style scoped>
.home-card { display: flex; gap: 14px; background: #fff; border: 1px solid #e8ecf3; border-radius: 12px; padding: 18px; cursor: pointer; transition: all .15s; height: 100%; }
.home-card:hover { border-color: #2f6fec; transform: translateY(-2px); box-shadow: 0 6px 18px rgba(47, 111, 236, .12); }
.home-card .ic { width: 46px; height: 46px; border-radius: 10px; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 24px; flex-shrink: 0; }
.home-card .t { font-size: 16px; font-weight: 600; color: #1f2a44; }
.home-card .d { font-size: 12px; color: #8a94a6; margin: 4px 0 8px; line-height: 1.5; }
.home-card .algos { display: flex; flex-wrap: wrap; gap: 4px; }
</style>
