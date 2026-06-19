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

let renderer, labelRenderer, scene, camera, controls, raf
let centerMesh, centerGroup
let pcbTexture
let ambientLight, dirLight, pointGlow

// 各核心在 3D 空间中的坐标布局
const POS = { processor: [-8, -8], memory: [8, -8], resource: [-8, 8], device: [8, 8] }
const towers = {}

// 资源核心中的晶体与粒子
let resourceCrystals = []
let resourceLines = null
let resourceParticles = []

// 存储核心中浮动页面块与动态动画
let memoryPages = []

// 设备核心机械盘与磁头臂
let hddPlatters = []
let hddArmGroup = null
let hddHeadLight = null

// 主板上点缀的 3D 电子元件（电容、芯片、电感等）
const boardComponents = []

onMounted(init)
onActivated(onResize)
onBeforeUnmount(cleanup)

// 生成用于 CSS2D 渲染的高端暗色玻璃标签
function makeLabel(key) {
  const div = document.createElement('div')
  div.className = 'twin3d-label'
  if (key) {
    div.classList.add(key)
  }
  const obj = new CSS2DObject(div)
  return { obj, div }
}

// 制作 PCB 电路板金线底板纹理
function createPCBTexture() {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  
  // 深靛蓝色底板
  ctx.fillStyle = '#080d1a'
  ctx.fillRect(0, 0, size, size)
  
  // 绘制科技感精密电路网格背景
  ctx.strokeStyle = 'rgba(21, 169, 138, 0.05)'
  ctx.lineWidth = 1
  const grid = 32
  for (let i = 0; i < size; i += grid) {
    ctx.beginPath()
    ctx.moveTo(i, 0); ctx.lineTo(i, size); ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(0, i); ctx.lineTo(size, i); ctx.stroke()
  }

  // 绘制科技感导轨金线
  ctx.strokeStyle = 'rgba(21, 169, 138, 0.25)'
  ctx.shadowColor = '#15a98a'
  ctx.shadowBlur = 6
  ctx.lineWidth = 1.5
  
  for (let i = 0; i < 12; i++) {
    ctx.beginPath()
    let x = Math.random() * size
    let y = 0
    ctx.moveTo(x, y)
    
    while (y < size) {
      y += 30 + Math.random() * 60
      x += (Math.random() - 0.5) * 50
      ctx.lineTo(x, y)
    }
    ctx.stroke()
  }

  // 绘制小圆点插座
  ctx.fillStyle = 'rgba(59, 130, 246, 0.4)'
  ctx.shadowBlur = 4
  ctx.shadowColor = '#3b82f6'
  for (let i = 0; i < 20; i++) {
    ctx.beginPath()
    ctx.arc(Math.random() * size, Math.random() * size, 3, 0, Math.PI * 2)
    ctx.fill()
  }

  return new THREE.CanvasTexture(canvas)
}

// 创建连接 CPU 内核与四核心的高清 3D 光纤数据总线管道
function createBusTube(x, z, colorHex) {
  const start = new THREE.Vector3(0, 2, 0)
  const end = new THREE.Vector3(x, 0.8, z)
  const direction = new THREE.Vector3().subVectors(end, start)
  const len = direction.length()
  
  const geo = new THREE.CylinderGeometry(0.06, 0.06, len, 8)
  geo.translate(0, len / 2, 0)
  geo.rotateX(Math.PI / 2)
  
  const mat = new THREE.MeshStandardMaterial({
    color: colorHex,
    emissive: colorHex,
    emissiveIntensity: 0.4,
    transparent: true,
    opacity: 0.35,
    roughness: 0.1,
    metalness: 0.8
  })
  
  const tube = new THREE.Mesh(geo, mat)
  tube.position.copy(start)
  tube.lookAt(end)
  scene.add(tube)
  
  return tube
}

