<template>
  <div class="twin-console">
    <!-- 顶栏 -->
    <header class="tc-head">
      <div class="tc-title">
        <h2>数字孪生 · 内核运行态</h2>
        <p>虚拟操作系统的实时镜像 —— 调度内核与四核心实时联动（<code>twin/world.js</code> 世界模型驱动）</p>
      </div>
      <div class="tc-controls">
        <div class="tc-kernel">
          <span>CPU</span><b>{{ world.cpuUtil }}%</b>
          <i class="sep" />
          <span>就绪</span><b>{{ world.queues.ready }}</b>
          <i class="sep" />
          <span>阻塞</span><b>{{ world.queues.blocked }}</b>
        </div>
        <div class="tc-state" :class="{ on: world.running }">
          <i class="dot" /> {{ world.running ? '运行中' : '已暂停' }} · T{{ world.clock }}
        </div>
        <div class="tc-toggle">
          <button :class="{ active: viewMode === '3d' }" @click="viewMode = '3d'">3D</button>
          <button :class="{ active: viewMode === '2d' }" @click="viewMode = '2d'">2D</button>
        </div>
      </div>
    </header>

    <!-- 主舞台 -->
    <div class="tc-stage">
      <Twin3D v-if="viewMode === '3d'" ref="twin3dRef" />

      <svg v-else class="tc-2d" viewBox="0 0 940 500" preserveAspectRatio="xMidYMid meet">
        <line
          v-for="n in layout2d" :key="'e' + n.key" class="edge" :class="{ active: n.active }"
          x1="470" y1="250" :x2="n.cx" :y2="n.cy"
        />
        <circle cx="470" cy="250" r="54" class="hub-bg" />
        <circle cx="470" cy="250" r="54" class="hub-ring" />
        <text x="470" y="243" text-anchor="middle" class="hub-t1">调度内核</text>
        <text x="470" y="264" text-anchor="middle" class="hub-t2">CPU {{ world.cpuUtil }}%</text>
        <text x="470" y="282" text-anchor="middle" class="hub-t3">就绪 {{ world.queues.ready }} · 阻塞 {{ world.queues.blocked }}</text>
        <g v-for="n in layout2d" :key="n.key" :transform="`translate(${n.cx - 95},${n.cy - 52})`">
          <rect width="190" height="104" rx="12" class="node-bg" :style="{ stroke: n.color }" />
          <circle cx="174" cy="16" r="5" :fill="n.color" :class="{ pulse: n.active }" />
          <text x="18" y="31" class="n-title" :fill="n.color">{{ n.title }}</text>
          <text x="18" y="62" class="n-metric">{{ n.metric }}</text>
          <text x="18" y="82" class="n-sub">{{ n.sub }}</text>
          <rect x="18" y="89" width="154" height="6" rx="3" class="bar-bg" />
          <rect x="18" y="89" :width="Math.max(0, Math.min(154, (n.bar || 0) * 154))" height="6" rx="3" :fill="n.color" />
        </g>
      </svg>

      <!-- 四角 HUD 卡（点击聚焦对应核心） -->
      <div v-if="viewMode === '3d'" class="tc-hud">
        <button
          v-for="c in world.cores" :key="c.key"
          class="hud-card" :class="['pos-' + c.key, { active: c.active }]"
          :style="{ '--c': c.color }"
          @click="focus(c.key)"
        >
          <div class="hc-top">
            <span class="hc-title">{{ c.title }}</span>
            <i class="hc-dot" />
          </div>
          <div class="hc-metric">{{ c.metric }}</div>
          <div class="hc-sub">{{ c.sub }}</div>
          <div class="hc-bar"><i :style="{ width: barW(c) }" /></div>
        </button>
        <button class="hud-reset" @click="focus(null)">全景复位</button>
      </div>
    </div>

    <!-- 底栏：联动事件 + 数据源 -->
    <div class="tc-foot">
      <section class="tc-panel tc-events">
        <h3>联动事件</h3>
        <ul class="ev">
          <li v-for="(e, i) in world.events" :key="i">
            <span class="ev-ts">T{{ e.ts }}</span>
            <span class="ev-core" :style="{ color: coreColor(e.core) }">{{ e.core || '系统' }}</span>
            <span class="ev-desc">{{ e.desc }}</span>
          </li>
          <li v-if="!world.events.length" class="ev-empty">暂无联动事件 —— 启动运行后实时刷新</li>
        </ul>
      </section>
      <section class="tc-panel tc-source">
        <h3>孪生数据源</h3>
        <ul class="ds">
          <li>
            <span>当前数据源</span>
            <b :class="world.backendMode === 'backend' ? 'ok' : 'warn'">
              {{ world.backendMode === 'backend' ? '真实后端引擎' : 'Mock 驱动（本地）' }}
            </b>
          </li>
          <li>
            <span>真实引擎</span>
            <b :class="world.backendMode === 'backend' ? 'ok' : 'muted'">
              {{ world.backendMode === 'backend' ? '已连接' : '未连接（等待）' }}
            </b>
          </li>
          <li><span>外部遥测</span><b class="muted">预留</b></li>
          <li><span>3D 场景</span><b class="ok">已启用 · Three.js</b></li>
        </ul>
        <div class="legend">
          <span><i class="lg active" /> 活动联动</span>
          <span><i class="lg" /> 空闲通道</span>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useOsWorld } from '../twin/world'
