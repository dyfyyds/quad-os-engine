<template>
  <div ref="container" class="twin3d">
    <div v-if="failed" class="twin3d-fallback">当前环境不支持 WebGL，请切换到 2D 视图。</div>
  </div>
</template>

<script setup>
import { onActivated, onBeforeUnmount, onMounted, ref } from 'vue'
import { useOsWorld } from '../twin/world'
import { createTwinScene } from '../twin/scene/engine.js'

const { world } = useOsWorld()
const container = ref(null)
const failed = ref(false)
let engine = null

onMounted(() => {
  try {
    engine = createTwinScene(container.value)
    engine.mount(() => world.value)
    if (import.meta.env.DEV) {
      window.__twin = engine
      // 开发期可视化验证钩子：?dev=run 自动运行、?dev=deadlock 强制死锁
      const dev = new URLSearchParams(location.search).get('dev') || ''
      if (dev.includes('deadlock')) {
        import('../store/os').then(({ useOsStore }) => { useOsStore().resources.deadlock = true })
      }
      if (dev.includes('run')) {
        setTimeout(() => {
          const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '运行')
          if (b) b.click()
        }, 300)
      }
    }
  } catch (e) {
    console.warn('[Twin3D] 初始化失败，回退 2D：', e)
    failed.value = true
  }
})
onActivated(() => engine && engine.resize())
onBeforeUnmount(() => {
  if (engine) { engine.dispose(); engine = null }
})

// 供 DigitalTwin.vue 调用（视图切换 / 点击聚焦）
defineExpose({
  setView: (m) => engine && engine.setView(m),
  focusCore: (k) => engine && engine.focusCore(k),
})
</script>

<style scoped>
.twin3d {
  position: relative;
  width: 100%;
  height: 560px;
  border-radius: 12px;
  overflow: hidden;
  background: #05080f;
}
.twin3d-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #8a96a6;
}
</style>

<style>
/* CSS2D 浮动标签（暗色玻璃）—— 全局，因标签 DOM 在 Vue scoped 作用域之外 */
.twin3d-label {
  background: rgba(13, 20, 33, 0.82);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(127, 227, 207, 0.18);
  border-radius: 8px;
  padding: 6px 12px;
  font: 500 11px/1.4 "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
  color: #e8f0f5;
  white-space: nowrap;
  text-align: center;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
  transform: translateY(-6px);
}
.twin3d-label b {
  display: block;
  font-size: 13px;
  color: #ffffff;
  margin-bottom: 2px;
}
.twin3d-label span {
  display: block;
  font-size: 10px;
  color: #9fb6c5;
}
.twin3d-label.core {
  border-color: rgba(21, 169, 138, 0.4);
  box-shadow: 0 0 18px rgba(21, 169, 138, 0.25);
}
.twin3d-label.core b {
  color: #2fe0bf;
}
</style>
