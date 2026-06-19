<template>
  <div class="qos-page">
    <div class="qos-page-head">
      <h2 class="qos-page-title">数字孪生 · 内核运行态</h2>
      <p class="qos-page-sub">虚拟操作系统的实时镜像 —— 调度内核与四核心实时联动（3D / 2D 双视图，<code>twin/world.js</code> 世界模型驱动）</p>
    </div>

    <SectionCard>
      <template #extra>
        <div style="display: flex; align-items: center; gap: 10px;">
          <el-radio-group v-model="viewMode" size="small">
            <el-radio-button value="3d">3D</el-radio-button>
            <el-radio-button value="2d">2D</el-radio-button>
          </el-radio-group>
          <el-tag effect="plain" :type="world.running ? 'success' : 'info'">
            {{ world.running ? '运行中' : '已暂停' }} · 虚拟时钟 T{{ world.clock }}
          </el-tag>
        </div>
      </template>

      <Twin3D v-if="viewMode === '3d'" />

      <svg v-show="viewMode === '2d'" viewBox="0 0 940 500" style="width: 100%; height: auto;">
        <!-- 联动总线 -->
        <line v-for="n in layout" :key="'e' + n.key" class="edge" :class="{ active: n.active }"
          x1="470" y1="250" :x2="n.cx" :y2="n.cy" />

        <!-- 调度内核 hub -->
        <circle cx="470" cy="250" r="52" fill="#0f3b34" />
        <circle cx="470" cy="250" r="52" fill="none" stroke="#15a98a" stroke-width="2" class="hub-ring" />
        <text x="470" y="244" text-anchor="middle" class="hub-t1">调度内核</text>
        <text x="470" y="264" text-anchor="middle" class="hub-t2">CPU {{ world.cpuUtil }}%</text>
        <text x="470" y="280" text-anchor="middle" class="hub-t3">就绪 {{ world.queues.ready }} · 阻塞 {{ world.queues.blocked }}</text>

        <!-- 四核心节点 -->
        <g v-for="n in layout" :key="n.key" :transform="`translate(${n.cx - 100},${n.cy - 54})`">
          <rect width="200" height="108" rx="12" fill="#fff" :stroke="n.color" stroke-width="1.5" />
          <circle cx="184" cy="16" r="5" :fill="n.color" :class="{ pulse: n.active }" />
          <text x="18" y="30" class="n-title" :fill="n.color">{{ n.title }}</text>
          <text x="18" y="62" class="n-metric">{{ n.metric }}</text>
          <text x="18" y="82" class="n-sub">{{ n.sub }}</text>
          <rect x="18" y="90" width="164" height="7" rx="3.5" fill="#eef2f6" />
          <rect x="18" y="90" :width="Math.max(0, Math.min(164, n.bar * 164))" height="7" rx="3.5" :fill="n.color" />
        </g>
      </svg>

      <div class="twin-foot">
        <span><i class="legend a"></i> 活动联动通道</span>
        <span><i class="legend"></i> 空闲通道</span>
        <span class="hint">提示：世界模型 <code>twin/world.js</code> 渲染无关，未来可接 3D(Three.js) 或外部真实遥测</span>
      </div>
    </SectionCard>

    <el-row :gutter="14" style="margin-top: 14px;">
      <el-col :span="16">
        <SectionCard title="联动事件" icon="Share">
          <EventFeed :events="world.events" :height="180" />
        </SectionCard>
      </el-col>
      <el-col :span="8">
        <SectionCard title="孪生数据源" icon="Connection">
          <ul class="ds">
            <li>
              <span>当前数据源</span>
              <el-tag :type="world.backendMode === 'backend' ? 'success' : 'warning'" effect="plain" size="small">
                {{ world.backendMode === 'backend' ? '真实后端引擎' : 'Mock 驱动 (本地)' }}
              </el-tag>
            </li>
            <li>
              <span>真实引擎</span>
              <el-tag :type="world.backendMode === 'backend' ? 'success' : 'info'" effect="plain" size="small">
                {{ world.backendMode === 'backend' ? '已连接' : '未连接 (等待连接)' }}
              </el-tag>
            </li>
            <li><span>外部遥测</span><el-tag type="info" effect="plain" size="small">预留</el-tag></li>
            <li>
              <span>3D 场景</span>
              <el-tag type="success" effect="plain" size="small">已启用 (Three.js)</el-tag>
            </li>
          </ul>
        </SectionCard>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useOsWorld } from '../twin/world'
import SectionCard from '../components/widgets/SectionCard.vue'
import EventFeed from '../components/widgets/EventFeed.vue'
import Twin3D from './Twin3D.vue'

const { world } = useOsWorld()
const viewMode = ref('3d')

const POS = { processor: [210, 120], memory: [730, 120], resource: [210, 380], device: [730, 380] }
const layout = computed(() => world.value.cores.map((c) => ({ ...c, cx: POS[c.key][0], cy: POS[c.key][1] })))
</script>

<style scoped>
.edge { stroke: #d3dce5; stroke-width: 2.5; stroke-dasharray: 7 7; }
.edge.active { stroke: #15a98a; animation: flow 0.5s linear infinite; }
@keyframes flow { to { stroke-dashoffset: -14; } }
.hub-ring { animation: spin 8s linear infinite; transform-origin: 470px 250px; }
@keyframes spin { to { transform: rotate(360deg); } }
.hub-t1 { fill: #fff; font-size: 15px; font-weight: 600; }
.hub-t2 { fill: #7fe3cf; font-size: 12px; }
.hub-t3 { fill: #9fb6c5; font-size: 10px; }
.n-title { font-size: 14px; font-weight: 600; }
.n-metric { font-size: 18px; font-weight: 700; fill: #1f2a37; }
.n-sub { font-size: 11px; fill: #8a96a6; }
.pulse { animation: pulse 1.2s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
.twin-foot { display: flex; align-items: center; gap: 18px; margin-top: 8px; font-size: 12px; color: var(--qos-muted); flex-wrap: wrap; }
.twin-foot .legend { display: inline-block; width: 14px; height: 0; border-top: 2.5px dashed #d3dce5; vertical-align: middle; margin-right: 4px; }
.twin-foot .legend.a { border-color: #15a98a; }
.twin-foot .hint { margin-left: auto; }
.twin-foot code { background: #eef2f6; padding: 1px 5px; border-radius: 4px; }
.ds { list-style: none; margin: 0; padding: 0; }
.ds li { display: flex; justify-content: space-between; align-items: center; padding: 9px 2px; border-bottom: 1px solid #f1f4f8; font-size: 13px; }
.ds li span { color: var(--qos-muted); }
</style>
