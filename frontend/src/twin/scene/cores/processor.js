import * as THREE from 'three'
import { makeLabel } from '../label.js'
import { makeLed } from '../materials.js'
import { makeStatusLed, ease } from './_common.js'

/**
 * 处理机核心：CPU 插座 + 塔式散热器（铜底 + 热管 + 密集铝鳍片 + 旋转风扇）。
 * 风扇转速随 CPU 负载；active 时整体微抬升、状态灯点亮。
 */
export function buildProcessor({ scene, materials, position }) {
  const group = new THREE.Group()
  group.position.set(position[0], 0, position[1])
  scene.add(group)

  // CPU 插座底座
  const socket = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.2, 3.2), materials.blackPlastic)
  socket.position.y = 0.1
  socket.receiveShadow = true
  group.add(socket)

  // LGA 焊盘阵列（顶面细密金色圆点，可见 CPU 安装感）
  const padCount = 16
  const padGap = 2.4 / padCount
  for (let i = 0; i < padCount; i++) {
    for (let j = 0; j < padCount; j++) {
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.012, 6), materials.gold)
      pad.position.set(-1.2 + padGap / 2 + i * padGap, 0.207, -1.2 + padGap / 2 + j * padGap)
      group.add(pad)
    }
  }

  // 金属保持框
  for (const [bx, bz, w, d] of [[0, 1.5, 3.2, 0.16], [0, -1.5, 3.2, 0.16], [1.5, 0, 0.16, 3.2], [-1.5, 0, 0.16, 3.2]]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, 0.14, d), materials.aluminum)
    bar.position.set(bx, 0.22, bz)
    bar.castShadow = true
    group.add(bar)
  }

  // 保持框扳手（铰链 + L 形扳臂 + 锁勾） —— 仿 LGA1700 retention arm
  const lever = new THREE.Group()
  lever.position.set(1.6, 0.22, 1.6)
  group.add(lever)
  const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.18, 10), materials.aluminumDark)
  hinge.rotation.x = Math.PI / 2
  lever.add(hinge)
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 1.3), materials.aluminum)
  arm.position.set(0, 0, -0.65)
  lever.add(arm)
  const hook = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.06, 0.18), materials.aluminumDark)
  hook.position.set(0, 0, -1.32)
  lever.add(hook)

  // CPU IHS（顶盖 / 集成散热片）—— 写实的银色铭板，安装在 socket 顶面之上、散热器底下
  const ihs = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.08, 2.0), materials.bridgeIHS)
  ihs.position.y = 0.26
  ihs.castShadow = true
  group.add(ihs)
  // IHS 倒角描边（视觉上区分上下两个金属层）
  const ihsEdge = new THREE.Mesh(new THREE.BoxGeometry(2.06, 0.018, 2.06), materials.aluminumDark)
  ihsEdge.position.y = 0.22
  group.add(ihsEdge)
  // IHS 表面薄薄一层硅脂（轻微反射，颜色暖白）
  const tim = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 0.006, 1.7),
    new THREE.MeshPhysicalMaterial({ color: 0xd0c8b8, roughness: 0.6, metalness: 0.05, opacity: 0.85, transparent: true }),
  )
  tim.position.y = 0.301
  group.add(tim)

  // 散热器铜底（轻微抬高以让 TIM 可见）
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.16, 1.7), materials.copper)
  base.position.y = 0.38
  base.castShadow = true
  group.add(base)

  // 纯铜热管（四根竖管）
  for (const [hx, hz] of [[-0.55, -0.5], [0.55, -0.5], [-0.55, 0.5], [0.55, 0.5]]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.0, 12), materials.copper)
    pipe.position.set(hx, 1.4, hz)
    pipe.castShadow = true
    group.add(pipe)
  }

  // 密集铝合金鳍片阵列
  for (let i = 0; i < 16; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.015, 1.6), materials.aluminum)
    fin.position.y = 0.95 + i * 0.1
    fin.castShadow = true
    group.add(fin)
  }

  // 前置风扇（壳 + 轮毂 + 旋转扇叶）
  const fan = new THREE.Group()
  fan.position.set(0, 1.5, 1.06)
  group.add(fan)

  const shroud = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.09, 10, 28), materials.blackPlastic)
  fan.add(shroud)

  // 外圈 RGB 光环（diffuser + 自发光内圈）—— 风扇活跃时呼吸
  const rgbRingMat = makeLed(0x15a98a, 0.6)
  const rgbRing = new THREE.Mesh(new THREE.TorusGeometry(0.94, 0.045, 12, 48), rgbRingMat)
  fan.add(rgbRing)
  const rgbCover = new THREE.Mesh(new THREE.TorusGeometry(0.94, 0.06, 12, 48), materials.diffuser)
  fan.add(rgbCover)

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.18, 16), materials.blackPlastic)
  hub.rotation.x = Math.PI / 2
  fan.add(hub)
  // Hub 中心金属圆心
  const hubCap = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.04, 16), materials.chrome)
  hubCap.rotation.x = Math.PI / 2
  hubCap.position.z = 0.1
  fan.add(hubCap)

  const blades = new THREE.Group()
  fan.add(blades)
  for (let i = 0; i < 7; i++) {
    const a = (i * Math.PI * 2) / 7
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.012, 0.34), materials.aluminumDark)
    blade.position.set(Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0)
    blade.rotation.z = a
    blade.rotation.x = 0.5
    blades.add(blade)
  }

  // 状态灯 + 标签
  const led = makeStatusLed(0x15a98a)
  led.mesh.position.set(1.35, 0.3, 1.35)
  group.add(led.mesh)

  const { obj, div } = makeLabel('processor')
  obj.position.set(0, 3.05, 0)
  group.add(obj)

  const scratch = new THREE.Color()
  function update(cs, t, dt) {
    if (!cs) return
    group.position.y = ease(group.position.y, cs.active ? 0.16 : 0, dt)
    const load = cs.bar || 0
    blades.rotation.z += (0.04 + load * 0.55) * (cs.active ? 1 : 0.4)
    led.mat.emissiveIntensity = ease(led.mat.emissiveIntensity, cs.active ? 2.4 : 0.35, dt, 6)
    // RGB 环：活跃时随 CPU 利用率呼吸；闲置时暗弱常亮
    scratch.set(cs.color)
    rgbRingMat.emissive.copy(scratch)
    rgbRingMat.emissiveIntensity = cs.active
      ? 0.6 + 0.7 * Math.abs(Math.sin(t * 1.5 + load * 2))
      : 0.18
    div.innerHTML = `<b style="color:${cs.color}">${cs.title}</b><span>${cs.metric}</span><span>${cs.sub}</span>`
  }

  return { group, update, focusOffset: new THREE.Vector3(0, 1.4, 0) }
}
