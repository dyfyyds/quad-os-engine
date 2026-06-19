import * as THREE from 'three'
import { makeLabel } from '../label.js'
import { makeLed } from '../materials.js'
import { makeStatusLed, ease } from './_common.js'

/**
 * 设备核心：写实机械硬盘（铝机框 + 高反射盘片 + 主轴 + 作动臂 + 磁头滑块 + SATA 口）。
 * active 时盘片高速旋转；磁头臂按柱面位置(cs.bar)平滑寻道；读写指示灯闪烁。
 */
export function buildDevice({ scene, materials, position }) {
  const group = new THREE.Group()
  group.position.set(position[0], 0, position[1])
  scene.add(group)

  // 铝合金机框 + 深色内腔
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.4, 5.0), materials.aluminumDark)
  chassis.position.y = 0.2
  chassis.castShadow = true
  chassis.receiveShadow = true
  group.add(chassis)
  const cavity = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.12, 4.6), materials.blackPlastic)
  cavity.position.y = 0.41
  group.add(cavity)

  // 主轴 + 高反射盘片
  const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.5, 20), materials.chrome)
  spindle.position.set(-0.4, 0.62, -0.4)
  group.add(spindle)
  const platters = []
  for (const py of [0.5, 0.72]) {
    const plat = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 0.04, 64), materials.chrome)
    plat.position.set(-0.4, py, -0.4)
    plat.castShadow = true
    group.add(plat)
    platters.push(plat)
  }
  // 主轴压盖螺栓
  for (let i = 0; i < 3; i++) {
    const a = i * 2.094
    const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 8), materials.aluminum)
    bolt.position.set(-0.4 + Math.cos(a) * 0.18, 0.86, -0.4 + Math.sin(a) * 0.18)
    group.add(bolt)
  }

  // 磁头作动臂（可旋转）
  const arm = new THREE.Group()
  arm.position.set(1.4, 0.75, 1.4)
  group.add(arm)
  const bearing = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.4, 16), materials.aluminumDark)
  bearing.position.y = -0.05
  arm.add(bearing)
  const armBar = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 1.9), materials.aluminum)
  armBar.position.set(0, 0, -0.95)
  armBar.castShadow = true
  arm.add(armBar)
  const slider = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.2), materials.blackPlastic)
  slider.position.set(0, -0.02, -1.85)
  arm.add(slider)
  const rwMat = makeLed(0xf0a020, 1.0)
  const rwLed = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 10), rwMat)
  rwLed.position.set(0, 0.04, -1.85)
  arm.add(rwLed)

  // SATA 接口
  const sata = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.25, 1.2), materials.blackPlastic)
  sata.position.set(2.05, 0.3, 1.8)
  group.add(sata)

  const led = makeStatusLed(0xf0a020)
  led.mesh.position.set(1.9, 0.45, -2.2)
  group.add(led.mesh)
  const { obj, div } = makeLabel('device')
  obj.position.set(0, 2.3, 0)
  group.add(obj)

  function update(cs, t, dt) {
    if (!cs) return
    group.position.y = ease(group.position.y, cs.active ? 0.16 : 0, dt)
    const spin = cs.active ? 0.35 : 0.03
    for (const p of platters) p.rotation.y += spin
    const targetAngle = -0.15 - (cs.bar || 0) * 0.7
    arm.rotation.y += (targetAngle - arm.rotation.y) * Math.min(1, dt * 4)
    rwMat.emissiveIntensity = cs.active ? 0.4 + 1.4 * Math.abs(Math.sin(t * 9)) : 0.2
    led.mat.emissiveIntensity = ease(led.mat.emissiveIntensity, cs.active ? 2.4 : 0.35, dt, 6)
    div.innerHTML = `<b style="color:${cs.color}">${cs.title}</b><span>${cs.metric}</span><span>${cs.sub}</span>`
  }

  return { group, update, focusOffset: new THREE.Vector3(0, 1.0, 0) }
}
