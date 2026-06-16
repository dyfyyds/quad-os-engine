<template>
  <div ref="container" class="twin3d">
    <div v-if="failed" class="twin3d-fallback">当前环境不支持 WebGL，请切换到 2D 视图。</div>
  </div>
</template>

<script setup>
import { onActivated, onBeforeUnmount, onMounted, ref } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import { useOsWorld } from '../twin/world'

const { world } = useOsWorld()
const container = ref(null)
const failed = ref(false)

let renderer, labelRenderer, scene, camera, controls, raf, centerMesh
const towers = {}
const POS = { processor: [-7, -7], memory: [7, -7], resource: [-7, 7], device: [7, 7] }

onMounted(init)
onActivated(onResize)
onBeforeUnmount(cleanup)

function makeLabel(key) {
  const div = document.createElement('div')
  div.className = 'twin3d-label'
  const obj = new CSS2DObject(div)
  return { obj, div }
}

function buildTower(c) {
  const color = new THREE.Color(c.color)
  const geo = new THREE.BoxGeometry(2.4, 1, 2.4)
  const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.15, metalness: 0.25, roughness: 0.5, transparent: true, opacity: 0.92 })
  const mesh = new THREE.Mesh(geo, mat)
  const [x, z] = POS[c.key]
  mesh.position.set(x, 0.5, z)
  scene.add(mesh)

  const edgeMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.5 })
  const edgeGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 2, 0), new THREE.Vector3(x, 1.5, z)])
  const edge = new THREE.Line(edgeGeo, edgeMat)
  scene.add(edge)

  const particle = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 12), new THREE.MeshBasicMaterial({ color }))
  particle.visible = false
  scene.add(particle)

  const { obj, div } = makeLabel(c.key)
  obj.position.set(x, 3.5, z)
  scene.add(obj)

  towers[c.key] = { mesh, edge, particle, label: div, color, h: 1, t: Math.random() }
}

function init() {
  const el = container.value
  const w = el.clientWidth || 800
  const h = el.clientHeight || 460
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 1000)
  camera.position.set(0, 15, 22)

  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  } catch (e) {
    failed.value = true
    return
  }
  renderer.setSize(w, h)
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
  el.appendChild(renderer.domElement)

  labelRenderer = new CSS2DRenderer()
  labelRenderer.setSize(w, h)
  Object.assign(labelRenderer.domElement.style, { position: 'absolute', top: '0', left: '0', pointerEvents: 'none' })
  el.appendChild(labelRenderer.domElement)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.target.set(0, 2, 0)
  controls.enableDamping = true
  controls.maxPolarAngle = Math.PI / 2.15
  controls.minDistance = 12
  controls.maxDistance = 46

  scene.add(new THREE.AmbientLight(0xffffff, 0.85))
  const dir = new THREE.DirectionalLight(0xffffff, 0.75)
  dir.position.set(12, 20, 8)
  scene.add(dir)

  scene.add(new THREE.GridHelper(44, 22, 0x9fb6c5, 0xdde6ed))
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(44, 44), new THREE.MeshStandardMaterial({ color: 0xf1f6f9, transparent: true, opacity: 0.55 }))
  plane.rotation.x = -Math.PI / 2
  plane.position.y = -0.02
  scene.add(plane)

  centerMesh = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.7, 0),
    new THREE.MeshStandardMaterial({ color: 0x0f3b34, emissive: 0x15a98a, emissiveIntensity: 0.6, metalness: 0.4, roughness: 0.35 }),
  )
  centerMesh.position.y = 2
  scene.add(centerMesh)
  const coreLabel = makeLabel('core')
  coreLabel.div.classList.add('core')
  coreLabel.obj.position.set(0, 4.6, 0)
  scene.add(coreLabel.obj)
  centerMesh.userData.label = coreLabel.div

  world.value.cores.forEach(buildTower)
  window.addEventListener('resize', onResize)
  animate()
}

function animate() {
  raf = requestAnimationFrame(animate)
  const wv = world.value
  centerMesh.rotation.y += 0.012
  centerMesh.rotation.x += 0.005
  const cm = centerMesh.material
  cm.emissiveIntensity = 0.45 + (wv.running ? 0.3 * Math.abs(Math.sin(Date.now() / 350)) : 0)
  if (centerMesh.userData.label) {
    centerMesh.userData.label.innerHTML = `<b>调度内核</b><span>CPU ${wv.cpuUtil}% · T${wv.clock}</span>`
  }

  wv.cores.forEach((c) => {
    const tw = towers[c.key]
    if (!tw) return
    const target = 0.9 + c.bar * 6.5
    tw.h += (target - tw.h) * 0.12
    tw.mesh.scale.y = tw.h
    tw.mesh.position.y = tw.h / 2
    tw.mesh.material.emissiveIntensity = c.active ? 0.35 + 0.3 * Math.abs(Math.sin(Date.now() / 300)) : 0.12
    tw.label.innerHTML = `<b style="color:${c.color}">${c.title}</b><span>${c.metric} · ${c.sub}</span>`

    const [x, z] = POS[c.key]
    tw.particle.visible = c.active
    if (c.active) {
      tw.t = (tw.t + 0.018) % 1
      tw.particle.position.set(THREE.MathUtils.lerp(0, x, tw.t), THREE.MathUtils.lerp(2, tw.h, tw.t), THREE.MathUtils.lerp(0, z, tw.t))
    }
  })

  controls.update()
  renderer.render(scene, camera)
  labelRenderer.render(scene, camera)
}

function onResize() {
  if (!renderer || !container.value) return
  const w = container.value.clientWidth
  const h = container.value.clientHeight || 460
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  renderer.setSize(w, h)
  labelRenderer.setSize(w, h)
}

function cleanup() {
  cancelAnimationFrame(raf)
  window.removeEventListener('resize', onResize)
  if (renderer) { renderer.dispose(); renderer.domElement?.remove() }
  if (labelRenderer) labelRenderer.domElement?.remove()
  scene = null
}
</script>

<style scoped>
.twin3d { position: relative; width: 100%; height: 460px; border-radius: 8px; overflow: hidden; background: linear-gradient(180deg, #f7fafc 0%, #eef3f7 100%); }
.twin3d-fallback { display: flex; align-items: center; justify-content: center; height: 100%; color: #8a96a6; }
</style>

<style>
.twin3d-label { background: rgba(255, 255, 255, 0.94); border: 1px solid #e3eaf0; border-radius: 7px; padding: 5px 9px; font-size: 12px; line-height: 1.4; box-shadow: 0 2px 6px rgba(18, 38, 63, 0.1); white-space: nowrap; text-align: center; }
.twin3d-label b { display: block; font-size: 13px; }
.twin3d-label span { color: #8a96a6; font-size: 11px; }
.twin3d-label.core { background: #0f3b34; }
.twin3d-label.core b { color: #fff; }
.twin3d-label.core span { color: #7fe3cf; }
</style>
