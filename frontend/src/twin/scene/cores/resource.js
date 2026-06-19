import * as THREE from 'three'
import { makeLabel } from '../label.js'
import { makeLed } from '../materials.js'
import { makeStatusLed, ease } from './_common.js'

// 在两点之间生成一段圆柱（能量连线）
function connect(a, b, mat, radius) {
  const dir = new THREE.Vector3().subVectors(b, a)
  const len = dir.length()
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 8), mat)
  mesh.position.copy(a).addScaledVector(dir, 0.5)
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize())
  return mesh
}

/**
 * 资源核心（综合方案）：写实 VRM 供电硬件作底（电感阵列 + 固态电容 + 芯片组散热块）
 * + 资源模块能量连线层。安全态青紫能量环流；死锁态三节点连成红色闭环（循环等待）+ 散热块边缘转红。
 */
export function buildResource({ scene, materials, position }) {
  const group = new THREE.Group()
  group.position.set(position[0], 0, position[1])
  scene.add(group)

  // VRM 区 PCB 底
  const baseP = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.2, 3.6), materials.pcbDark)
  baseP.position.y = 0.1
  baseP.receiveShadow = true
  group.add(baseP)

  // 芯片组散热块 + 鳍片（边缘死锁转红）
  const heatsink = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 1.8), materials.aluminum)
  heatsink.position.set(-1.0, 0.45, -0.9)
  heatsink.castShadow = true
  group.add(heatsink)
  for (let i = 0; i < 5; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.18, 0.12), materials.aluminum)
    fin.position.set(-1.0, 0.78, -1.5 + i * 0.3)
    fin.castShadow = true
    group.add(fin)
  }
  const edgeMat = makeLed(0x8b5cf6, 0.3)
  const edge = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.06, 1.86), edgeMat)
  edge.position.set(-1.0, 0.2, -0.9)
  group.add(edge)

  // 电感阵列
  for (let i = 0; i < 4; i++) {
    const x = 0.6 + (i % 2) * 0.7
    const z = -1.4 + Math.floor(i / 2) * 0.7
    const ind = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.42, 0.5), materials.blackPlastic)
    ind.position.set(x, 0.31, z)
    ind.castShadow = true
    group.add(ind)
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.04, 0.12), materials.aluminum)
    top.position.set(x, 0.53, z)
    group.add(top)
  }

  // 固态电容
  for (let i = 0; i < 6; i++) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.5, 16), materials.aluminum)
    cap.position.set(0.4 + (i % 3) * 0.55, 0.35, 0.7 + Math.floor(i / 3) * 0.55)
    cap.castShadow = true
    group.add(cap)
  }

  // 资源模块节点 + 能量连线（三节点三连线 = 可成环）
  const nodeMats = []
  const linkMats = []
  const R = 1.0
  const Y = 1.5
  const nodePos = []
  for (let i = 0; i < 3; i++) {
    const a = Math.PI / 2 + i * 2.094
    nodePos.push(new THREE.Vector3(Math.cos(a) * R, Y, Math.sin(a) * R - 0.2))
  }
  nodePos.forEach((p) => {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, p.y - 0.2, 8), materials.aluminumDark)
    post.position.set(p.x, p.y / 2 + 0.1, p.z)
    group.add(post)
    const m = makeLed(0x8b5cf6, 0.8)
    const node = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), m)
    node.position.copy(p)
    group.add(node)
    nodeMats.push(m)
  })
  for (let i = 0; i < 3; i++) {
    const m = makeLed(0x8b5cf6, 0.6)
    group.add(connect(nodePos[i], nodePos[(i + 1) % 3], m, 0.035))
    linkMats.push(m)
  }

  const led = makeStatusLed(0x8b5cf6)
  led.mesh.position.set(1.9, 0.4, 1.6)
  group.add(led.mesh)
  const { obj, div } = makeLabel('resource')
  obj.position.set(0, 2.7, 0)
  group.add(obj)

  const scratch = new THREE.Color()
  function update(cs, t, dt) {
    if (!cs) return
    group.position.y = ease(group.position.y, cs.active ? 0.12 : 0, dt)
    const deadlock = cs.metric === '死锁'
    scratch.set(cs.color) // 紫=安全，红=死锁（world.js 已给出颜色）
    const pulse = deadlock ? 0.5 + 0.5 * Math.abs(Math.sin(t * 6)) : 0.5 + 0.5 * Math.abs(Math.sin(t * 1.5))
    for (const m of linkMats) {
      m.emissive.copy(scratch)
      m.emissiveIntensity = (deadlock ? 1.6 : 0.5) * (0.6 + 0.6 * pulse)
    }
    for (const m of nodeMats) {
      m.emissive.copy(scratch)
      m.emissiveIntensity = (deadlock ? 1.4 : 0.7) * (0.6 + 0.6 * pulse)
    }
    edgeMat.emissive.copy(scratch)
    edgeMat.emissiveIntensity = deadlock ? 1.0 + 1.0 * pulse : 0.15
    led.mat.emissive.copy(scratch)
    led.mat.emissiveIntensity = ease(led.mat.emissiveIntensity, cs.active ? 2.4 : 0.4, dt, 6)
    div.innerHTML = `<b style="color:${cs.color}">${cs.title}</b><span>${cs.metric}</span><span>${cs.sub}</span>`
  }

  return { group, update, focusOffset: new THREE.Vector3(0, 1.2, 0) }
}
