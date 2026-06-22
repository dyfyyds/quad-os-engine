import * as THREE from 'three'
import { makeLed } from '../materials.js'
import { makeLabel } from '../label.js'
import { makeStatusLed, ease } from './_common.js'

/**
 * 存储核心：两条写实 DDR DIMM（PCB + 金手指 + 防呆缺口 + 铝合金马甲 + 顶部 RGB 导光条）。
 * 数据颗粒沿内存条上升（虚拟页面流）；RGB 导光条与状态灯随活跃呼吸。
 */
export function buildMemory({ scene, materials, position }) {
  const group = new THREE.Group()
  group.position.set(position[0], 0, position[1])
  scene.add(group)

  // 内存插槽底座
  const slot = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.22, 1.1), materials.blackPlastic)
  slot.position.y = 0.11
  slot.receiveShadow = true
  group.add(slot)

  // 插槽两端的固定卡扣（白色塑料 latch）
  for (const sx of [-2.05, 2.05]) {
    for (const sz of [-0.4, 0.4]) {
      const latch = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.4, 0.18), materials.diffuser)
      latch.position.set(sx, 0.32, sz)
      latch.castShadow = true
      group.add(latch)
      // 卡扣顶部锁勾
      const hook = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.1), materials.diffuser)
      hook.position.set(sx, 0.55, sz)
      group.add(hook)
    }
  }

  const rgbBars = []
  const flow = []
  for (const sz of [-0.28, 0.28]) {
    const stick = new THREE.Group()
    stick.position.set(0, 0, sz)
    group.add(stick)

    // 金手指
    const finger = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.2, 0.08), materials.gold)
    finger.position.y = 0.3
    stick.add(finger)

    // PCB 板
    const pcb = new THREE.Mesh(new THREE.BoxGeometry(3.8, 1.3, 0.1), materials.pcbGreen)
    pcb.position.y = 1.0
    pcb.castShadow = true
    stick.add(pcb)

    // 防呆缺口（暗块模拟）
    const notch = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.22, 0.12), materials.blackPlastic)
    notch.position.set(0.4, 0.4, 0)
    stick.add(notch)

    // DDR 颗粒阵列（每面 8 颗 BGA 芯片，黑色硅塑料外壳）—— 在 PCB 表面、armor 之前先放
    for (const cz of [-0.04, 0.04]) {  // 双面
      for (let i = 0; i < 8; i++) {
        const chip = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.5, 0.03), materials.silicon)
        chip.position.set(-1.45 + i * 0.42, 1.0, cz * 1.4)
        stick.add(chip)
        // 芯片顶部丝印标签 (反光强一点)
        const label = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.36, 0.005), materials.labelPaper)
        label.position.set(-1.45 + i * 0.42, 1.0, cz * 1.4 + (cz > 0 ? 0.018 : -0.018))
        stick.add(label)
      }
    }

    // SPD 串行存在检测芯片（单颗小芯片，PCB 右下角）
    const spd = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, 0.04), materials.silicon)
    spd.position.set(1.6, 0.5, 0.06)
    stick.add(spd)

    // 铝合金马甲（双面）—— 在芯片之上，部分露出芯片
    for (const fx of [-0.09, 0.09]) {
      const armor = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.16, 0.04), materials.aluminum)
      armor.position.set(0, 1.02, fx)
      armor.castShadow = true
      stick.add(armor)
      // 马甲表面横向凹槽（散热齿造型）
      for (let k = 0; k < 6; k++) {
        const groove = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.04, 0.014), materials.aluminumDark)
        groove.position.set(0, 0.5 + k * 0.18, fx + (fx > 0 ? 0.022 : -0.022))
        stick.add(groove)
      }
    }

    // 顶部 RGB 导光条
    const rgbMat = makeLed(0x3b82f6, 0.9)
    const rgb = new THREE.Mesh(new THREE.BoxGeometry(3.7, 0.14, 0.16), rgbMat)
    rgb.position.y = 1.7
    stick.add(rgb)
    rgbBars.push(rgbMat)
  }

  // 数据颗粒（虚拟页面流）
  for (let i = 0; i < 6; i++) {
    const mat = makeLed(0x7fb0ff, 1.8)
    const cube = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), mat)
    cube.visible = false
    group.add(cube)
    flow.push({ mesh: cube, mat, t: i / 6, x: -1.6 + (i % 3) * 1.6, z: i < 3 ? -0.28 : 0.28 })
  }

  const led = makeStatusLed(0x3b82f6)
  led.mesh.position.set(1.9, 0.35, 0.6)
  group.add(led.mesh)

  const { obj, div } = makeLabel('memory')
  obj.position.set(0, 2.5, 0)
  group.add(obj)

  function update(cs, t, dt) {
    if (!cs) return
    group.position.y = ease(group.position.y, cs.active ? 0.16 : 0, dt)
    const pulse = 0.6 + 0.5 * Math.abs(Math.sin(t * 2.0))
    for (const m of rgbBars) m.emissiveIntensity = ease(m.emissiveIntensity, cs.active ? pulse : 0.5, dt, 5)
    led.mat.emissiveIntensity = ease(led.mat.emissiveIntensity, cs.active ? 2.4 : 0.35, dt, 6)
    for (const f of flow) {
      if (cs.active) {
        f.mesh.visible = true
        f.t = (f.t + dt * 0.5) % 1
        f.mesh.position.set(f.x, 0.4 + f.t * 1.3, f.z)
      } else {
        f.mesh.visible = false
      }
    }
    div.innerHTML = `<b style="color:${cs.color}">${cs.title}</b><span>占用 ${cs.metric}</span><span>${cs.sub}</span>`
  }

  return { group, update, focusOffset: new THREE.Vector3(0, 1.2, 0) }
}
