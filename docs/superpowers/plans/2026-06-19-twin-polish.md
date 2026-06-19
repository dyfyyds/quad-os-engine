# 数字孪生界面打磨 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把数字孪生页重做成「照片级真实硬件 + 暗色沉浸式控制台」,渲染层模块化,数据层零改动。

**Architecture:** 新建 `twin/scene/` 小型孪生引擎(pipeline/materials/stage/cores/interactions/engine),`Twin3D.vue` 瘦身为挂载层,`DigitalTwin.vue` 改暗色外壳。消费现有 `useOsWorld()`,不碰 store/world.js/其它页面。

**Tech Stack:** Vue 3 + Three.js 0.184(addons: EffectComposer/UnrealBloomPass/OutputPass/RoomEnvironment/PMREMGenerator/OrbitControls/CSS2DRenderer)。

**验证方式(本任务为视觉/3D 工作,非单元测试):** 每阶段 = `npm run dev` 启动 → 浏览器打开 `/twin` → Playwright 截图核对 → 控制台**零报错** → 提交。最终 `git diff` 确认 world.js/store/其它页面未改、其它页面截图一致。

参考 spec:`docs/superpowers/specs/2026-06-19-digital-twin-polish-design.md`

---

## 文件结构

**新建**
- `frontend/src/twin/scene/pipeline.js` — 渲染器/色调映射/阴影/环境贴图/后期(bloom)
- `frontend/src/twin/scene/materials.js` — PBR 材质库(单例复用)
- `frontend/src/twin/scene/stage.js` — PCB 主板 + 铜走线 + 地面 + 雾
- `frontend/src/twin/scene/cores/kernel.js` — 中央 SoC 主控
- `frontend/src/twin/scene/cores/processor.js` — CPU + 塔式散热
- `frontend/src/twin/scene/cores/memory.js` — DDR 内存条
- `frontend/src/twin/scene/cores/device.js` — 机械硬盘
- `frontend/src/twin/scene/cores/resource.js` — VRM 供电 + 资源能量环/死锁环
- `frontend/src/twin/scene/interactions.js` — OrbitControls + 拾取 + 相机补间
- `frontend/src/twin/scene/engine.js` — 编排器(对外接口)

**修改**
- `frontend/src/views/Twin3D.vue` — 瘦身为引擎挂载层
- `frontend/src/views/DigitalTwin.vue` — 暗色沉浸外壳 + 2D 暗色

**不动(验收断言)**
- `frontend/src/twin/world.js`、`frontend/src/store/os.js`、其它所有 `views/*`、共享 `widgets/*` 全局样式

---

## Phase 1 — 引擎骨架 + 渲染管线 + 材质库

**目标 checkpoint:** 页面渲染出暗色影棚空舞台(地面 + 雾 + 环境光 + 一个测试球带真实反射),OrbitControls 可拖,控制台零报错。

### Task 1.1: 材质库 `materials.js`

**Files:** Create `frontend/src/twin/scene/materials.js`

- [ ] 导出 `createMaterials()`,返回单例 PBR 材质对象(`MeshPhysicalMaterial`):
  - `copper` { color:0xb87333, metalness:0.95, roughness:0.32, clearcoat:0.3 }
  - `aluminum` { color:0xc7ccd1, metalness:0.9, roughness:0.42 }(拉丝感后续可加 anisotropy)
  - `pcbGreen` { color:0x0b3d2e, metalness:0.0, roughness:0.6, clearcoat:0.5, clearcoatRoughness:0.3 }
  - `pcbDark` { color:0x0a0f1a, metalness:0.1, roughness:0.7 }
  - `gold` { color:0xf0b429, metalness:1.0, roughness:0.25 }
  - `blackPlastic` { color:0x14181f, metalness:0.0, roughness:0.55 }
  - `silicon` { color:0x1b2430, metalness:0.6, roughness:0.18, clearcoat:1, clearcoatRoughness:0.1 }
  - `chrome` { color:0xe8edf2, metalness:1, roughness:0.08 }
  - `led(color, intensity=1)` 工厂 → `MeshStandardMaterial`{ emissive, emissiveIntensity, color:0x000000 }(供 bloom)