// 在主板空白处装配 3D 电子元器件，提升真实度和精细度
function buildMotherboardComponents() {
  const capGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.5, 8)
  const capMetalMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.2, metalness: 0.9 })
  const capBodyMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.4 }) // 蓝色铝电解电容
  const capBodyMat2 = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.5 }) // 黑色电容

  const inductorGeo = new THREE.BoxGeometry(0.4, 0.3, 0.4)
  const inductorMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.8, metalness: 0.7 }) // 封闭式贴片电感

  const chipGeo = new THREE.BoxGeometry(0.6, 0.08, 0.6)
  const chipMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.8 }) // 贴片芯片集成电路

  // 元器件摆放坐标点（避开四个核心塔）
  const placements = [
    { x: -3, z: -3, type: 'cap' }, { x: -3.3, z: -2.8, type: 'cap2' },
    { x: 3, z: -3, type: 'inductor' }, { x: 3.5, z: -3.5, type: 'chip' },
    { x: -3, z: 3, type: 'chip' }, { x: -2.4, z: 3.4, type: 'cap' },
    { x: 3, z: 3, type: 'cap' }, { x: 3.3, z: 2.8, type: 'cap' },
    { x: 0, z: -4.5, type: 'inductor' }, { x: -4.5, z: 0, type: 'cap2' },
    { x: 4.5, z: 0, type: 'chip' }, { x: 0, z: 4.5, type: 'cap' }
  ]

  placements.forEach((comp, idx) => {
    const compGroup = new THREE.Group()
    compGroup.position.set(comp.x, 0, comp.z)

    if (comp.type === 'cap' || comp.type === 'cap2') {
      // 组装电容：底座 + 金属顶壳
      const body = new THREE.Mesh(capGeo, comp.type === 'cap' ? capBodyMat : capBodyMat2)
      body.position.y = 0.25
      compGroup.add(body)

      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.05, 8), capMetalMat)
      top.position.y = 0.525
      compGroup.add(top)
    } else if (comp.type === 'inductor') {
      const ind = new THREE.Mesh(inductorGeo, inductorMat)
      ind.position.y = 0.15
      compGroup.add(ind)
      // 电感顶部丝印标记线
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.08), capMetalMat)
      line.position.set(0, 0.31, 0)
      compGroup.add(line)
    } else if (comp.type === 'chip') {
      const chip = new THREE.Mesh(chipGeo, chipMat)
      chip.position.y = 0.04
      compGroup.add(chip)

      // 芯片侧边引脚 (Pins)
      const pinMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.9, roughness: 0.2 })
      for (let i = -0.2; i <= 0.2; i += 0.15) {
        const pinLeft = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.03), pinMat)
        pinLeft.position.set(-0.32, 0.02, i)
        compGroup.add(pinLeft)
        
        const pinRight = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.03), pinMat)
        pinRight.position.set(0.32, 0.02, i)
        compGroup.add(pinRight)
      }
    }

    scene.add(compGroup)
    boardComponents.push(compGroup)
  })
}

