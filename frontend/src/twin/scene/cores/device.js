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

  // —— VCM (Voice Coil Motor) ：作动臂尾部的扇形线圈 + 上下两片永磁体 + 钢轭 ——
  // 用 RingGeometry 切扇形做线圈，再用两片扁长方体做磁铁
  // 线圈：以 bearing 为中心向 +Z 方向延伸的扇形（与磁头臂相反方向）
  const coilMat = new THREE.MeshPhysicalMaterial({ color: 0xb87333, metalness: 0.85, roughness: 0.45 })
  // 用环形扇形（thetaStart/Length）+ 多圈细环模拟铜线圈
  const coilWedge = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.78, 18, 1, -Math.PI / 4, Math.PI / 2),
    coilMat,
  )
  coilWedge.rotation.x = -Math.PI / 2  // 水平铺
  coilWedge.position.set(0, -0.06, 0.6)  // 在 bearing 后方（+Z），扇形朝外
  arm.add(coilWedge)
  // 线圈表面细环纹（5 圈同心，仿真铜线密绕）
  for (let i = 0; i < 5; i++) {
    const r1 = 0.45 + i * 0.065
    const r2 = r1 + 0.015
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(r1, r2, 18, 1, -Math.PI / 4, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x7a4a1f, roughness: 0.5, metalness: 0.6 }),
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.set(0, -0.052, 0.6)
    arm.add(ring)
  }

  // 永磁体上盖（黑色磁钢，立在线圈上方）—— 不随臂旋转，所以挂在 group 而非 arm
  const magnetTop = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 0.9), materials.aluminumDark)
  magnetTop.position.set(1.4, 0.95, 2.0)  // 在 bearing(1.4,0.75,1.4) 之后偏 z +0.6 处
  magnetTop.castShadow = true
  group.add(magnetTop)
  // 上磁极标识（"S 极"小标签，深红色细条）
  const polTop = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.005, 0.04),
    new THREE.MeshStandardMaterial({ color: 0xc54a3a, roughness: 0.7 }),
  )
  polTop.position.set(1.4, 1.011, 2.0)
  group.add(polTop)

  // 永磁体下盖（在 arm 平面以下，作为磁路另一极）
  const magnetBot = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 0.9), materials.aluminumDark)
  magnetBot.position.set(1.4, 0.58, 2.0)
  magnetBot.castShadow = true
  group.add(magnetBot)

  // 磁轭/磁路支柱（连接上下磁极的钢条，让磁场闭环 — 真 HDD 的标志性结构）
  for (const yokeX of [1.4 - 0.45, 1.4 + 0.45]) {
    const yoke = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.4, 0.16), materials.aluminumDark)
    yoke.position.set(yokeX, 0.78, 2.42)  // 后方支柱
    yoke.castShadow = true
    group.add(yoke)
  }

  // VCM 工作指示 LED（活跃时亮，仿真线圈通电闪烁）
  const vcmLedMat = makeLed(0xf0a020, 0.5)
  const vcmLed = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 10), vcmLedMat)
  vcmLed.position.set(1.4, 1.05, 2.4)
  group.add(vcmLed)

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
    // VCM 工作指示：寻道时（bar 变化）随线圈"通电"快速闪
    vcmLedMat.emissiveIntensity = cs.active ? 0.3 + 1.2 * Math.abs(Math.sin(t * 12 + cs.bar * 4)) : 0.15
    led.mat.emissiveIntensity = ease(led.mat.emissiveIntensity, cs.active ? 2.4 : 0.35, dt, 6)
    div.innerHTML = `<b style="color:${cs.color}">${cs.title}</b><span>${cs.metric}</span><span>${cs.sub}</span>`
  }

  return { group, update, focusOffset: new THREE.Vector3(0, 1.0, 0) }
}
