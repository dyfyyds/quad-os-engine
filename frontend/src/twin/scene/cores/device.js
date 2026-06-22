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

  // 机框四角安装螺丝
  for (const [sx, sz] of [[-1.9, -2.4], [1.9, -2.4], [-1.9, 2.4], [1.9, 2.4]]) {
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.06, 8), materials.chrome)
    screw.position.set(sx, 0.42, sz)
    group.add(screw)
    // 十字槽刻痕（暗色十字）
    const slot1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.005, 0.014), materials.aluminumDark)
    slot1.position.set(sx, 0.45, sz)
    group.add(slot1)
    const slot2 = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.005, 0.1), materials.aluminumDark)
    slot2.position.set(sx, 0.45, sz)
    group.add(slot2)
  }

  // 底部 PCB 控制板（机框下方露出薄薄一片，深色 PCB + 4 颗控制器芯片）
  const ctrlPcb = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.04, 4.6), materials.pcbDark)
  ctrlPcb.position.y = -0.02
  ctrlPcb.castShadow = true
  group.add(ctrlPcb)
  for (const [cx, cz] of [[-1.2, -1.6], [0.6, -1.4], [-0.4, 1.6], [1.2, 1.6]]) {
    const chip = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.42), materials.silicon)
    chip.position.set(cx, 0.005, cz)
    group.add(chip)
  }

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

  // 顶部盘片中心标签贴纸（圆形纸质标，仿真硬盘"型号 / 容量"丝印）
  const labelPad = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.005, 32), materials.labelPaper)
  labelPad.position.set(-0.4, 0.755, -0.4)
  group.add(labelPad)
  const labelRing = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.55, 32), materials.aluminumDark)
  labelRing.rotation.x = -Math.PI / 2
  labelRing.position.set(-0.4, 0.758, -0.4)
  group.add(labelRing)
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

  // 磁头柔性扁排线（从作动臂铰链拖到 SATA 接口一侧，仿真 HDD flex cable）
  const flexCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(1.4, 0.72, 1.4),    // 起点：作动臂铰链顶
    new THREE.Vector3(1.6, 0.82, 1.7),    // 弧顶
    new THREE.Vector3(1.85, 0.55, 1.85),  // 终点：SATA 板边
  ])
  const flexTube = new THREE.Mesh(
    new THREE.TubeGeometry(flexCurve, 18, 0.04, 6, false),
    materials.gold,  // 金色铜箔排线
  )
  group.add(flexTube)
  // 排线扁平外覆（薄盒）
  const flexCover = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.02, 0.6), materials.blackPlastic)
  flexCover.position.set(1.72, 0.72, 1.65)
  flexCover.rotation.y = -0.7
  group.add(flexCover)

  // SATA 接口
  const sata = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.25, 1.2), materials.blackPlastic)
  sata.position.set(2.05, 0.3, 1.8)
  group.add(sata)
  // SATA 7-pin 金色排针
  for (let i = 0; i < 7; i++) {
    const pin = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.12), materials.gold)
    pin.position.set(2.05, 0.37, 1.3 + i * 0.16)
    group.add(pin)
  }

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