// 核心 3D 器件装配中心 (打磨精细版)
function buildTower(c) {
  const colorHex = new THREE.Color(c.color)
  const [x, z] = POS[c.key]
  
  const towerGroup = new THREE.Group()
  towerGroup.position.set(x, 0, z)
  scene.add(towerGroup)

  let activeEmissiveIntensity = 0.4

  // ----------------------------------------------------
  // 1. 处理机调度 (精细化多核 CPU 芯片模型)
  // ----------------------------------------------------
  if (c.key === 'processor') {
    // 芯片插槽底座 (CPU Socket)
    const socket = new THREE.Mesh(
      new THREE.BoxGeometry(4.2, 0.25, 4.2),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8, metalness: 0.2 })
    )
    socket.position.y = 0.125
    towerGroup.add(socket)

    // CPU 金属边框和扣具 (Retention Bracket Frame)
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.2, metalness: 0.9 })
    const frameLeft = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.15, 3.8), frameMat)
    frameLeft.position.set(-1.8, 0.3, 0)
    towerGroup.add(frameLeft)

    const frameRight = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.15, 3.8), frameMat)
    frameRight.position.set(1.8, 0.3, 0)
    towerGroup.add(frameRight)

    const frameTop = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.15, 0.3), frameMat)
    frameTop.position.set(0, 0.3, 1.8)
    towerGroup.add(frameTop)

    const frameBottom = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.15, 0.3), frameMat)
    frameBottom.position.set(0, 0.3, -1.8)
    towerGroup.add(frameBottom)

    // 金属锁扣控制杆 (Socket Tension Lever)
    const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.4, 8), frameMat)
    lever.rotation.x = Math.PI / 2
    lever.position.set(2.05, 0.3, 0.2)
    towerGroup.add(lever)

    // CPU 核心镜面硅片 (Silicon Die)
    const die = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 0.12, 2.4),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, emissive: c.color, emissiveIntensity: 0.28, roughness: 0.05, metalness: 0.95 })
    )
    die.position.y = 0.25 + 0.06
    towerGroup.add(die)

    // 导热纯铜热管 (Copper Heatpipes)
    const copperMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.15, metalness: 0.9 })
    for (const offsetZ of [-0.6, 0.6]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.2, 8), copperMat)
      pipe.rotation.z = Math.PI / 2
      pipe.position.set(0, 0.38, offsetZ)
      towerGroup.add(pipe)
    }

    // 密集的铝合金散热鳍片阵列 (Aluminum Heatsink Fins)
    const finMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.3, metalness: 0.85, transparent: true, opacity: 0.95 })
    for (let i = -1.3; i <= 1.3; i += 0.24) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9, 2.8), finMat)
      fin.position.set(i, 0.75, 0)
      towerGroup.add(fin)
    }

    towers[c.key] = { group: towerGroup, color: colorHex, activeEmissiveIntensity }
  }

  // ----------------------------------------------------
  // 2. 存储管理 (带马甲和内存芯片的精细 RAM 模块)
  // ----------------------------------------------------
  else if (c.key === 'memory') {
    // 内存插槽底座 (DDR Slots)
    const ramBase = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 0.25, 4.6),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.9 })
    )
    ramBase.position.y = 0.125
    towerGroup.add(ramBase)

    // 精细化组装两个内存模组
    const pcbMat = new THREE.MeshStandardMaterial({ color: 0x065f46, roughness: 0.7 }) // 绿色 PCB 板
    const armorMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.7, roughness: 0.3 }) // 铝合金散热甲
    const chipMat = new THREE.MeshStandardMaterial({ color: 0x020617, roughness: 0.85 }) // 内存 IC 颗粒
    const rgbMat = new THREE.MeshStandardMaterial({ color: c.color, emissive: c.color, emissiveIntensity: 0.85, metalness: 0.1 })
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.9, roughness: 0.1 }) // 金手指

    for (const offsetZ of [-0.6, 0.6]) {
      const stickGroup = new THREE.Group()
      stickGroup.position.set(0, 0, offsetZ)
      towerGroup.add(stickGroup)

      // 1. 内存金手指 (Gold Finger)
      const finger = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.15, 3.8), goldMat)
      finger.position.y = 0.2 + 0.075
      stickGroup.add(finger)

      // 2. 内存 PCB 主板
      const pcb = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.4, 3.8), pcbMat)
      pcb.position.y = 0.9
      stickGroup.add(pcb)

      // 3. 内存马甲散热片 (Heat Spreaders)
      const armorLeft = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.2, 3.6), armorMat)
      armorLeft.position.set(-0.08, 0.9, 0)
      stickGroup.add(armorLeft)

      const armorRight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.2, 3.6), armorMat)
      armorRight.position.set(0.08, 0.9, 0)
      stickGroup.add(armorRight)

      // 4. 镶嵌在露出的 PCB 上的贴片内存芯片 (Memory ICs)
      for (let k = -1.3; k <= 1.3; k += 0.65) {
        if (k === 0) continue
        const chip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.35, 0.45), chipMat)
        chip.position.set(0.11, 0.68, k)
        stickGroup.add(chip)
      }

      // 5. 内存条顶部炫彩发光导光条 (RGB Lightbar)
      const rgbBar = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.18, 3.8), rgbMat)
      rgbBar.position.y = 1.69
      stickGroup.add(rgbBar)
    }

    // 内存虚拟页面数据块 (Page Cubes)
    for (let i = 0; i < 5; i++) {
      const pageCube = new THREE.Mesh(
        new THREE.BoxGeometry(0.32, 0.32, 0.32),
        new THREE.MeshStandardMaterial({ color: c.color, emissive: c.color, emissiveIntensity: 0.5, transparent: true, opacity: 0.85 })
      )
      // 错落浮动定位
      const angle = (i * Math.PI * 2) / 5
      pageCube.position.set(Math.cos(angle) * 1.0, 0.5 + i * 0.36, Math.sin(angle) * 1.0)
      towerGroup.add(pageCube)
      memoryPages.push(pageCube)
    }

    towers[c.key] = { group: towerGroup, color: colorHex, activeEmissiveIntensity }
  }

  // ----------------------------------------------------
  // 3. 进程与资源 (精细化悬浮水晶簇与能量网)
  // ----------------------------------------------------
  else if (c.key === 'resource') {
    // 带有金属边缘倒角的高精基座
    const resBase = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.4, 0.25, 6),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.6, roughness: 0.2 })
    )
    resBase.position.y = 0.125
    towerGroup.add(resBase)

    const baseRing = new THREE.Mesh(
      new THREE.CylinderGeometry(2.0, 2.0, 0.08, 6, 1, true),
      new THREE.MeshStandardMaterial({ color: c.color, emissive: c.color, emissiveIntensity: 0.6 })
    )
    baseRing.position.y = 0.26
    towerGroup.add(baseRing)

    // 代表不同资源的水晶簇（每个点由一个大水晶+两个斜生小水晶组成）
    const bigCrystalGeo = new THREE.OctahedronGeometry(0.5, 0)
    const smallCrystalGeo = new THREE.OctahedronGeometry(0.24, 0)
    
    for (let i = 0; i < 3; i++) {
      const clusterGroup = new THREE.Group()
      
      const angle = (i * Math.PI * 2) / 3
      const radius = 1.1
      clusterGroup.position.set(Math.cos(angle) * radius, 1.2, Math.sin(angle) * radius)
      towerGroup.add(clusterGroup)

      const cryColor = i === 0 ? 0xa855f7 : (i === 1 ? 0xec4899 : 0x06b6d4)
      const cryMat = new THREE.MeshStandardMaterial({
        color: cryColor,
        emissive: cryColor,
        emissiveIntensity: 0.7,
        roughness: 0.1,
        metalness: 0.9,
        transparent: true,
        opacity: 0.92
      })

      // 主水晶 (Main Crystal)
      const mainCry = new THREE.Mesh(bigCrystalGeo, cryMat)
      clusterGroup.add(mainCry)

      // 偏侧斜生小晶体 (Cluster Buds)
      const subCry1 = new THREE.Mesh(smallCrystalGeo, cryMat)
      subCry1.position.set(0.3, -0.3, 0.1)
      subCry1.rotation.set(0.3, 0.4, 0.5)
      clusterGroup.add(subCry1)

      const subCry2 = new THREE.Mesh(smallCrystalGeo, cryMat)
      subCry2.position.set(-0.25, -0.3, -0.2)
      subCry2.rotation.set(-0.4, 0.2, -0.3)
      clusterGroup.add(subCry2)

      resourceCrystals.push(clusterGroup)
    }

    // 金色能量连接网络线
    const linePoints = []
    for (let i = 0; i <= 3; i++) {
      const angle = ((i % 3) * Math.PI * 2) / 3
      const radius = 1.1
      linePoints.push(new THREE.Vector3(Math.cos(angle) * radius, 1.2, Math.sin(angle) * radius))
    }
    const lineGeo = new THREE.BufferGeometry().setFromPoints(linePoints)
    const lineMat = new THREE.LineBasicMaterial({ color: c.color, transparent: true, opacity: 0.45 })
    resourceLines = new THREE.Line(lineGeo, lineMat)
    towerGroup.add(resourceLines)

    // 资源周围漂浮的微光尘埃粒子 (Resource Particle Dust)
    const dustGeo = new THREE.SphereGeometry(0.05, 8, 8)
    const dustMat = new THREE.MeshBasicMaterial({ color: c.color, transparent: true, opacity: 0.8 })
    for (let i = 0; i < 6; i++) {
      const dust = new THREE.Mesh(dustGeo, dustMat)
      dust.position.set((Math.random() - 0.5) * 2.5, 0.6 + Math.random() * 1.5, (Math.random() - 0.5) * 2.5)
      towerGroup.add(dust)
      resourceParticles.push(dust)
    }

    towers[c.key] = { group: towerGroup, color: colorHex, activeEmissiveIntensity: 0.4 }
  }

  // ----------------------------------------------------
  // 4. 设备管理 (带减重孔磁头臂、主轴螺母扣的真物理机械硬盘)
  // ----------------------------------------------------
  else if (c.key === 'device') {
    // 硬盘底盖铝合金机框 (Aluminum Chassis)
    const basePlate = new THREE.Mesh(
      new THREE.BoxGeometry(4.2, 0.25, 5.0),
      new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.4, metalness: 0.7 })
    )
    basePlate.position.y = 0.125
    towerGroup.add(basePlate)

    // 主轴螺母固定盖 (Spindle Center Nut)
    const spindle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.35, 0.9, 16),
      new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.2, metalness: 0.9 })
    )
    spindle.position.set(-0.35, 0.45, -0.6)
    towerGroup.add(spindle)

    // 主轴顶部的三个小银色内六角螺栓 (Spindle Bolts)
    const boltGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.05, 8)
    const boltMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.9 })
    for (let i = 0; i < 3; i++) {
      const bolt = new THREE.Mesh(boltGeo, boltMat)
      const ang = (i * Math.PI * 2) / 3
      bolt.position.set(-0.35 + Math.cos(ang) * 0.18, 0.91, -0.6 + Math.sin(ang) * 0.18)
      towerGroup.add(bolt)
    }

    // 双层高反光银闪闪盘片
    const platterMat = new THREE.MeshStandardMaterial({
      color: 0xf1f5f9,
      roughness: 0.03,
      metalness: 0.99,
      envMapIntensity: 1.2
    })

    const platter1 = new THREE.Mesh(new THREE.CylinderGeometry(1.68, 1.68, 0.04, 32), platterMat)
    platter1.position.set(-0.35, 0.32, -0.6)
    towerGroup.add(platter1)
    hddPlatters.push(platter1)

    const platter2 = new THREE.Mesh(new THREE.CylinderGeometry(1.68, 1.68, 0.04, 32), platterMat)
    platter2.position.set(-0.35, 0.62, -0.6)
    towerGroup.add(platter2)
    hddPlatters.push(platter2)

    // 磁头驱动器旋转轴轴承 (Actuator Pivot Bearing)
    hddArmGroup = new THREE.Group()
    hddArmGroup.position.set(1.1, 0.68, 1.2)
    towerGroup.add(hddArmGroup)

    const bearing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.38, 0.38, 0.35, 16),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4, metalness: 0.8 })
    )
    bearing.position.y = -0.1
    hddArmGroup.add(bearing)

    // 拼装高保真机械磁头臂 (含有减重镂空孔 Actuator Arm with Weight-reduction Holes)
    const armMat = new THREE.MeshStandardMaterial({ color: 0xc084fc, roughness: 0.2, metalness: 0.95 })
    
    // 磁头臂主龙骨
    const armMain = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 1.3), armMat)
    armMain.position.set(0, 0, -0.65)
    hddArmGroup.add(armMain)

    // 磁头悬臂尖端 (Head Suspension Flexure)
    const flexure = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.02, 0.8),
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.9 })
    )
    flexure.position.set(0, -0.02, -1.5)
    hddArmGroup.add(flexure)

    // 镂空孔模拟立方体，遮挡实现镂空视觉
    for (let k = -0.3; k >= -0.9; k -= 0.3) {
      const holeMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, 0.08, 8),
        new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 }) // 视觉上形成穿透孔的阴影
      )
      holeMesh.position.set(0, 0.001, k)
      hddArmGroup.add(holeMesh)
    }

    // 磁头滑块 (Head Slider)
    const slider = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.08, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.9 })
    )
    slider.position.set(0, -0.06, -1.9)
    hddArmGroup.add(slider)

    // 寻道中发光的工作微型镭射指示灯 (Active R/W Indicator Light)
    const lightMat = new THREE.MeshBasicMaterial({ color: c.color, transparent: true, opacity: 0.9 })
    hddHeadLight = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), lightMat)
    hddHeadLight.position.set(0, 0.05, -1.9)
    hddArmGroup.add(hddHeadLight)

    // 硬盘边缘的停泊保护区斜坡 (Landing Ramp)
    const ramp = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.5, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.9 })
    )
    ramp.position.set(0.68, 0.45, -2.18)
    towerGroup.add(ramp)

    towers[c.key] = { group: towerGroup, color: colorHex, activeEmissiveIntensity }
  }

  // ----------------------------------------------------
  // 通用连通导轨与事件粒子特效
  // ----------------------------------------------------
  const busTube = createBusTube(x, z, c.color)
  towers[c.key].bus = busTube

  const particle = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 16, 16),
    new THREE.MeshBasicMaterial({ color: c.color })
  )
  particle.visible = false
  scene.add(particle)
  towers[c.key].particle = particle

  // 生成 HTML 3D CSS2D 标签空间
  const { obj, div } = makeLabel(c.key)
  obj.position.set(x, 2.8, z)
  scene.add(obj)
  towers[c.key].label = div
}