- [ ] 导出 `disposeMaterials(mats)` 遍历 dispose。

### Task 1.2: 渲染管线 `pipeline.js`

**Files:** Create `frontend/src/twin/scene/pipeline.js`

- [ ] `createPipeline(canvasEl, { width, height })` →
  - `WebGLRenderer({ antialias:true, alpha:true })`;`setPixelRatio(Math.min(2, dpr))`;`toneMapping = ACESFilmicToneMapping`;`toneMappingExposure ≈ 1.0`;`outputColorSpace = SRGBColorSpace`;`shadowMap.enabled = true`,`type = PCFSoftShadowMap`。
  - 环境:`PMREMGenerator.fromScene(new RoomEnvironment(), 0.04)` → 返回 `envTexture`(赋给 `scene.environment`)。
  - 后期:`EffectComposer` + `RenderPass` + `UnrealBloomPass(resolution, strength≈0.5, radius≈0.5, threshold≈0.85)` + `OutputPass`。
  - 返回 `{ renderer, composer, envTexture, render(scene,camera), setSize(w,h), dispose() }`(`dispose` 释放 renderer/composer/pmrem/envTexture)。
- [ ] try/catch WebGL 创建失败 → 抛错,供 engine 回退。

### Task 1.3: 引擎编排 `engine.js`

**Files:** Create `frontend/src/twin/scene/engine.js`

- [ ] `createTwinScene(container)` →
  - 建 `Scene`(`fog = FogExp2(0x05080f, 0.012)`)、`PerspectiveCamera(46, ...)`、调 `createPipeline`、`createMaterials`、`setupLights(scene)`(主平行光带阴影 + 补光 + 内核点光)。
  - `mount(getWorld)`:存 getWorld;建 stage/kernel/cores(后续 Phase 接入);启动 RAF `loop`。
  - `loop`:`const w = getWorld()`;调各 `update(w, t, dt)`;`controls.update()`;`composer.render()`;`labelRenderer.render()`。
  - `setView(mode)`:`'2d'` 暂停 RAF,`'3d'` 恢复。
  - `resize()` / `focusCore(key)`(Phase 4 接 interactions) / `dispose()`(cancel RAF、dispose pipeline/materials/labelRenderer、遍历 scene dispose 几何材质、移除 DOM 与 listeners)。
- [ ] `visibilitychange` 隐藏暂停、可见恢复。

### Task 1.4: `Twin3D.vue` 瘦身接线

**Files:** Modify `frontend/src/views/Twin3D.vue`

- [ ] 删除内部所有建模/动画代码,改为:`onMounted` → `engine = createTwinScene(container.value)`;`engine.mount(() => world.value)`;`onActivated`/resize → `engine.resize()`;`onBeforeUnmount` → `engine.dispose()`;WebGL 失败 → `failed=true` 显示回退。

### Task 1.5: Phase 1 验证 + 提交

- [ ] 临时在 stage 放一个 `chrome` 测试球验证环境反射。
- [ ] Run: `cd frontend && npm run dev`;Playwright 打开孪生页截图;确认暗色舞台 + 球面反射 + 可拖动 + **控制台零报错**。
- [ ] Commit: `feat(twin): 孪生引擎骨架+PBR管线+材质库`

---

## Phase 2 — 主板舞台 + 中央内核

**checkpoint:** 写实 PCB 主板(铜走线)+ 地面接触阴影 + 中央 SoC 主控(青绿呼吸光)。

### Task 2.1: `stage.js`
**Files:** Create `frontend/src/twin/scene/stage.js`
- [ ] `buildStage(scene, materials, world)`:PCB 平面(程序化 canvas 纹理:深底 + 精细网格 + 蚀刻走线 + 焊盘,作为 `map`/`roughnessMap`);`receiveShadow`。影棚地面(更暗,接收阴影)。内核↔四核心的**铜走线**(扁平 `TubeGeometry`/`PlaneGeometry` 贴板)+ 沿线数据光点(`led` 材质小球,`update` 中按 `core.active` 流动)。
- [ ] 返回 `{ group, update(world,t,dt) }`(光点流动 + 走线活跃亮度)。

