<template>
  <el-container style="height: 100vh;">
    <el-aside :width="collapsed ? '64px' : '210px'" class="qos-aside">
      <div class="qos-brand">
        <el-icon class="logo"><Monitor /></el-icon>
        <span v-show="!collapsed">Quad-OS 模拟平台</span>
      </div>
      <el-menu :default-active="$route.path" router :collapse="collapsed" class="qos-menu">
        <el-menu-item index="/">
          <el-icon><DataBoard /></el-icon><template #title>总览大屏</template>
        </el-menu-item>
        <el-menu-item index="/twin">
          <el-icon><Connection /></el-icon><template #title>数字孪生</template>
        </el-menu-item>
        <el-sub-menu index="core">
          <template #title><el-icon><Grid /></el-icon><span>核心管理</span></template>
          <el-menu-item index="/core/processor"><el-icon><Cpu /></el-icon>处理机调度</el-menu-item>
          <el-menu-item index="/core/memory"><el-icon><Coin /></el-icon>存储管理</el-menu-item>
          <el-menu-item index="/core/resource"><el-icon><Share /></el-icon>进程与资源</el-menu-item>
          <el-menu-item index="/core/device"><el-icon><Files /></el-icon>设备管理</el-menu-item>
        </el-sub-menu>
        <el-sub-menu index="ops">
          <template #title><el-icon><Histogram /></el-icon><span>运行监控</span></template>
          <el-menu-item index="/monitor"><el-icon><Monitor /></el-icon>实时监控</el-menu-item>
          <el-menu-item index="/events"><el-icon><List /></el-icon>事件查询</el-menu-item>
          <el-menu-item index="/alarms"><el-icon><Warning /></el-icon>系统告警</el-menu-item>
        </el-sub-menu>
        <el-menu-item index="/settings">
          <el-icon><Setting /></el-icon><template #title>系统设置</template>
        </el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="qos-header">
        <div class="left">
          <el-icon class="collapse-btn" @click="collapsed = !collapsed"><Fold v-if="!collapsed" /><Expand v-else /></el-icon>
          <el-breadcrumb separator="/">
            <el-breadcrumb-item>{{ $route.meta.group || '总览' }}</el-breadcrumb-item>
            <el-breadcrumb-item>{{ $route.meta.title }}</el-breadcrumb-item>
          </el-breadcrumb>
        </div>
        <div class="right">
          <RunControlBar />
          <el-divider direction="vertical" />
          <el-dropdown>
            <span class="user"><el-icon><UserFilled /></el-icon> admin</span>
          </el-dropdown>
        </div>
      </el-header>
      <el-main class="qos-main">
        <router-view v-slot="{ Component }">
          <keep-alive><component :is="Component" /></keep-alive>
        </router-view>
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import RunControlBar from './components/widgets/RunControlBar.vue'
import { useOsDriver } from './mock/driver'
import { useOsStore } from './store/os'

const collapsed = ref(false)
const driver = useOsDriver()
const os = useOsStore()

onMounted(async () => {
  await os.hydrateFromServer().catch(() => {})  // 后端为主：先回填配置
  await driver.checkBackend()
})
</script>

<style scoped>
.qos-aside { background: var(--qos-sider); border-right: 1px solid var(--qos-border); transition: width 0.2s; overflow: hidden; }
.qos-brand { display: flex; align-items: center; gap: 10px; height: 56px; padding: 0 18px; font-weight: 600; font-size: 15px; color: var(--qos-text); border-bottom: 1px solid var(--qos-border); white-space: nowrap; }
.qos-brand .logo { font-size: 22px; color: var(--qos-accent); }
.qos-menu { border-right: none; }
.qos-header { display: flex; align-items: center; justify-content: space-between; background: #fff; border-bottom: 1px solid var(--qos-border); padding: 0 16px; height: 56px; }
.qos-header .left { display: flex; align-items: center; gap: 14px; }
.qos-header .right { display: flex; align-items: center; gap: 6px; }
.collapse-btn { font-size: 18px; cursor: pointer; color: var(--qos-muted); }
.user { display: flex; align-items: center; gap: 6px; cursor: pointer; color: var(--qos-text); font-size: 14px; }
.qos-main { background: var(--qos-bg); padding: 0; overflow: auto; }
</style>