// 3D 渲染画布初始化
function init() {
  const el = container.value
  const w = el.clientWidth || 800
  const h = 540 // 适当高度，视野显得极具宏伟感

  scene = new THREE.Scene()
  
  // 引入深色调雾化背景，营造纵深电子空间
  scene.fog = new THREE.FogExp2(0x080d1a, 0.015)

  camera = new THREE.PerspectiveCamera(48, w / h, 0.1, 1000)
  camera.position.set(0, 15, 23)

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
  controls.target.set(0, 1, 0)
  controls.enableDamping = true
  controls.maxPolarAngle = Math.PI / 2.1
  controls.minDistance = 10
  controls.maxDistance = 40

  // 炫彩复合光系统
  ambientLight = new THREE.AmbientLight(0x1e293b, 1.2)
  scene.add(ambientLight)
  
  dirLight = new THREE.DirectionalLight(0xffffff, 0.8)
  dirLight.position.set(10, 20, 10)
  scene.add(dirLight)

  // 核心发出发散幽蓝光
  pointGlow = new THREE.PointLight(0x3b82f6, 1.8, 18)
  pointGlow.position.set(0, 1.5, 0)
  scene.add(pointGlow)

  // 铺设高精度主板 PCB
  pcbTexture = createPCBTexture()
  const pcbPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(42, 42),
    new THREE.MeshStandardMaterial({
      map: pcbTexture,
      roughness: 0.15,
      metalness: 0.45
    })
  )
  pcbPlane.rotation.x = -Math.PI / 2
  pcbPlane.position.y = -0.01
  scene.add(pcbPlane)

  // 铺设 3D 主板上的点缀电子元器件
  buildMotherboardComponents()

  // 绘制科技感导轨同心圈线
  const trackGeo = new THREE.RingGeometry(11.2, 11.3, 64)
  const trackMat = new THREE.MeshBasicMaterial({ color: 0x15a98a, transparent: true, opacity: 0.1, side: THREE.DoubleSide })
  const track = new THREE.Mesh(trackGeo, trackMat)
  track.rotation.x = -Math.PI / 2
  track.position.y = 0.01
  scene.add(track)

  // ----------------------------------------------------
  // 调度内核 (CPU Scheduler Hub 3D 核心模型)
  // ----------------------------------------------------
  centerGroup = new THREE.Group()
  centerGroup.position.y = 1.8
  scene.add(centerGroup)

  // 内核发光体 (Energy Core)
  centerMesh = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.0, 1),
    new THREE.MeshStandardMaterial({
      color: 0x06b6d4,
      emissive: 0x15a98a,
      emissiveIntensity: 0.8,
      metalness: 0.3,
      roughness: 0.2
    })
  )
  centerGroup.add(centerMesh)

  // 外围旋回三环陀螺仪系统 (Gyroscope Triple Rings)
  const ringMat = new THREE.MeshStandardMaterial({
    color: 0x15a98a,
    emissive: 0x15a98a,
    emissiveIntensity: 0.4,
    transparent: true,
    opacity: 0.65
  })
  
  const ring1 = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.04, 8, 48), ringMat)
  ring1.rotation.x = Math.PI / 2
  centerGroup.add(ring1)

  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.03, 8, 48), ringMat)
  ring2.rotation.y = Math.PI / 4
  centerGroup.add(ring2)

  const ring3 = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.02, 8, 48), ringMat)
  ring3.rotation.z = Math.PI / 3
  centerGroup.add(ring3)

  // 状态 3D 浮动标签空间
  const coreLabel = makeLabel('core')
  coreLabel.obj.position.set(0, 3.8, 0)
  scene.add(coreLabel.obj)
  centerMesh.userData.label = coreLabel.div

  // 加载四大 OS 核心塔的精美建模
  world.value.cores.forEach(buildTower)
  
  window.addEventListener('resize', onResize)
  animate()
}