### Task 2.2: `cores/kernel.js`
**Files:** Create `frontend/src/twin/scene/cores/kernel.js`
- [ ] SoC:金属基板 + 硅片(`silicon`)+ 玻璃封顶(透明 `MeshPhysicalMaterial` transmission)+ 克制青绿 `led` 呼吸(频率随 `world.cpuUtil`);`castShadow`。CSS2D 标签(系统调度核心 + CPU负载/时钟)。
- [ ] 返回 `{ group, update(world,t,dt), labelDiv }`。

### Task 2.3: 接入 engine + 验证 + 提交
- [ ] engine.mount 中调 buildStage/kernel,加入 update 列表。
- [ ] dev + 截图:主板纹理清晰、走线流光、内核呼吸、元件投影。零报错。
- [ ] Commit: `feat(twin): 写实PCB主板+铜走线+中央SoC内核`

---

## Phase 3 — 四核心写实重建(逐个,逐个截图+提交)

每个 core 模块统一签名 `build({ scene, materials, env, core, position }) → { group, update(coreState,t,dt), focusOffset }`,落板投影,`active` 时缓动抬升 + 关键件提亮,带 CSS2D 标签。

### Task 3.1: `cores/processor.js`(CPU + 塔式散热)
- [ ] CPU:`socket`(blackPlastic)+ 金针阵列 + IHS 顶盖(aluminum,顶面 canvas 蚀刻字纹理);塔式散热:铜底 + 弯折热管(copper)+ 密集铝鳍片(aluminum)+ 风扇(`update` 随 `cpuUtil` 转速)。die 暖光随负载。
- [ ] 接入 engine、dev+截图、Commit `feat(twin): 写实CPU处理机核心`

### Task 3.2: `cores/memory.js`(DDR DIMM)
- [ ] 内存插槽 + 2 条 DIMM:PCB(pcbGreen)+ 金手指(gold)+ 防呆缺口 + 金属马甲(aluminum 拉丝)+ 顶部 RGB 导光条(`led`,柔和)。数据流颗粒沿条上升;缺页脉冲。
- [ ] 接入、dev+截图、Commit `feat(twin): 写实DDR内存核心`

### Task 3.3: `cores/device.js`(机械硬盘)
- [ ] 铝机框 + 高反盘片(`chrome`/高 metalness 吃环境反射)+ 主轴螺母 + 作动臂(减重孔)+ 磁头滑块 + PCB 底 + SATA 口 + 顶部贴纸(canvas 纹理)。`running` 盘片转;`disk.head` 平滑寻道;读写指示 `led` 闪。
- [ ] 接入、dev+截图、Commit `feat(twin): 写实机械硬盘设备核心`

### Task 3.4: `cores/resource.js`(VRM + 死锁环,综合方案)
- [ ] **硬件底**:VRM——封闭电感阵列(blackPlastic/aluminum)+ 固态电容(铝壳 + 顶部十字刻痕)+ 低矮芯片组散热块(aluminum,可投影)。
- [ ] **能量层**:散热块上方 N 个资源模块节点(金属小块 + `led`);模块间能量走线(`Line`/细管)。
- [ ] **状态**:`core.metric==='安全'` → 走线青绿 + 光点平滑环流;`'死锁'` → 相关走线连成**红色闭环** + 散热块边缘 emissive 转红 + 节点告警脉冲。读取 `core.color`(死锁时 store 已给红)。
- [ ] 接入、dev+截图(并临时置 `resources.deadlock=true` 验证红环)、Commit `feat(twin): 资源核心VRM供电+死锁环`

---

## Phase 4 — 相机与交互 `interactions.js`

