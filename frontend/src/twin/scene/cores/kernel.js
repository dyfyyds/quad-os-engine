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

  // SoC IHS 顶盖（金属铭板，仿真 SoC 出厂封装的银色铝顶盖）
  const ihs = new THREE.Mesh(new THREE.BoxGeometry(2.18, 0.06, 2.18), materials.bridgeIHS)
  ihs.position.y = 0.38
  ihs.castShadow = true
  group.add(ihs)
  // IHS 倒角描边（黑色细环，让顶盖与硅片分层清晰）
  const ihsBevel = new THREE.Mesh(new THREE.BoxGeometry(2.22, 0.01, 2.22), materials.aluminumDark)
  ihsBevel.position.y = 0.353
  group.add(ihsBevel)
  // 顶盖中心刻印（深色嵌入 QUAD-OS 占位铭文：用 0.04 高的暗块矩阵模拟激光雕刻）
  const ihsLogoMat = new THREE.MeshPhysicalMaterial({ color: 0x4a525c, roughness: 0.7, metalness: 0.6 })
  for (const [lx, lz, lw, ld] of [
    [0, 0, 1.4, 0.18],          // 上排横长方形
    [-0.55, 0.32, 0.3, 0.16],   // 左下
    [0.55, 0.32, 0.3, 0.16],    // 右下
    [0, -0.32, 0.8, 0.14],      // 底部"QUAD-OS"占位条
  ]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(lw, 0.005, ld), ihsLogoMat)
    m.position.set(lx, 0.412, lz)
    group.add(m)
  }
  // 四角焊接小点（金色，仿真 IHS 与基板焊死的角点）
  for (const [cx, cz] of [[-1.05, -1.05], [1.05, -1.05], [-1.05, 1.05], [1.05, 1.05]]) {
    const dot = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.04, 8), materials.gold)
    dot.position.set(cx, 0.392, cz)
    group.add(dot)
  }

  // 玻璃罩（提高到 IHS 之上）
  const cover = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.34, 2.5), materials.glass)
  cover.position.y = 0.58
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