// 动画主渲染循环
function animate() {
  raf = requestAnimationFrame(animate)
  const wv = world.value
  const time = Date.now() * 0.001

  // 1. 调度核心微调陀螺仪旋转及发光呼吸
  centerMesh.rotation.y += 0.015
  centerMesh.rotation.x += 0.006
  
  // 三环按不同角速度公转
  centerGroup.children[1].rotation.z += 0.008
  centerGroup.children[2].rotation.x -= 0.012
  centerGroup.children[3].rotation.y += 0.005
  centerGroup.rotation.z = Math.sin(time * 0.8) * 0.15
  
  const cmMat = centerMesh.material
  cmMat.emissiveIntensity = 0.55 + (wv.running ? 0.38 * Math.abs(Math.sin(Date.now() / 240)) : 0)
  
  if (centerMesh.userData.label) {
    centerMesh.userData.label.innerHTML = `<b>系统调度核心</b><span>CPU负载 ${wv.cpuUtil}% · 时钟T${wv.clock}</span>`
  }

  // 2. 存储管理 - 内存物理页面颗粒上下匀速飘移
  memoryPages.forEach((p, idx) => {
    p.position.y = 0.8 + Math.sin(time * 2.0 + idx * 1.5) * 0.18
    p.rotation.y += 0.01
    p.rotation.x += 0.006
  })

  // 3. 进程与资源 - 资源水晶悬浮和微尘粒子流
  resourceCrystals.forEach((cry, idx) => {
    cry.position.y = 1.1 + Math.sin(time * 2.5 + idx * 2.0) * 0.14
    cry.rotation.y += 0.016
    cry.rotation.z += 0.008
  })
  resourceParticles.forEach((dust, idx) => {
    dust.position.y += Math.sin(time * 3.0 + idx) * 0.006
    if (dust.position.y > 2.0) dust.position.y = 0.6
  })
  if (resourceLines) {
    resourceLines.rotation.y += 0.003
    resourceLines.material.color.setHex(wv.cores.find(c => c.key === 'resource')?.metric === '死锁' ? 0xe64a45 : 0x8b5cf6)
  }

  // 4. 设备管理 - 硬盘盘片旋转和磁头臂作动器真实移动
  if (wv.running) {
    hddPlatters.forEach((plat) => {
      plat.rotation.y += 0.22 // 模拟 7200 转高速转动
    })
    // 磁头定位微波镭射灯闪烁
    if (hddHeadLight) {
      hddHeadLight.material.opacity = 0.3 + 0.7 * Math.abs(Math.sin(Date.now() / 80))
    }
  } else {
    if (hddHeadLight) hddHeadLight.material.opacity = 0.2
  }
  
  if (hddArmGroup && wv.disk) {
    // 动态寻道动作：将模拟 OS 柱面物理磁头位置 (0 ~ 199) 精密映射到寻道角度上
    const headRatio = wv.disk.head / Math.max(1, wv.disk.cylinders - 1)
    const targetAngle = -0.12 - headRatio * 0.65 // 精确对应磁碟内外圈轨道
    hddArmGroup.rotation.y += (targetAngle - hddArmGroup.rotation.y) * 0.12 // 缓冲系数平滑位移
  }

  // 5. 四核心联动状态、总线光纤流动和 2D-HTML 标签数据刷新
  wv.cores.forEach((c) => {
    const tw = towers[c.key]
    if (!tw) return

    // 核心活跃高亮逻辑
    tw.group.material ? (tw.group.material.emissiveIntensity = c.active ? 0.45 : 0.1) : null
    
    // 光纤总线动态亮度
    if (tw.bus) {
      tw.bus.material.opacity = c.active ? 0.65 : 0.22
      tw.bus.material.emissiveIntensity = c.active ? 0.85 : 0.25
    }

    tw.label.innerHTML = `<b style="color:${c.color}">${c.title}</b><span>${c.metric}</span><span>${c.sub}</span>`

    // 数据传输粒子球 (Data Packets Delivery)
    const [gx, gz] = POS[c.key]
    tw.particle.visible = c.active
    if (c.active) {
      tw.t = (tw.t + 0.024) % 1
      tw.particle.position.set(
        THREE.MathUtils.lerp(0, gx, tw.t),
        THREE.MathUtils.lerp(1.8, 0.8, tw.t),
        THREE.MathUtils.lerp(0, gz, tw.t)
      )
    }
  })

  // 6. 元器件微光反射律动
  boardComponents.forEach((comp, idx) => {
    comp.rotation.y = Math.sin(time * 0.2 + idx) * 0.05
  })

  controls.update()
  renderer.render(scene, camera)
  labelRenderer.render(scene, camera)
}