**checkpoint:** 点击核心平滑聚焦、hover 高亮、空闲缓慢环绕。

### Task 4.1: `interactions.js`
**Files:** Create `frontend/src/twin/scene/interactions.js`
- [ ] `setupInteractions({ camera, controls, dom, pickables })`:`Raycaster` 处理 `pointermove`(hover→描边/光标)与 `click`(命中→`focusCore`,空白→复位)。相机补间:用 `lerp` 在 loop 中逼近 `targetPos/targetLook`(到位停止)。空闲计时 → 极缓 `controls.autoRotate`(可关)。
- [ ] 暴露 `update(dt)`、`focus(key|null)`、`setHovered(key)`。engine.focusCore 转调。

### Task 4.2: 接入 + 验证 + 提交
- [ ] engine 把 cores 的可拾取 mesh 注册进 interactions;loop 调 interactions.update。
- [ ] dev + 交互录屏/截图:点击聚焦、hover 高亮、复位。零报错。
- [ ] Commit: `feat(twin): 相机聚焦+hover拾取+空闲环绕`

---

## Phase 5 — 暗色沉浸控制台外壳 `DigitalTwin.vue`

**checkpoint:** 整页暗色一体;HUD 卡/事件流/数据源/2D 视图统一暗色;**其它页面不受影响**。

### Task 5.1: 暗色外壳 + HUD
**Files:** Modify `frontend/src/views/DigitalTwin.vue`
- [ ] 根容器 `.twin-console`(深色渐变背景);所有暗色样式 `scoped` 收敛其内,**不复用浅色 SectionCard/EventFeed**。
- [ ] 顶部:标题 + 运行/时钟 + 3D/2D 暗色玻璃胶囊切换(切换调 `engine.setView`)。
- [ ] 四角 HUD 卡(各核心实时指标,暗色玻璃)+ 中央内核读数;底部左事件流(暗色版)、右数据源 + 图例(暗色)。
- [ ] CSS2D 标签样式精修(更细描边、状态色、活跃微动)。

### Task 5.2: 2D 视图暗色化
- [ ] 现有 SVG 2D 配色改暗色(底板/边/卡/文字),作为 WebGL 兜底,与 3D 统一。

### Task 5.3: 验证 + 提交
- [ ] dev + 截图孪生页(暗色一体)。
- [ ] **截图 Dashboard / 四核心页 / 一个算法页**,与改动前对比无变化。
- [ ] Commit: `feat(twin): 暗色沉浸控制台外壳+HUD+2D暗色`

---

## Phase 6 — 性能 / 释放 / 兼容 + 终验

### Task 6.1: 性能与释放
- [ ] 确认 `pixelRatio ≤ 2`;切 2D / 页面隐藏 / 路由离开 → RAF 暂停;`engine.dispose()` 释放 renderer/composer/pmrem/env/几何/材质/贴图/labelRenderer 与监听。
- [ ] WebGL 不可用 → 自动回退 2D(保留检测提示)。

### Task 6.2: 终验(对照 spec §9 验收标准)
- [ ] 1 控制台零报错;2 金属/盘片见反射、有接触阴影、ACES 影调;3 四核心+内核+铜走线齐;4 死锁红环可现;5 暗色外壳统一;6 其它页面截图一致;7 点击聚焦/hover/流光;8 pixelRatio≤2 且暂停生效、无上下文泄漏;9 `git diff` 不含 world.js/store/其它页面。
- [ ] Commit: `chore(twin): 性能释放与兼容收尾` + 更新截图到 `screenshots/`。

---

## 自检备注
- 风险:`RoomEnvironment` 在 0.184 为 `new RoomEnvironment()`(无 renderer 参);bloom 让自发光件用纯黑 base + emissive 才不过曝;CSS2D 标签在亮色元件上需保证对比度;死锁红环勿被 VRM 细节淹没。
- DRY:材质统一走 `materials.js`;canvas 纹理生成函数集中。
- 频繁提交:每个 core / 每个 phase 一提交。
