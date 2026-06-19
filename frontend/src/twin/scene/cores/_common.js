import * as THREE from 'three'
import { makeLed } from '../materials.js'

/** 各核心通用的状态指示灯（小发光球）。idle 暗、active 亮（bloom）。 */
export function makeStatusLed(color, radius = 0.1) {
  const mat = makeLed(color, 0.4)
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 12), mat)
  return { mesh, mat }
}

/** 帧率无关的指数缓动。 */
export function ease(cur, target, dt, rate = 8) {
  return cur + (target - cur) * Math.min(1, dt * rate)
}