function onResize() {
  if (!renderer || !container.value) return
  const w = container.value.clientWidth
  const h = 540
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
  if (pcbTexture) pcbTexture.dispose()
  scene = null
}
</script>

<style scoped>
.twin3d {
  position: relative;
  width: 100%;
  height: 540px;
  border-radius: 12px;
  overflow: hidden;
  background: #080d1a;
  box-shadow: inset 0 0 28px rgba(0, 0, 0, 0.85);
}
.twin3d-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #8a96a6;
}
</style>

<style>
.twin3d-label {
  background: rgba(13, 20, 35, 0.88);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 11px;
  color: #f8fafc;
  line-height: 1.45;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
  white-space: nowrap;
  text-align: center;
  transition: all 0.2s;
}
.twin3d-label b {
  display: block;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 2px;
}
.twin3d-label span {
  display: block;
  color: #cbd5e1;
  font-size: 10px;
}
.twin3d-label.core {
  background: rgba(15, 59, 52, 0.9);
  border: 1px solid rgba(21, 169, 138, 0.35);
  box-shadow: 0 0 10px rgba(21, 169, 138, 0.25);
}
.twin3d-label.core b {
  color: #15a98a;
  font-weight: 700;
}
.twin3d-label.core span {
  color: #7fe3cf;
}
</style>
