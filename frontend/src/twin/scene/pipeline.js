import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

/**
 * 渲染管线：WebGLRenderer + ACES 影调 + 柔和阴影 + 程序化影棚环境贴图 + 克制 bloom 后期。
 *
 * 影调链：RenderPass 在线性空间渲染 → UnrealBloomPass 取高光溢出 → OutputPass 末端统一
 * 做色调映射(ACES)+sRGB 编码（这正是 OutputPass 存在的意义，避免重复 tone mapping）。
 *
 * 环境贴图用 RoomEnvironment + PMREMGenerator 程序化生成，不依赖任何外部 HDR 文件。
 * WebGL 创建失败时抛错，由 engine 捕获回退 2D。
 */
export function createPipeline(container, scene, camera, { width, height }) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    // 仅开发期保留绘制缓冲，便于离屏抓帧验证；生产关闭以免性能损耗
    preserveDrawingBuffer: import.meta.env.DEV,
  })
  renderer.setSize(width, height)
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  renderer.setPixelRatio(dpr)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  container.appendChild(renderer.domElement)

  // 程序化中性影棚环境贴图（无外部资源）
  const pmrem = new THREE.PMREMGenerator(renderer)
  const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environment = envTexture

  // 后期合成
  const composer = new EffectComposer(renderer)
  composer.setSize(width, height)
  composer.setPixelRatio(dpr)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.5, 0.5, 0.85)
  composer.addPass(bloom)
  composer.addPass(new OutputPass())

  function render() {
    composer.render()
  }
  function setSize(w, h) {
    renderer.setSize(w, h)
    composer.setSize(w, h)
    bloom.setSize(w, h)
  }
  function dispose() {
    pmrem.dispose()
    envTexture.dispose()
    composer.dispose()
    renderer.dispose()
    renderer.domElement?.remove()
  }

  return { renderer, composer, envTexture, bloom, render, setSize, dispose }
}
