import * as THREE from 'three'
import { makeLed } from '../materials.js'
import { makeLabel } from '../label.js'

/**
 * 中央调度内核：写实 SoC 主控芯片（基板 + 金属保持框 + 硅片 + 金色触点 + 发光缝 + 玻璃罩）。
 * 硅片与发光缝按 CPU 负载「呼吸」；玻璃罩吃环境反射，作为整场视觉锚点。
 * buildKernel(scene, materials) → { group, update(world,t), labelDiv }
 */
export function buildKernel(scene, materials) {
  const group = new THREE.Group()
  scene.add(group)

  // 基板
  const sub = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.22, 3.0), materials.pcbDark)
  sub.position.y = 0.11
  sub.castShadow = true
  sub.receiveShadow = true
  group.add(sub)

  // 金属保持框（四条铝条）
  const fy = 0.26
  for (const [bx, bz] of [[0, 1.45], [0, -1.45]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.16, 0.16), materials.aluminum)
    b.position.set(bx, fy, bz)
    b.castShadow = true
    group.add(b)
  }
  for (const [bx, bz] of [[1.45, 0], [-1.45, 0]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 3.0), materials.aluminum)
    b.position.set(bx, fy, bz)
    b.castShadow = true
    group.add(b)
  }

  // 金色触点边
  const goldEdge = new THREE.Mesh(new THREE.BoxGeometry(2.32, 0.06, 2.32), materials.gold)
  goldEdge.position.y = 0.24
  group.add(goldEdge)

  // 发光缝（bloom 源，呼吸）
  const seamMat = makeLed(0x15a98a, 1.2)
  const seam = new THREE.Mesh(new THREE.BoxGeometry(2.18, 0.05, 2.18), seamMat)
  seam.position.y = 0.235
  group.add(seam)

  // 硅片（独立材质，呼吸青绿自发光）
  const dieMat = materials.silicon.clone()
  dieMat.emissive = new THREE.Color(0x15a98a)
  dieMat.emissiveIntensity = 0.4
  const die = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.12, 2.1), dieMat)
  die.position.y = 0.3
  die.castShadow = true
  group.add(die)

  // 玻璃罩
  const cover = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.42, 2.5), materials.glass)
  cover.position.y = 0.52
  group.add(cover)

  // 浮动标签
  const { obj, div } = makeLabel('core')
  obj.position.set(0, 2.4, 0)
  group.add(obj)

  function update(world, t) {
    const util = world ? world.cpuUtil : 0
    const running = world ? world.running : false
    const freq = 1.0 + util / 55
    const pulse = running ? 0.5 + 0.5 * Math.abs(Math.sin(t * freq)) : 0.2
    dieMat.emissiveIntensity = 0.3 + 0.8 * pulse
    seamMat.emissiveIntensity = 0.6 + 1.6 * pulse
    div.innerHTML = `<b>系统调度核心</b><span>CPU ${util}% · 时钟 T${world ? world.clock : 0}</span>`
  }

  return { group, update, labelDiv: div }
}
