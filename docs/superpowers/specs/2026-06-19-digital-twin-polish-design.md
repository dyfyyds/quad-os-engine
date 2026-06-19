# 数字孪生界面打磨 · 设计方案（Digital Twin Polish）

- 日期：2026-06-19
- 状态：待用户评审
- 目标分支：`feat/twin-polish`（实现阶段创建）
- 影响范围：仅数字孪生渲染层（`Twin3D.vue` / `DigitalTwin.vue` + 新增 `twin/scene/`）

## 1. 背景与目标

当前数字孪生页（`views/DigitalTwin.vue` + `views/Twin3D.vue` + `twin/world.js`）虽已有 3D 主板雏形，但被评价为「粗糙」，四个维度都需提升：**3D 建模与质感、整体氛围与构图、外围 UI、动效与交互**。

本次为**纯视觉 / 交互层重做**，把这一页打磨成一套**照片级真实硬件 + 暗色沉浸式控制台**。不改任何数据语义。

### 已锁定的决策（来自需求澄清）

| 决策点 | 结论 |
|---|---|
| 美学方向 | **A 照片级真实硬件**：真实 PCB / 铜 / 铝 / 金材质、PBR 质感、写实打光与阴影，辉光克制 |
| 页面外壳 | **暗色沉浸式控制台**：整页（仅孪生页）深色一体化；其它页面保持原浅色企业风 |
| 实现架构 | **方案 2 · 模块化重写**：拆成小型「孪生引擎」，`Twin3D.vue` 只剩挂载/生命周期 |
| 资源核心表达 | **综合方案**：写实 VRM 供电硬件作底 + 资源模块能量连线层（安全=青绿流动 / 死锁=红色闭环 + 散热块边缘转红） |

## 2. 非目标（明确不动）

- `twin/world.js` 的 `useOsWorld()` 数据契约与字段
- `store/os.js` 中央状态与所有指标语义
- `mock/driver.js` 数据源与后端引擎
- 除数字孪生页外的**所有其它页面**（Dashboard / 四核心页 / 算法页等）
- 共享组件 `SectionCard` / `EventFeed` / `StatCard` 等的**全局样式**（见 §6 作用域隔离）
- 不引入新的重型依赖（如 TresJS）；继续用 `three` 0.184 + addons
- 不依赖任何外部 HDR / 贴图资源文件（环境光照在本地程序化生成，适配离线环境）

## 3. 总体架构（方案 2 · 模块化孪生引擎）

把现 880 行的 `Twin3D.vue` 拆为：

```
frontend/src/twin/scene/
  engine.js        编排器：创建场景/相机/循环，对外暴露 mount/update/resize/dispose/focusCore/setView
  pipeline.js      渲染器 + 后期：WebGLRenderer、ACESFilmic、sRGB、PCFSoft 阴影、UnrealBloom、环境贴图(RoomEnvironment+PMREM)
  materials.js     统一 PBR 材质库：copper / aluminumBrushed / pcbGreen / pcbDark / gold / blackPlastic / silicon / chrome / led(color)
  stage.js         主板 PCB 平面 + 蚀刻铜走线 + 影棚地面 + 雾 + 同心导轨
  interactions.js  OrbitControls + Raycaster(hover/点击拾取) + 相机补间(聚焦/复位)
  cores/
    processor.js   处理机：CPU + 塔式散热
    memory.js      存储：DDR DIMM 模组
    resource.js    资源：VRM 供电 + 资源模块能量连线 + 死锁环
    device.js      设备：写实机械硬盘
    kernel.js      中央调度内核：SoC 主控芯片
```

`views/Twin3D.vue` 瘦身为：挂载容器 → `createTwinScene(container)` → `engine.mount(() => world.value)` → 生命周期里 `resize/dispose`。

### 引擎接口（保持「渲染无关」精神）

```
// engine.js
createTwinScene(container) → {
  mount(getWorld),        // getWorld: () => world.value；引擎内部 RAF 每帧读取最新快照（唯一数据入口）
  resize(),
  setView('3d'|'2d'),     // 切到 2d 时暂停渲染循环
  focusCore(key|null),    // 相机平滑聚焦某核心 / 复位
  dispose()
}
```

每个 core 模块统一签名，便于单独打磨与测试：

