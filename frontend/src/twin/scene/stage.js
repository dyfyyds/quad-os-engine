import * as THREE from 'three'
import { makeLed } from './materials.js'
import { CORE_POS } from './layout.js'

/**
 * 主板舞台：写实 PCB（程序化纹理）+ 远景地面 + 内核↔四核心的铜走线 + 沿线流动的数据光点。
 * buildStage(scene, materials) → { group, update(world,t,dt) }
 */
export function buildStage(scene, materials) {
  const group = new THREE.Group()
  scene.add(group)

  // 远景地面：极暗，接收远处阴影并融入雾
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(160, 160),
    new THREE.MeshStandardMaterial({ color: 0x05070d, roughness: 0.95, metalness: 0.0 }),
  )
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -0.08
  floor.receiveShadow = true
  group.add(floor)

  // 主板 PCB
  const pcbTex = createPcbTexture(1024)
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshPhysicalMaterial({
      map: pcbTex,
      roughness: 0.55,
      metalness: 0.1,
      clearcoat: 0.4,
      clearcoatRoughness: 0.35,
    }),
  )
  board.rotation.x = -Math.PI / 2
  board.receiveShadow = true
  group.add(board)

  // 铜走线 + 流动数据光点
  const traces = {}
  const scratch = new THREE.Color()
  for (const key in CORE_POS) {
    const [x, z] = CORE_POS[key]
    const len = Math.hypot(x, z)

    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.02, len), materials.copper)
    strip.position.set(x / 2, 0.02, z / 2)
    strip.rotation.y = Math.atan2(x, z)
    group.add(strip)

    const points = []
    for (let i = 0; i < 2; i++) {
      const mat = makeLed(0xffffff, 2.6)
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 12), mat)
      mesh.visible = false
      group.add(mesh)
      points.push({ mesh, mat, t: i * 0.5 })
    }
    traces[key] = { x, z, strip, points }
  }

  function update(world, t, dt) {
    if (!world) return
    for (const c of world.cores) {
      const tr = traces[c.key]
      if (!tr) continue
      scratch.set(c.color)
      for (const pt of tr.points) {
        if (c.active) {
          pt.mesh.visible = true
          pt.mat.emissive.copy(scratch)
          pt.t = (pt.t + dt * 0.5) % 1
          pt.mesh.position.set(
            THREE.MathUtils.lerp(0, tr.x, pt.t),
            0.16,
            THREE.MathUtils.lerp(0, tr.z, pt.t),
          )
        } else {
          pt.mesh.visible = false
        }
      }
    }
  }

  return { group, update }
}

// —— 程序化 PCB 纹理 ——
function createPcbTexture(size) {
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const ctx = cv.getContext('2d')

  // 深色基底
  ctx.fillStyle = '#0a0f18'
  ctx.fillRect(0, 0, size, size)

  // 覆铜池（大块微差色，营造分区）
  ctx.fillStyle = 'rgba(18,44,38,0.32)'
  for (let i = 0; i < 7; i++) {
    const w = 120 + Math.random() * 260
    const h = 120 + Math.random() * 260
    fillRoundRect(ctx, Math.random() * (size - w), Math.random() * (size - h), w, h, 14)
  }

  // 丝印细网格
  ctx.strokeStyle = 'rgba(60,120,150,0.05)'
  ctx.lineWidth = 1
  for (let i = 0; i <= size; i += 32) {
    line(ctx, i, 0, i, size)
    line(ctx, 0, i, size, i)
  }

  // 铜走线束（直走 + 45° 折角）
  for (let b = 0; b < 26; b++) drawTraceBundle(ctx, size)

  // 过孔
  for (let i = 0; i < 150; i++) via(ctx, Math.random() * size, Math.random() * size)

  // 连接器排针金色焊盘
  for (let g = 0; g < 6; g++) padRow(ctx, Math.random() * size * 0.85, Math.random() * size * 0.85)

  // 丝印元件框
  ctx.strokeStyle = 'rgba(200,210,220,0.16)'
  ctx.lineWidth = 2
  for (let i = 0; i < 12; i++) {
    const w = 28 + Math.random() * 64
    const h = 18 + Math.random() * 44
    strokeRoundRect(ctx, Math.random() * (size - w), Math.random() * (size - h), w, h, 4)
  }

  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
}
function fillRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
  ctx.fill()
}
function strokeRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
  ctx.stroke()
}
function drawTraceBundle(ctx, size) {
  const n = 2 + Math.floor(Math.random() * 4)
  const gap = 4 + Math.random() * 4
  const x = Math.random() * size
  const y = Math.random() * size
  const horiz = Math.random() < 0.5
  const len1 = 60 + Math.random() * 180
  const len2 = 50 + Math.random() * 160
  const dir = Math.random() < 0.5 ? 1 : -1
  ctx.strokeStyle = 'rgba(184,115,51,' + (0.22 + Math.random() * 0.26).toFixed(2) + ')'
  ctx.lineWidth = 2
  ctx.shadowColor = 'rgba(184,115,51,0.5)'
  ctx.shadowBlur = 3
  for (let i = 0; i < n; i++) {
    const off = i * gap
    ctx.beginPath()
    if (horiz) {
      ctx.moveTo(x, y + off)
      ctx.lineTo(x + len1, y + off)
      ctx.lineTo(x + len1 + len2 * dir * 0.7, y + off + len2 * dir)
    } else {
      ctx.moveTo(x + off, y)
      ctx.lineTo(x + off, y + len1)
      ctx.lineTo(x + off + len2 * dir, y + len1 + len2 * dir * 0.7)
    }
    ctx.stroke()
  }
  ctx.shadowBlur = 0
}
function via(ctx, x, y) {
  ctx.beginPath()
  ctx.fillStyle = 'rgba(240,180,41,0.7)'
  ctx.arc(x, y, 2.6, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.fillStyle = '#0a0f18'
  ctx.arc(x, y, 1.1, 0, Math.PI * 2)
  ctx.fill()
}
function padRow(ctx, x, y) {
  const n = 4 + Math.floor(Math.random() * 8)
  ctx.fillStyle = 'rgba(240,180,41,0.6)'
  for (let i = 0; i < n; i++) ctx.fillRect(x + i * 7, y, 4, 12)
}
