/** 四核心在主板上的平面坐标（XZ），中央内核在原点。各建模模块共享。 */
export const KERNEL_POS = [0, 0]

export const CORE_POS = {
  processor: [-8, -8],
  memory: [8, -8],
  resource: [-8, 8],
  device: [8, 8],
}