import Twin3D from './Twin3D.vue'

const { world } = useOsWorld()
// 支持 ?view=2d 深链直达 2D 视图（亦作 WebGL 兜底）
const viewMode = ref(new URLSearchParams(location.search).get('view') === '2d' ? '2d' : '3d')
const twin3dRef = ref(null)

const POS = { processor: [210, 120], memory: [730, 120], resource: [210, 380], device: [730, 380] }
const layout2d = computed(() => world.value.cores.map((c) => ({ ...c, cx: POS[c.key][0], cy: POS[c.key][1] })))

function barW(c) {
  return Math.round(Math.max(0, Math.min(1, c.bar || 0)) * 100) + '%'
}
function coreColor(key) {
  return world.value.cores.find((c) => c.key === key)?.color || '#7fa6c0'
}
function focus(key) {
  twin3dRef.value && twin3dRef.value.focusCore(key)
}
</script>

<style scoped>
.twin-console {
  --tc-line: rgba(127, 200, 220, 0.1);
  --tc-glass: rgba(15, 23, 38, 0.66);
  --tc-text: #d6e2ee;
  --tc-muted: #7f93a8;
  position: relative;
  padding: 16px 18px 18px;
  border-radius: 14px;
  color: var(--tc-text);
  background: radial-gradient(120% 80% at 50% -10%, #122036 0%, #0c1626 45%, #080d18 100%);
  box-shadow: inset 0 0 80px rgba(0, 0, 0, 0.55), 0 1px 3px rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(127, 227, 207, 0.08);
  overflow: hidden;
}

/* 顶栏 */
.tc-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 14px; flex-wrap: wrap; }
.tc-title h2 { margin: 0; font-size: 18px; font-weight: 600; color: #eef5fb; letter-spacing: 0.3px; }
.tc-title p { margin: 5px 0 0; font-size: 12px; color: var(--tc-muted); }
.tc-title code { background: rgba(127, 227, 207, 0.1); color: #7fe3cf; padding: 1px 6px; border-radius: 5px; }
.tc-controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.tc-kernel { display: flex; align-items: center; gap: 7px; padding: 7px 12px; border-radius: 9px; background: var(--tc-glass); border: 1px solid var(--tc-line); font-size: 12px; }
.tc-kernel span { color: var(--tc-muted); }
.tc-kernel b { color: #7fe3cf; font-weight: 600; }
.tc-kernel .sep { width: 1px; height: 12px; background: var(--tc-line); }
.tc-state { display: flex; align-items: center; gap: 7px; padding: 7px 13px; border-radius: 9px; background: var(--tc-glass); border: 1px solid var(--tc-line); font-size: 12px; color: var(--tc-muted); }
.tc-state .dot { width: 8px; height: 8px; border-radius: 50%; background: #586b80; }
.tc-state.on { color: #cdebe2; }
.tc-state.on .dot { background: #15a98a; box-shadow: 0 0 9px 1px rgba(21, 169, 138, 0.8); animation: tcpulse 1.6s ease-in-out infinite; }
@keyframes tcpulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
.tc-toggle { display: flex; padding: 3px; border-radius: 9px; background: var(--tc-glass); border: 1px solid var(--tc-line); }
.tc-toggle button { border: 0; background: transparent; color: var(--tc-muted); font-size: 12px; font-weight: 600; padding: 5px 14px; border-radius: 6px; cursor: pointer; transition: all 0.18s; }
.tc-toggle button.active { background: linear-gradient(180deg, #17b896, #128a70); color: #fff; box-shadow: 0 2px 10px rgba(21, 169, 138, 0.4); }

/* 主舞台 */
.tc-stage { position: relative; border-radius: 12px; overflow: hidden; }
.tc-2d { width: 100%; height: 540px; display: block; background: #060b14; border-radius: 12px; }
.tc-2d .edge { stroke: #243244; stroke-width: 2.5; stroke-dasharray: 7 7; }
.tc-2d .edge.active { stroke: #15a98a; animation: tcflow 0.5s linear infinite; }
@keyframes tcflow { to { stroke-dashoffset: -14; } }
.tc-2d .hub-bg { fill: #0c2b27; }
.tc-2d .hub-ring { fill: none; stroke: #15a98a; stroke-width: 2; opacity: 0.85; }
.tc-2d .hub-t1 { fill: #eafaf5; font-size: 15px; font-weight: 600; }
.tc-2d .hub-t2 { fill: #7fe3cf; font-size: 12px; }
.tc-2d .hub-t3 { fill: #7f93a8; font-size: 10px; }
.tc-2d .node-bg { fill: rgba(17, 26, 42, 0.92); stroke-width: 1.5; }
.tc-2d .n-title { font-size: 14px; font-weight: 600; }
.tc-2d .n-metric { font-size: 18px; font-weight: 700; fill: #eef5fb; }
.tc-2d .n-sub { font-size: 11px; fill: #7f93a8; }
.tc-2d .bar-bg { fill: #1b2638; }
.tc-2d .pulse { animation: tcpulse 1.2s ease-in-out infinite; }

/* 四角 HUD */
.tc-hud { position: absolute; inset: 0; pointer-events: none; }
.hud-card {
  position: absolute; width: 168px; text-align: left; pointer-events: auto; cursor: pointer;
  padding: 9px 12px; border-radius: 11px; border: 1px solid var(--tc-line); border-left: 2px solid var(--c, #15a98a);
  background: rgba(11, 18, 31, 0.62); backdrop-filter: blur(9px); -webkit-backdrop-filter: blur(9px);
  color: var(--tc-text); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4); transition: transform 0.18s, box-shadow 0.18s, border-color 0.18s;
}
.hud-card:hover { transform: translateY(-2px); box-shadow: 0 12px 30px rgba(0, 0, 0, 0.55); }
.hud-card.active { box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4), 0 0 0 1px var(--c), 0 0 18px -4px var(--c); }
.hc-top { display: flex; align-items: center; justify-content: space-between; }
.hc-title { font-size: 12px; font-weight: 600; color: var(--c, #cfe); letter-spacing: 0.3px; }
.hc-dot { width: 7px; height: 7px; border-radius: 50%; background: #44566b; }
.hud-card.active .hc-dot { background: var(--c); box-shadow: 0 0 8px 1px var(--c); animation: tcpulse 1.2s ease-in-out infinite; }
.hc-metric { font-size: 17px; font-weight: 700; color: #f2f7fc; margin: 3px 0 1px; line-height: 1.15; }
.hc-sub { font-size: 11px; color: var(--tc-muted); }
.hc-bar { margin-top: 7px; height: 4px; border-radius: 2px; background: rgba(255, 255, 255, 0.07); overflow: hidden; }
.hc-bar i { display: block; height: 100%; border-radius: 2px; background: var(--c, #15a98a); transition: width 0.5s ease; }
.pos-processor { top: 14px; left: 14px; }
.pos-memory { top: 14px; right: 14px; }
.pos-resource { bottom: 14px; left: 14px; }
.pos-device { bottom: 14px; right: 14px; }
.hud-reset {
  position: absolute; top: 14px; left: 50%; transform: translateX(-50%); pointer-events: auto; cursor: pointer;
  padding: 6px 14px; border-radius: 8px; border: 1px solid var(--tc-line); background: rgba(11, 18, 31, 0.62);
  backdrop-filter: blur(9px); -webkit-backdrop-filter: blur(9px); color: var(--tc-muted); font-size: 12px; transition: all 0.18s;
}
.hud-reset:hover { color: #7fe3cf; border-color: rgba(127, 227, 207, 0.35); }

/* 底栏 */
.tc-foot { display: grid; grid-template-columns: 1.6fr 1fr; gap: 14px; margin-top: 14px; }
.tc-panel { padding: 13px 15px; border-radius: 12px; background: var(--tc-glass); border: 1px solid var(--tc-line); }
.tc-panel h3 { margin: 0 0 10px; font-size: 13px; font-weight: 600; color: #cfdcea; }
.ev { list-style: none; margin: 0; padding: 0; max-height: 168px; overflow-y: auto; }
.ev li { display: flex; align-items: baseline; gap: 9px; padding: 5px 2px; border-bottom: 1px solid rgba(255, 255, 255, 0.04); font-size: 12px; }
.ev-ts { color: #5f7387; font-variant-numeric: tabular-nums; min-width: 30px; }
.ev-core { font-weight: 600; min-width: 38px; }
.ev-desc { color: var(--tc-text); flex: 1; }
.ev-empty { color: var(--tc-muted); justify-content: center; }
.ds { list-style: none; margin: 0; padding: 0; }
.ds li { display: flex; align-items: center; justify-content: space-between; padding: 8px 2px; border-bottom: 1px solid rgba(255, 255, 255, 0.04); font-size: 12.5px; }
.ds li span { color: var(--tc-muted); }
.ds b { font-weight: 600; font-size: 12px; }
.ds b.ok { color: #2fe0bf; }
.ds b.warn { color: #f0a85a; }
.ds b.muted { color: #6b7d92; }
.legend { display: flex; gap: 16px; margin-top: 10px; font-size: 11px; color: var(--tc-muted); }
.legend .lg { display: inline-block; width: 13px; height: 0; border-top: 2.5px dashed #2a3a4d; vertical-align: middle; margin-right: 5px; }
.legend .lg.active { border-color: #15a98a; }

@media (max-width: 980px) {
  .tc-foot { grid-template-columns: 1fr; }
  .hud-card { width: 140px; }
}
</style>