```
// cores/*.js
build({ scene, materials, env, core, position }) → {
  group,                       // 该核心的 THREE.Group（已 add 到 scene）
  update(coreState, t, dt),    // 每帧：状态高亮/动效；coreState = world.cores[key]
  focusOffset                  // 该核心聚焦时的相机目标偏移
}
```

> 与 `docs/数字孪生架构.md` 的关系：本次属于其「渲染层」内部重构，符合该文档「加一个渲染器只需消费 `useOsWorld()`」的扩展约定；数据源层与世界模型层零改动。

## 4. 渲染管线升级（照片级关键，`pipeline.js`）

| 项 | 现状 | 升级 |
|---|---|---|
| 材质 | `MeshStandardMaterial` 基础 | `MeshPhysicalMaterial`：metalness/roughness/clearcoat 分通道，金属拉丝、PCB 半哑光、金手指高反 |
| 环境反射 | 无 | `RoomEnvironment` + `PMREMGenerator` 程序化中性影棚环境贴图，金属/盘片真实环境映像（无外部文件） |
| 色调映射 | 默认线性 | `ACESFilmicToneMapping` + `outputColorSpace = SRGB`，电影级影调 |
| 阴影 | 无 | `DirectionalLight.castShadow` + `PCFSoftShadowMap`，元件在主板投柔和接触阴影 |
| 辉光 | 无 | `EffectComposer` + `UnrealBloomPass`（低阈值/低强度）+ `OutputPass`，只让 LED/指示灯/内核微溢出 |
| 抗锯齿/性能 | antialias | antialias + `setPixelRatio(min(2, dpr))` |
| 灯光 | 2 盏 | 主平行光(带阴影) + 补光 + 内核点光 + 环境贴图整体照明，三点布光 |

## 5. 四核心 + 中央内核 · 写实重建（`cores/`）

通用：所有金属件吃环境反射；落在主板上投接触阴影；`active` 时该核心轻微抬升 + 关键件 emissive 提亮（缓动）。

- **处理机 `processor.js`**：真实 CPU——带激光蚀刻字样的 IHS 金属顶盖、插座金针；塔式散热器（铜底 + 弯折热管 + 密集铝鳍片 + 缓转风扇）。负载↑ → 风扇转速↑ + 硅片暖光。
- **存储 `memory.js`**：写实 DDR DIMM——金属马甲拉丝、防呆缺口、底部金手指、顶部 RGB 导光条（柔和扩散）。原「页面块」改为沿模组上升的半透数据流颗粒；缺页 → 脉冲。
- **资源 `resource.js`（综合方案）**：
  - **硬件底**：写实 VRM 供电区——封闭式电感阵列、固态电容、低矮芯片组散热块（金属拉丝 + 接触阴影）。
  - **能量连线层**：散热块上方布置数枚「资源模块」节点，模块间连能量走线。
  - **状态编码**：`safe` → 走线青绿、能量光点平滑环流（银行家放行）；`deadlock` → 相关走线连成**红色闭环**（循环等待）+ 散热块边缘转红 + 节点告警脉冲。
- **设备 `device.js`**：写实机械硬盘——高反盘片（吃环境反射）、真实作动臂（含减重孔）、PCB 底板、SATA 接口、顶部贴纸标签。盘片随 `running` 高速转；磁头按 `disk.head` 平滑寻道。
- **中央内核 `kernel.js`**：去掉科幻陀螺三环，改为一枚高级 **SoC 主控芯片**——玻璃封顶 + 硅片纹理 + 金属基板 + 克制青绿呼吸光（频率随 `cpuUtil`）。作为「调度大脑」，统领四核心。
- **总线（`stage.js`）**：去掉发光圆管，改为主板上**蚀刻的铜走线**连接内核与四核心；`active` 时沿线跑数据光点（带缓动）。

## 6. 暗色沉浸控制台 · 外壳（`DigitalTwin.vue`）

整页（仅本页）换深色一体化布局。

- **顶部**：标题区 +「运行中/已暂停 · 虚拟时钟」状态 + 3D/2D 切换（暗色玻璃胶囊）。
- **主舞台**：3D 视口铺满；四角浮 **HUD 信息卡**（各核心实时指标，暗色玻璃）；中央内核读数卡。
- **底部**：左 = 联动事件流（暗色）；右 = 孪生数据源 + 图例（暗色）。
- **CSS2D 标签**：保留并精修——更细描边、状态色、活跃微动。
- **2D 视图**：同步改深色，作为 WebGL 兜底，风格与 3D 统一。

