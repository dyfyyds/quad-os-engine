import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  { path: '/', name: 'dashboard', component: () => import('../views/Dashboard.vue'),
    meta: { title: '总览大屏', icon: 'DataBoard', group: '总览' } },
  { path: '/twin', name: 'twin', component: () => import('../views/DigitalTwin.vue'),
    meta: { title: '数字孪生', icon: 'Connection', group: '总览' } },

  { path: '/core/processor', name: 'processor', component: () => import('../views/cores/ProcessorCore.vue'),
    meta: { title: '处理机调度', icon: 'Cpu', group: '核心管理' } },
  { path: '/core/memory', name: 'memory', component: () => import('../views/cores/MemoryCore.vue'),
    meta: { title: '存储管理', icon: 'Coin', group: '核心管理' } },
  { path: '/core/resource', name: 'resource', component: () => import('../views/cores/ResourceCore.vue'),
    meta: { title: '进程与资源', icon: 'Share', group: '核心管理' } },
  { path: '/core/device', name: 'device', component: () => import('../views/cores/DeviceCore.vue'),
    meta: { title: '设备管理', icon: 'Files', group: '核心管理' } },

  { path: '/monitor', name: 'monitor', component: () => import('../views/RealtimeMonitor.vue'),
    meta: { title: '实时监控', icon: 'Monitor', group: '运行监控' } },
  { path: '/events', name: 'events', component: () => import('../views/EventQuery.vue'),
    meta: { title: '事件查询', icon: 'List', group: '运行监控' } },
  { path: '/alarms', name: 'alarms', component: () => import('../views/AlarmCenter.vue'),
    meta: { title: '系统告警', icon: 'Warning', group: '运行监控' } },

  { path: '/settings', name: 'settings', component: () => import('../views/SystemSettings.vue'),
    meta: { title: '系统设置', icon: 'Setting', group: '系统' } },
]

export default createRouter({
  history: createWebHistory(),
  routes,
})
