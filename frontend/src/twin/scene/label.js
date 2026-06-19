import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'

/**
 * 创建一个 CSS2D 浮动标签。返回 { obj, div }：
 * obj 加入场景参与三维定位，div 用于每帧写入 innerHTML。
 * 样式见 Twin3D.vue 的全局 .twin3d-label。
 */
export function makeLabel(extraClass) {
  const div = document.createElement('div')
  div.className = 'twin3d-label' + (extraClass ? ' ' + extraClass : '')
  const obj = new CSS2DObject(div)
  return { obj, div }
}