### 作用域隔离（关键，防止波及其它页面）

- 不修改共享组件 `SectionCard` / `EventFeed` 的全局样式，孪生页也不复用它们的浅色版本。
- 孪生页所有暗色 UI 收敛在 `.twin-console` 根容器内：`DigitalTwin.vue` 的 `scoped` 样式 + 本页局部暗色 token；若某卡片需复用再抽到 `twin/widgets/`。
- 验收时需对比改动前后其它页面截图一致。

## 7. 动效与交互（`interactions.js` + 各 update）

- **相机**：更好的默认机位 + 进入时缓推镜头；空闲时极缓自动环绕（可一键关）。
- **点击核心 → 平滑聚焦**：相机补间到该核心 `focusOffset`，对应 HUD 卡高亮；点空白复位。
- **hover**：核心轻微抬起 + 描边高亮 + 光标 `pointer`。
- **数据流**：沿铜走线的光点随 `active` 流动，缓动非线性。
- **状态驱动**（全部缓动，不闪）：死锁红 / 缺页脉冲 / CPU 负载→内核呼吸频率 / 磁头平滑寻道。

## 8. 性能与兼容（`pipeline.js` + `engine.js`）

- `setPixelRatio(min(2, devicePixelRatio))`。
- 切到 2D 视图 / 页面 `visibilitychange` 隐藏 / 路由离开 → 暂停 RAF。
- 严格 `dispose`：几何、材质、贴图、`RenderTarget`、`PMREMGenerator`、composer，防 WebGL 上下文泄漏。
- WebGL 不可用 → 回退 2D（保留现有检测与提示）。
- bloom/阴影分辨率取保守值；必要时预留「画质」降级开关（低配关阴影/后期）。

## 9. 验收标准（可验证）

1. `npm run dev` 启动，孪生页加载，**控制台无报错**。
2. 3D 场景：金属/盘片可见环境反射；元件有柔和接触阴影；ACES 影调（非死黑/过曝）。
3. 四核心 + 内核均按 §5 重建；总线为铜走线 + 流动光点。
4. 资源核心：默认显示青绿能量环流；将 store `resources.deadlock` 置真 → 出现**红色闭环** + 散热块转红。
5. 暗色外壳：本页深色一体；HUD 卡、事件流、数据源、2D 视图均暗色统一。
6. **其它页面（Dashboard / 四核心页等）视觉与改动前一致**（截图对比）。
7. 交互：点击核心相机平滑聚焦并复位；hover 高亮；`active` 时走线光点流动。
8. 性能：`pixelRatio ≤ 2`；切 2D / 隐藏页面时 RAF 暂停；路由离开后无上下文泄漏（dispose 生效）。
9. `git diff` 显示 `world.js` / `store/os.js` / 其它页面文件**无改动**（除 `DigitalTwin.vue`/`Twin3D.vue` 及新增 `twin/scene/`、`twin/widgets/`）。

## 10. 风险与缓解

- **性能**：bloom + 阴影 + 环境贴图在弱 GPU 上掉帧 → 像素比封顶、保守后期分辨率、画质降级开关、切 2D/隐藏暂停。
- **addons 导入路径**：`RoomEnvironment` / `UnrealBloomPass` / `OutputPass` 需确认 `three@0.184` 的 `three/addons/...` 路径正确（实现首步先验证）。
- **CSS2D 标签暗色可读性**：在亮色元件上方需保证对比度。
- **资源核心语义**：VRM 写实化后仍需让「死锁环」足够醒目，避免被硬件细节淹没。

## 11. 相关文件

- 现有渲染层：`frontend/src/views/Twin3D.vue`、`frontend/src/views/DigitalTwin.vue`
- 世界模型（不动）：`frontend/src/twin/world.js`
- 状态契约（不动）：`frontend/src/store/os.js`、`docs/接口契约.md`
- 架构参考：`docs/数字孪生架构.md`
- 主题变量：`frontend/src/styles/theme.css`（新增暗色变量，不改现有浅色变量）
