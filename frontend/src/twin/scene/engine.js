import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { createPipeline } from './pipeline.js'
import { createMaterials, disposeMaterials } from './materials.js'
import { buildStage } from './stage.js'
import { buildKernel } from './cores/kernel.js'
import { CORE_POS } from './layout.js'
import { buildProcessor } from './cores/processor.js'
import { buildMemory } from './cores/memory.js'
import { buildDevice } from './cores/device.js'
import { buildResource } from './cores/resource.js'

const VIEW_H = 560

const CORE_BUILDERS = {
  processor: buildProcessor,
  memory: buildMemory,
  resource: buildResource,
  device: buildDevice,
}

/**
 * 数字孪生 3D 引擎编排器（渲染无关接缝的「3D 渲染器」实现）。
 *
 * 对外接口：
 *   mount(getWorld)  getWorld: () => world.value，内部 RAF 每帧读取最新快照（唯一数据入口）
 *   resize()
 *   setView('3d'|'2d')   切 2d 暂停渲染循环
 *   focusCore(key|null)  相机平滑聚焦 / 复位（Phase 4 接入）
 *   dispose()            释放渲染器/几何/材质/贴图/监听，防 WebGL 上下文泄漏
 *
 * 建模逐阶段接入：Phase2 stage+kernel / Phase3 四核心 / Phase4 interactions。
 */
export function createTwinScene(container) {
  const width = container.clientWidth || 960
  const height = VIEW_H

  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(0x05080f, 0.012)

  const camera = new THREE.PerspectiveCamera(46, width / height, 0.1, 1000)
  camera.position.set(0, 14, 22)

  // WebGL 管线（失败抛错 → 由 Twin3D.vue 回退 2D）
  const pipeline = createPipeline(container, scene, camera, { width, height })

  const materials = createMaterials()
  setupLights(scene)

  // CSS2D 标签渲染器（覆盖在 canvas 上，pointerEvents:none 不挡交互）
  const labelRenderer = new CSS2DRenderer()
  labelRenderer.setSize(width, height)
  Object.assign(labelRenderer.domElement.style, {
    position: 'absolute', top: '0', left: '0', pointerEvents: 'none',
  })
  container.appendChild(labelRenderer.domElement)

  const controls = new OrbitControls(camera, pipeline.renderer.domElement)
  controls.target.set(0, 0.8, 0)
  controls.enableDamping = true
  controls.dampingFactor = 0.06
  controls.maxPolarAngle = Math.PI / 2.1
  controls.minDistance = 10
  controls.maxDistance = 40

  // —— 每帧更新器集合：建模模块各自 push 一个 (world, t, dt) => void ——
  const updaters = []
  const cores = {}

  buildContents()

  // —— 渲染循环（手动计时，避免已废弃的 THREE.Clock）——
  let raf = null
  let running = false
  let getWorldFn = () => null
  let lastT = 0
  let elapsed = 0

  function loop() {
    raf = requestAnimationFrame(loop)
    const now = performance.now()
    const dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 0.016
    lastT = now
    elapsed += dt
    const world = getWorldFn()
    for (let i = 0; i < updaters.length; i++) updaters[i](world, elapsed, dt)
    controls.update()
    pipeline.render()
    labelRenderer.render(scene, camera)
  }
  function start() {
    if (running) return
    running = true
    lastT = 0
    loop()
  }
  function stop() {
    if (!running) return
    running = false
    cancelAnimationFrame(raf)
    raf = null
  }

  // —— 建模内容（逐阶段扩展） ——
  function buildContents() {
    const stage = buildStage(scene, materials)
    updaters.push(stage.update)

    const kernel = buildKernel(scene, materials)
    updaters.push(kernel.update)

    for (const key in CORE_BUILDERS) {
      const inst = CORE_BUILDERS[key]({ scene, materials, position: CORE_POS[key] })
      cores[key] = inst
      updaters.push((world, t, dt) => {
        const cs = world ? world.cores.find((c) => c.key === key) : null
        inst.update(cs, t, dt)
      })
    }
  }

  // —— 对外接口 ——
  function mount(getWorld) {
    getWorldFn = typeof getWorld === 'function' ? getWorld : () => null
    start()
  }
  function setView(mode) {
    if (mode === '2d') stop()
    else start()
  }
  function resize() {
    const w = container.clientWidth || width
    camera.aspect = w / height
    camera.updateProjectionMatrix()
    pipeline.setSize(w, height)
    labelRenderer.setSize(w, height)
  }
  function focusCore() {
    // Phase 4：interactions 接入相机补间
  }

  function onVisibility() {
    if (document.hidden) stop()
    else start()
  }
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('resize', resize)

  function disposeMaterial(m) {
    for (const key in m) {
      const v = m[key]
      if (v && v.isTexture) v.dispose()
    }
    m.dispose && m.dispose()
  }
  function dispose() {
    stop()
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('resize', resize)
    controls.dispose()
    scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose()
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(disposeMaterial)
        else disposeMaterial(obj.material)
      }
    })
    disposeMaterials(materials)
    pipeline.dispose()
    labelRenderer.domElement?.remove()
  }

  // 开发期离屏抓帧：渲染一帧并返回降采样 JPEG dataURL（绕开失效的截图工具做视觉验证）
  function snapshot(maxW = 760, quality = 0.72) {
    pipeline.render()
    labelRenderer.render(scene, camera)
    const src = pipeline.renderer.domElement
    const scale = Math.min(1, maxW / src.width)
    const w = Math.round(src.width * scale)
    const h = Math.round(src.height * scale)
    const off = document.createElement('canvas')
    off.width = w
    off.height = h
    const ctx = off.getContext('2d')
    ctx.drawImage(src, 0, 0, w, h)
    return off.toDataURL('image/jpeg', quality)
  }

  function debug() {
    const info = pipeline.renderer.info
    return {
      running,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      sceneChildren: scene.children.length,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      pixelRatio: pipeline.renderer.getPixelRatio(),
      camera: camera.position.toArray().map((n) => Math.round(n * 10) / 10),
    }
  }

  return { mount, resize, setView, focusCore, dispose, debug, snapshot }
}

function setupLights(scene) {
  // 环境基底（偏冷蓝，营造电子空间）
  scene.add(new THREE.AmbientLight(0x1a2230, 0.6))

  // 主光（带阴影）—— 接触阴影是立体感来源
  const key = new THREE.DirectionalLight(0xffffff, 1.4)
  key.position.set(12, 22, 12)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.camera.near = 1
  key.shadow.camera.far = 90
  key.shadow.camera.left = -22
  key.shadow.camera.right = 22
  key.shadow.camera.top = 22
  key.shadow.camera.bottom = -22
  key.shadow.bias = -0.0005
  scene.add(key)

  // 冷调补光（勾勒金属边缘）
  const fill = new THREE.DirectionalLight(0x88aaff, 0.4)
  fill.position.set(-12, 8, -10)
  scene.add(fill)

  // 内核点光（青绿，呼应品牌色）
  const coreGlow = new THREE.PointLight(0x15a98a, 1.2, 24)
  coreGlow.position.set(0, 2.2, 0)
  scene.add(coreGlow)
}
