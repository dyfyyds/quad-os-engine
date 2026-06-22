import * as THREE from 'three'
import { makeLed } from './materials.js'
import { CORE_POS, KERNEL_POS } from './layout.js'

/**
 * 写实主板总线层。
 *
 * 每个 kernel→core 通道由：
 *   ① 多车道铜走线（8 根细铜条并排，仿真 PCIe / DDR 通道分线）
 *   ② 中段桥接芯片（北桥风格 BGA + IHS）
 *   ③ 方向性数据包（按事件源/目标着色，沿车道流动）
 * 组成。比单根铜条立体很多，能直观反映"4 个核心通过总线与内核交换数据"。
 *
 * 数据包颜色与方向约定（与 world.cores[i].color 协调）：
 *   processor (绿) ↔ kernel        - 指令流
 *   memory    (蓝) ↔ kernel        - 数据/页面
 *   resource  (紫/红) ↔ kernel     - 资源请求/死锁
 *   device    (橙) ↔ kernel        - I/O 块
 */
export function buildBus(scene, materials) {
  const group = new THREE.Group()
  scene.add(group)

  // 每条总线 8 车道，左右对称布置
  const LANES = 8
  const LANE_W = 0.06        // 单铜条宽
  const LANE_GAP = 0.03      // 车道间距
  const LANE_H = 0.018       // 铜条厚度（贴 PCB）
  const STRIP_TOTAL_W = LANES * LANE_W + (LANES - 1) * LANE_GAP

  const channels = {}

  for (const key in CORE_POS) {
    const [cx, cz] = CORE_POS[key]
    const dx = cx - KERNEL_POS[0]
    const dz = cz - KERNEL_POS[1]
    const len = Math.hypot(dx, dz)
    const angle = Math.atan2(dx, dz)  // 与 +Z 轴的夹角

    // —— 车道平台（一个浅 PCB 嵌片，让铜条有"承载层"）——
    const padding = 0.18
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(STRIP_TOTAL_W + padding, 0.012, len + padding),
      materials.pcbDark,
    )
    pad.position.set(dx / 2, 0.014, dz / 2)
    pad.rotation.y = angle
    pad.receiveShadow = true
    group.add(pad)

    // —— 8 条铜走线 ——
    const channelGroup = new THREE.Group()
    channelGroup.position.set(dx / 2, 0, dz / 2)
    channelGroup.rotation.y = angle
    group.add(channelGroup)

    for (let i = 0; i < LANES; i++) {
      const offsetX = (i - (LANES - 1) / 2) * (LANE_W + LANE_GAP)
      const lane = new THREE.Mesh(
        new THREE.BoxGeometry(LANE_W, LANE_H, len),
        materials.copperTrace,
      )
      lane.position.set(offsetX, 0.028, 0)
      lane.castShadow = false
      channelGroup.add(lane)
    }

    // —— 端点过孔阵列（kernel 侧 + core 侧），增加焊盘细节 ——
    const padArrayMat = materials.gold
    const viaRows = [-len / 2 + 0.18, len / 2 - 0.18]
    for (const localZ of viaRows) {
      for (let i = 0; i < LANES; i++) {
        const offsetX = (i - (LANES - 1) / 2) * (LANE_W + LANE_GAP)
        const via = new THREE.Mesh(
          new THREE.CylinderGeometry(0.022, 0.022, 0.022, 10),
          padArrayMat,
        )
        via.position.set(offsetX, 0.036, localZ)
        channelGroup.add(via)
      }
    }

    // —— 中段桥接芯片（北桥 / 南桥风格 BGA + IHS） ——
    const bridgeGroup = new THREE.Group()
    bridgeGroup.position.set(0, 0.05, 0)  // 总线中点
    channelGroup.add(bridgeGroup)

    // BGA 基座（薄 PCB）
    const bgaBase = new THREE.Mesh(
      new THREE.BoxGeometry(STRIP_TOTAL_W + 0.32, 0.04, 0.7),
      materials.pcbDark,
    )
    bgaBase.position.y = 0.02
    bgaBase.castShadow = true
    bridgeGroup.add(bgaBase)

    // BGA 焊球阵列（4 × 6 = 24 个）—— 仅在底面边缘可见
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 6; c++) {
        const ball = new THREE.Mesh(
          new THREE.SphereGeometry(0.018, 8, 6),
          materials.solder,
        )
        ball.position.set(-0.4 + c * 0.16, 0.04, -0.18 + r * 0.12)
        bridgeGroup.add(ball)
      }
    }

    // 芯片 IHS（顶盖，磨砂铝）
    const ihs = new THREE.Mesh(
      new THREE.BoxGeometry(STRIP_TOTAL_W + 0.18, 0.1, 0.58),
      materials.bridgeIHS,
    )
    ihs.position.y = 0.1
    ihs.castShadow = true
    bridgeGroup.add(ihs)

    // IHS 侧面凹槽（细条），增加工业感
    const groove = new THREE.Mesh(
      new THREE.BoxGeometry(STRIP_TOTAL_W + 0.2, 0.012, 0.04),
      materials.aluminumDark,
    )
    groove.position.set(0, 0.1, 0.31)
    bridgeGroup.add(groove)
    const groove2 = groove.clone()
    groove2.position.z = -0.31
    bridgeGroup.add(groove2)

    // 芯片 ID 小标 LED（极小，活跃时呼吸）
    const idMat = makeLed(0xffffff, 0.4)
    const idLed = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 8), idMat)
    idLed.position.set(STRIP_TOTAL_W / 2 + 0.06, 0.16, 0.22)
    bridgeGroup.add(idLed)

    // —— 数据包（方向性 LED 球，按 active 沿车道流动）——
    // 每个通道维护 6 个包：3 个 kernel→core 方向（不同车道，错开 t）+ 3 个 core→kernel
    const packets = []
    for (let i = 0; i < 6; i++) {
      const dir = i < 3 ? 1 : -1                     // 1: kernel→core；-1: core→kernel
      const laneIdx = i % LANES                      // 选车道
      const offsetX = (laneIdx - (LANES - 1) / 2) * (LANE_W + LANE_GAP)
      const mat = makeLed(0xffffff, 2.4)
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 10), mat)
      mesh.visible = false
      channelGroup.add(mesh)
      packets.push({
        mesh, mat, dir, offsetX,
        t: (i / 3) % 1,                              // 同方向 3 个包均匀错开
        speed: 0.5 + (i % 3) * 0.1,
      })
    }

    channels[key] = { channelGroup, len, packets, bridgeGroup, idMat }
  }

  // —— 中央总线仲裁器（小芯片，叠在 kernel 上方供边缘点缀）——
  // kernel.js 已有 SoC 模型，这里只在原点放一个低矮的"仲裁器"指示圈
  const arbiterRingMat = makeLed(0x15a98a, 0.8)
  const arbiterRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.4, 0.04, 8, 36),
    arbiterRingMat,
  )
  arbiterRing.rotation.x = -Math.PI / 2
  arbiterRing.position.y = 0.016
  group.add(arbiterRing)

  const scratch = new THREE.Color()
  function update(world, t, dt) {
    if (!world) return
    const anyActive = world.cores.some((c) => c.active)
    arbiterRingMat.emissiveIntensity = anyActive ? 0.8 + 0.4 * Math.abs(Math.sin(t * 2.0)) : 0.25

    for (const c of world.cores) {
      const ch = channels[c.key]
      if (!ch) continue
      // 桥接芯片 ID LED 呼吸
      ch.idMat.emissiveIntensity = c.active ? 0.8 + 0.5 * Math.abs(Math.sin(t * 3 + c.bar * 3)) : 0.2

      scratch.set(c.color)
      for (const pkt of ch.packets) {
        if (!c.active) {
          pkt.mesh.visible = false
          continue
        }
        pkt.mesh.visible = true
        pkt.mat.emissive.copy(scratch)
        pkt.t = (pkt.t + dt * pkt.speed) % 1
        // dir=1: kernel(localZ=-len/2) → core(localZ=+len/2)
        // dir=-1: 反向
        const z = pkt.dir === 1
          ? THREE.MathUtils.lerp(-ch.len / 2 + 0.2, ch.len / 2 - 0.2, pkt.t)
          : THREE.MathUtils.lerp(ch.len / 2 - 0.2, -ch.len / 2 + 0.2, pkt.t)
        pkt.mesh.position.set(pkt.offsetX, 0.08, z)
      }
    }
  }

  return { group, update }
}
