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
    if (import.meta.env.DEV) window.__twin = engine
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
