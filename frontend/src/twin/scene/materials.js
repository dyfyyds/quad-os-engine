import * as THREE from 'three'

/**
 * 统一 PBR 材质库（单例复用）。
 *
 * 所有金属 / PCB / 塑料 / 硅 材质集中在此，配合 scene.environment 上挂载的
 * 程序化影棚环境贴图（见 pipeline.js），产生照片级的反射与质感。
 * 自发光件统一用「纯黑 base + emissive」，这样配合 bloom 才会发光而不过曝。
 */
export function createMaterials() {
  const P = THREE.MeshPhysicalMaterial
  return {
    // 暖金属铜（热管 / 走线）
    copper: new P({ color: 0xb87333, metalness: 0.95, roughness: 0.32, clearcoat: 0.3, clearcoatRoughness: 0.25 }),
    // 拉丝铝（散热器 / 马甲 / 框架）
    aluminum: new P({ color: 0xc7ccd1, metalness: 0.9, roughness: 0.42 }),
    aluminumDark: new P({ color: 0x6b7280, metalness: 0.85, roughness: 0.5 }),
    // PCB 板：半哑光 + 清漆层
    pcbGreen: new P({ color: 0x0b3d2e, metalness: 0.0, roughness: 0.6, clearcoat: 0.5, clearcoatRoughness: 0.3 }),
    pcbDark: new P({ color: 0x0a0f1a, metalness: 0.1, roughness: 0.7 }),
    // 金手指
    gold: new P({ color: 0xf0b429, metalness: 1.0, roughness: 0.25 }),
    // 黑塑料（插座 / 电感外壳）
    blackPlastic: new P({ color: 0x14181f, metalness: 0.0, roughness: 0.55 }),
    // 硅片镜面
    silicon: new P({ color: 0x1b2430, metalness: 0.6, roughness: 0.18, clearcoat: 1.0, clearcoatRoughness: 0.1 }),
    // 高反铬（盘片 / 镜面件）
    chrome: new P({ color: 0xe8edf2, metalness: 1.0, roughness: 0.08 }),
    // 玻璃封顶（SoC / 罩）
    glass: new P({ color: 0xffffff, metalness: 0, roughness: 0.05, transmission: 0.9, thickness: 0.5, transparent: true, opacity: 0.45 }),
    // 锡焊点 / 焊球（BGA 球栅阵列）
    solder: new P({ color: 0xb0b8bf, metalness: 0.85, roughness: 0.35 }),
    // 拉丝铜走线（总线车道）—— 比 copper 暗一点突出多车道层次
    copperTrace: new P({ color: 0xa86833, metalness: 0.92, roughness: 0.38, clearcoat: 0.2, clearcoatRoughness: 0.35 }),
    // 北桥 / 南桥芯片散热盖 —— 拉丝铝磨砂
    bridgeIHS: new P({ color: 0xa5a9ad, metalness: 0.92, roughness: 0.5 }),
    // RGB 光导 / 半透明扩散罩
    diffuser: new P({ color: 0xffffff, metalness: 0, roughness: 0.15, transmission: 0.55, thickness: 0.3, transparent: true, opacity: 0.6 }),
    // 黑色橡胶 / 软导轨（保持框衬垫、缓震圈）
    rubber: new P({ color: 0x18181c, metalness: 0.0, roughness: 0.95 }),
    // 标签贴纸（盘面 / SSD 顶贴）
    labelPaper: new P({ color: 0xe7e9ec, metalness: 0.0, roughness: 0.8 }),
  }
}

/**
 * 自发光材质工厂（LED / 导光条 / 指示灯 / 数据光点）。
 * 纯黑 base + emissive，交给 UnrealBloomPass 产生克制辉光。
 */
export function makeLed(color, intensity = 1) {
  return new THREE.MeshStandardMaterial({
    color: 0x000000,
    emissive: new THREE.Color(color),
    emissiveIntensity: intensity,
  })
}

export function disposeMaterials(mats) {
  Object.values(mats).forEach((m) => m && m.dispose && m.dispose())
}
