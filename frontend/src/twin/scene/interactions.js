import * as THREE from 'three'

/**
 * 相机与拾取交互：
 *  - hover：射线命中核心 → 光标 pointer + 该核心轻微放大
 *  - 点击核心 → 相机平滑补间聚焦；点击空白 → 复位到默认机位
 *  - 空闲数秒 → 极缓自动环绕（任何指针操作即停）
 *
 * setupInteractions({ camera, controls, dom, pickables, home }) → { update(dt), focus(key|null), dispose }
 *   pickables: [{ key, object(THREE.Object3D), focusPoint(Vector3 世界坐标) }]
 *   home: { pos:Vector3, look:Vector3 } 默认机位与注视点
 */
export function setupInteractions({ camera, controls, dom, pickables, home }) {
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  const objects = pickables.map((p) => p.object)

  let hoveredKey = null
  let focusKey = null
  let tweening = false
  const targetPos = new THREE.Vector3()
  const targetLook = new THREE.Vector3()
  const homePos = home.pos.clone()
  const homeLook = home.look.clone()

  let idle = 0
  const IDLE_DELAY = 6

  function focus(key) {
    focusKey = key
    tweening = true
    controls.enabled = false
    controls.autoRotate = false
    if (key) {
      const p = pickables.find((x) => x.key === key)
      if (!p) { focus(null); return }
      const cp = p.focusPoint
      const outward = new THREE.Vector3(cp.x, 0, cp.z)
      if (outward.lengthSq() < 0.01) outward.set(0, 0, 1)
      outward.normalize()
      targetLook.copy(cp)
      targetPos.copy(cp).addScaledVector(outward, 8).add(new THREE.Vector3(0, 6, 0))
    } else {
      targetLook.copy(homeLook)
      targetPos.copy(homePos)
    }
  }

  function setNdc(e) {
    const r = dom.getBoundingClientRect()
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1
    pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1
  }
  function pick() {
    raycaster.setFromCamera(pointer, camera)
    const hits = raycaster.intersectObjects(objects, true)
    if (!hits.length) return null
    let o = hits[0].object
    while (o) {
      const p = pickables.find((x) => x.object === o)
      if (p) return p.key
      o = o.parent
    }
    return null
  }

  let downX = 0, downY = 0, downT = 0
  function onMove(e) {
    setNdc(e)
    hoveredKey = pick()
    dom.style.cursor = hoveredKey ? 'pointer' : ''
    idle = 0
    controls.autoRotate = false
  }
  function onDown(e) {
    downX = e.clientX; downY = e.clientY; downT = performance.now()
    idle = 0
    controls.autoRotate = false
  }
  function onUp(e) {
    const dist = Math.hypot(e.clientX - downX, e.clientY - downY)
    if (dist < 5 && performance.now() - downT < 350) {
      setNdc(e)
      focus(pick()) // 命中核心则聚焦；空白则 null → 复位
    }
  }
  dom.addEventListener('pointermove', onMove)
  dom.addEventListener('pointerdown', onDown)
  dom.addEventListener('pointerup', onUp)

  function update(dt) {
    if (tweening) {
      const k = Math.min(1, dt * 3)
      camera.position.lerp(targetPos, k)
      controls.target.lerp(targetLook, k)
      camera.lookAt(controls.target)
      if (camera.position.distanceTo(targetPos) < 0.15 && controls.target.distanceTo(targetLook) < 0.1) {
        camera.position.copy(targetPos)
        controls.target.copy(targetLook)
        camera.lookAt(controls.target)
        tweening = false
        controls.enabled = true
      }
    }

    // hover 轻微放大（与 active 抬升互不干扰）
    for (const p of pickables) {
      const cur = p.object.userData._hoverScale ?? 1
      const target = p.key === hoveredKey && !tweening ? 1.04 : 1.0
      const ns = cur + (target - cur) * Math.min(1, dt * 8)
      p.object.userData._hoverScale = ns
      p.object.scale.setScalar(ns)
    }

    // 空闲自动环绕
    if (!tweening && focusKey === null) {
      idle += dt
      if (idle > IDLE_DELAY) {
        controls.autoRotate = true
        controls.autoRotateSpeed = 0.5
      }
    }

    return tweening
  }

  function dispose() {
    dom.removeEventListener('pointermove', onMove)
    dom.removeEventListener('pointerdown', onDown)
    dom.removeEventListener('pointerup', onUp)
  }

  return {
    update,
    focus,
    dispose,
    state: () => ({ focusKey, tweening, target: targetPos.toArray().map((n) => Math.round(n * 10) / 10), keys: pickables.map((p) => p.key) }),
  }
}
