/**
 * 中央 OS 状态的初始种子数据（mock）。
 *
 * seedState(cfg) —— 不传参用出厂默认；传入 config 时按其重建 memory/disk，
 * 让「系统设置」页保存配置后真正驱动模拟（详见 store.applyConfig 与 docs/接口契约.md）。
 *
 * 确定性：所有「随机」初始化均走传入的种子 PRNG（makeRng），使整段仿真可复现，
 * 并与后端整拍引擎前后端 parity 一致（详见 docs/superpowers/specs/2026-06-20-...）。
 */
import { makeRng } from './rng.js'

// 未显式传 rng 时的兜底（保持旧的非确定性行为，仅供 seed.js 之外的偶发调用）。
const MATH_RNG = { next: () => Math.random() }

// 动态页面流生成器：模拟真实 OS 程序的访存特征（时间局部性、空间局部性、不可预测分支）
export function generateDynamicRefString(length = 20, maxPage = 7, rng = MATH_RNG) {
  const refs = []
  let currentPage = Math.floor(rng.next() * (maxPage + 1))

  while (refs.length < length) {
    const rand = rng.next()
    if (rand < 0.45) {
      // 1. 空间局部性：顺序访问相邻页面 (例如数组遍历、指令顺序执行)
      const subLen = Math.min(3 + Math.floor(rng.next() * 4), length - refs.length)
      const direction = rng.next() < 0.5 ? 1 : -1
      for (let i = 0; i < subLen; i++) {
        currentPage = (currentPage + direction + maxPage + 1) % (maxPage + 1)
        refs.push(currentPage)
      }
    } else if (rand < 0.85) {
      // 2. 时间局部性：循环访问一小组页面 (例如循环体中的代码或变量)
      const loopLen = 2 + Math.floor(rng.next() * 2) // 2 或 3 个页面
      const loopPages = []
      for (let i = 0; i < loopLen; i++) {
        loopPages.push(Math.floor(rng.next() * (maxPage + 1)))
      }
      const iterations = Math.min(2 + Math.floor(rng.next() * 3), Math.ceil((length - refs.length) / loopLen))
      for (let r = 0; r < iterations; r++) {
        for (const p of loopPages) {
          if (refs.length < length) {
            refs.push(p)
          }
        }
      }
    } else {
      // 3. 不可预测分支跳转：模拟 if-else 分支转移
      const pA = Math.floor(rng.next() * (maxPage + 1))
      const pB = Math.floor(rng.next() * (maxPage + 1))
      const count = Math.min(2 + Math.floor(rng.next() * 3), length - refs.length)
      for (let i = 0; i < count; i++) {
        const p = rng.next() < 0.7 ? pA : pB // 70% 走主分支，30% 走备用分支
        refs.push(p)
      }
    }
  }
  return refs
}

// —— 出厂默认配置（也是「重置模拟」的基线）——
export const DEFAULT_CONFIG = {
  quantum: 2,
  frameCount: 4,         // 内存（物理）块数（< 访问串去重页数，确保发生缺页置换/调出/写回）
  blockSize: 128,        // 块长（页/物理块字节数）—— 地址转换：绝对地址 = 主存块号 × 块长 + 单元号
  resTotal: 10,
  cylinders: 200,        // 柱面总数（移臂调度的定位维度）
  tracksPerCyl: 4,       // 每柱面磁道数（磁头数）
  recordsPerTrack: 8,    // 每磁道物理记录数（扇区）
  schedAlgo: 'RR',
  pageAlgo: 'LRU',
  diskAlgo: 'SCAN',
  clockSpeed: 1,
  rngSeed: 0x9e3779b9,   // 种子 PRNG 初值（决定整段仿真的"随机"序列，可复现）
  processAutoArrival: false,
  dynamicPages: true,    // 是否启用动态页面访问流（模拟真实OS访存）
  // —— 可编辑的实验数据 ——
  processes: [                                       // 处理机调度实验进程表（pvRole: producer/consumer/'' 决定是否参与 PV 同步）
    { pid: 1, name: 'init', arrival: 0, burst: 12, priority: 1, pvRole: '' },
    { pid: 2, name: 'shell', arrival: 0, burst: 6, priority: 2, pvRole: 'consumer' },
    { pid: 3, name: 'editor', arrival: 0, burst: 9, priority: 4, pvRole: '' },
    { pid: 4, name: 'logger', arrival: 0, burst: 5, priority: 2, pvRole: 'producer' },
    { pid: 5, name: 'daemon', arrival: 0, burst: 7, priority: 3, pvRole: 'producer' },
  ],
  refStringText: '7,0,1,2,0,3,0,4,2,3,0,3,2,1,2',  // 页面访问串（逗号分隔）
  ioRequests: [                                     // I/O 请求队列（驱动调度）
    { 进程名: '进程1', 柱面号: 98, 磁道号: 2, 物理记录号: 3 },
    { 进程名: '进程2', 柱面号: 183, 磁道号: 1, 物理记录号: 5 },
    { 进程名: '进程3', 柱面号: 37, 磁道号: 3, 物理记录号: 2 },
    { 进程名: '进程4', 柱面号: 122, 磁道号: 0, 物理记录号: 7 },
    { 进程名: '进程5', 柱面号: 14, 磁道号: 2, 物理记录号: 4 },
    { 进程名: '进程6', 柱面号: 124, 磁道号: 1, 物理记录号: 1 },
    { 进程名: '进程7', 柱面号: 65, 磁道号: 3, 物理记录号: 6 },
    { 进程名: '进程8', 柱面号: 67, 磁道号: 0, 物理记录号: 0 },
  ],
  // 银行家实验矩阵（每行对应同名进程；多余进程在 seedState 里随机补齐）
  bankerAvailable: [3, 3, 2],
  bankerMax: [[7, 5, 3], [3, 2, 2], [9, 0, 2], [2, 2, 2], [4, 3, 3]],
  bankerAllocation: [[0, 1, 0], [2, 0, 0], [3, 0, 2], [2, 1, 1], [0, 0, 2]],
  // PV 同步实验初值（缓冲区/三个信号量）
  syncCapacity: 4,
  syncS1Init: 4,    // 空闲槽数（= capacity）
  syncS2Init: 0,    // 产品数
  syncMutexInit: 1, // 互斥锁
}

const MAX = [[7, 5, 3], [3, 2, 2], [9, 0, 2], [2, 2, 2], [4, 3, 3]]
const ALLOC = [[0, 1, 0], [2, 0, 0], [3, 0, 2], [2, 1, 1], [0, 0, 2]]
const need = (mx, al) => mx.map((row, i) => row.map((v, j) => v - al[i][j]))

// 把页面访问串文本解析为页号数组（容错：分隔符任意、空则回落默认串）
export function parseRefString(text) {
  const arr = String(text ?? '')
    .split(/[^0-9]+/)
    .filter((s) => s !== '')
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isFinite(n) && n >= 0)
  return arr.length ? arr : parseRefString(DEFAULT_CONFIG.refStringText)
}

// 外存地址（磁盘所在位置）—— 教材风格的 3 位外存地址，如 011、012…
const extAddr = (page) => '0' + String(11 + page).padStart(2, '0')

// —— 存储核心：由 config 构建页表/页框（含修改位、访问位、外存地址）——
function buildMemory(config, rng) {
  const refString = config.dynamicPages
    ? generateDynamicRefString(20, 7, rng)
    : parseRefString(config.refStringText)
  const frameCount = Math.max(1, config.frameCount | 0)
  const maxPage = config.dynamicPages ? 7 : Math.max(...refString)

  // 页表：每个出现过的页号一行（页号 / 标志 / 主存块号 / 访问位 / 修改位 / 外存地址）
  const pageTable = []
  for (let p = 0; p <= maxPage; p++) {
    pageTable.push({
      页号: p, 标志: 0, 主存块号: null, 访问位: 0, 修改位: 0,
      外存地址: extAddr(p), loadTime: -1, lastUsed: -1,
    })
  }

  // warm-fill：把访问串前若干「不同页」预先装入页框（最多占一半，留出缺页演示空间）
  const frames = new Array(frameCount).fill(null)
  const warm = Math.min(Math.ceil(frameCount / 2), 4)
  let slot = 0
  for (const p of refString) {
    if (slot >= warm) break
    if (frames.includes(p)) continue
    frames[slot] = p
    const row = pageTable[p]
    row.标志 = 1; row.主存块号 = slot; row.访问位 = 1
    row.修改位 = p % 2          // 偶数页未改、奇数页已改，便于演示「写回磁盘」
    row.loadTime = slot; row.lastUsed = slot
    slot++
  }

  return {
    capacity: frameCount,      // = frameCount（driver 计算 memUtil 沿用此字段）
    frameCount,
    frames,
    pageTable,
    refString,
    refPtr: 0,
    faults: 0,
    hits: 0,
    pagingTrace: null,
    traceCursor: -1,
    backendMode: 'local',
    backendError: '',
    clockPtr: 0,               // CLOCK 置换算法的时钟指针
    // 最近一次访存 / 缺页置换（界面据此指明「调出页面」与「装入页号」）
    lastReplace: { 访问页: null, 缺页: false, 调出页: null, 装入页: null, 装入块: null, 写回: false },
  }
}

// —— 设备核心：由 config 构建真实盘面几何 + I/O 请求队列 ——
function buildDisk(config) {
  const cylinders = Math.max(1, config.cylinders | 0)
  const tracksPerCyl = Math.max(1, config.tracksPerCyl | 0)
  const recordsPerTrack = Math.max(1, config.recordsPerTrack | 0)
  const head = 53 < cylinders ? 53 : Math.floor(cylinders / 2)

  // 请求项规整：进程名/柱面号/磁道号/物理记录号，并按几何上界 clamp
  const queue = (config.ioRequests || []).map((r, i) => ({
    进程名: r.进程名 || `进程${i + 1}`,
    柱面号: Math.min(cylinders - 1, Math.max(0, r.柱面号 | 0)),
    磁道号: Math.min(tracksPerCyl - 1, Math.max(0, r.磁道号 | 0)),
    物理记录号: Math.min(recordsPerTrack - 1, Math.max(0, r.物理记录号 | 0)),
  }))

  return {
    cylinders, tracksPerCyl, recordsPerTrack,
    head,                 // 当前磁头所在柱面
    currentRecord: 0,     // 当前旋转位置（物理记录）
    direction: 1,         // 移臂方向（SCAN/LOOK 系用）：+1 向大柱面
    queue,
    path: [head],         // 移臂轨迹（柱面号序列）
    totalSeek: 0,         // 累计移臂距离（柱面）
    served: 0,
    servedLog: [],        // 最近服务记录（进程名/柱面/磁道/记录/寻道）
    busyUntil: 0,         // 磁盘忙到哪个虚拟时刻
    busyLog: [],          // 最近服务区间：{ start, end, serviceTime, processName }
    busyRate: 0,          // 最近窗口磁盘忙碌率
    ioBlocked: [],        // I/O 阻塞进程名列表（进程发起 I/O 时加入，I/O 完成时移除）
  }
}

// PV 角色推断：与 localTick.js / twin_engine.py 的同名函数语义对齐，确保未显式声明
// pvRole 的旧配置（含历史 fixture）行为不变。
function inferPvRoleFromName(name) {
  const n = String(name || '').toLowerCase()
  if (n.includes('logger') || n.includes('daemon') || n.includes('producer')) return 'producer'
  if (n.includes('shell') || n.includes('consumer')) return 'consumer'
  return ''
}

function normalizePvRole(value, name) {
  if (value === 'producer' || value === 'consumer' || value === '') return value
  return inferPvRoleFromName(name)
}

function buildProcesses(config, rng) {
  const source = (config.processes && config.processes.length ? config.processes : DEFAULT_CONFIG.processes)
    .map((p, i) => ({
      pid: Number(p.pid) || i + 1,
      name: String(p.name || `P${i + 1}`).trim() || `P${i + 1}`,
      arrival: Math.max(0, Number(p.arrival) || 0),
      burst: Math.max(1, Number(p.burst) || 1),
      priority: Math.max(1, Number(p.priority) || 1),
      pvRole: normalizePvRole(p.pvRole, p.name),
    }))

  const isDynamic = !!config.dynamicPages
  const globalRef = parseRefString(config.refStringText)
  const extAddr = (page) => '0' + String(11 + page).padStart(2, '0')

  // 找出所有在 t = 0 时已到达的候选进程
  const candidates = source
    .map((p, i) => ({ ...p, _idx: i }))
    .filter(p => (Number(p.arrival) || 0) <= 0)

  let firstRunningPid = null
  if (candidates.length > 0) {
    const algo = config.schedAlgo || 'FCFS'
    let chosen = null
    if (algo === 'SJF') {
      chosen = candidates.sort((a, b) => (Number(a.burst) || 0) - (Number(b.burst) || 0) || a._idx - b._idx)[0]
    } else if (algo === 'PRIORITY') {
      chosen = candidates.sort((a, b) => (Number(a.priority) || 0) - (Number(b.priority) || 0) || a._idx - b._idx)[0]
    } else {
      chosen = candidates.sort((a, b) => (Number(a.arrival) || 0) - (Number(b.arrival) || 0) || a._idx - b._idx)[0]
    }
    if (chosen) firstRunningPid = chosen.pid
  }

  return source.map((p) => {
    let state = '新建'
    if (p.arrival <= 0) {
      state = p.pid === firstRunningPid ? '运行' : '就绪'
    }
    
    // 如果启用动态页面模式，为每个进程单独生成符合局部性原理的独立序列
    const procRefString = isDynamic ? generateDynamicRefString(20, 7, rng) : [...globalRef]
    const procMaxPage = isDynamic ? 7 : Math.max(...procRefString)

    // 生成当前进程的专属页表
    const pageTable = []
    for (let pageIdx = 0; pageIdx <= procMaxPage; pageIdx++) {
      pageTable.push({
        页号: pageIdx, 标志: 0, 主存块号: null, 访问位: 0, 修改位: 0,
        外存地址: extAddr(pageIdx), loadTime: -1, lastUsed: -1,
      })
    }

    return {
      ...p,
      state,
      ran: 0,
      blockedReason: '',
      pageWaitingFor: null,
      blockedAt: null,
      refString: procRefString,
      refPtr: 0,
      hits: 0,
      faults: 0,
      pageTable,
      syncPhase: 0,
      lastReplace: { 访问页: null, 缺页: false, 调出页: null, 装入页: null, 装入块: null, 写回: false },
    }
  })
}

export function seedState(cfg) {
  const config = { ...DEFAULT_CONFIG, ...(cfg || {}) }
  // 深拷贝可编辑数据，避免与已 seed 的运行态共享引用
  config.ioRequests = (config.ioRequests || DEFAULT_CONFIG.ioRequests).map((r) => ({ ...r }))
  // 银行家矩阵兼容化：旧 config (从后端/localStorage hydrate) 没有这些字段时
  // 用 DEFAULT_CONFIG 兜底，保证 SystemSettings 直接绑定不会报错。
  config.bankerAvailable = Array.isArray(config.bankerAvailable) && config.bankerAvailable.length === 3
    ? [...config.bankerAvailable] : [...DEFAULT_CONFIG.bankerAvailable]
  config.bankerMax = Array.isArray(config.bankerMax)
    ? config.bankerMax.map(row => [...row]) : DEFAULT_CONFIG.bankerMax.map(row => [...row])
  config.bankerAllocation = Array.isArray(config.bankerAllocation)
    ? config.bankerAllocation.map(row => [...row]) : DEFAULT_CONFIG.bankerAllocation.map(row => [...row])
  // PV 同步初值兼容化
  if (config.syncCapacity == null) config.syncCapacity = DEFAULT_CONFIG.syncCapacity
  if (config.syncS1Init == null) config.syncS1Init = DEFAULT_CONFIG.syncS1Init
  if (config.syncS2Init == null) config.syncS2Init = DEFAULT_CONFIG.syncS2Init
  if (config.syncMutexInit == null) config.syncMutexInit = DEFAULT_CONFIG.syncMutexInit
  config.processes = (config.processes || DEFAULT_CONFIG.processes).map((p, i) => ({
    pid: Number(p.pid) || i + 1,
    name: String(p.name || `P${i + 1}`).trim() || `P${i + 1}`,
    arrival: Math.max(0, Number(p.arrival) || 0),
    burst: Math.max(1, Number(p.burst) || 1),
    priority: Math.max(1, Number(p.priority) || 1),
    pvRole: normalizePvRole(p.pvRole, p.name),
  }))

  const rngState0 = (config.rngSeed ?? 0x9e3779b9) >>> 0
  const rng = makeRng(rngState0)

  const memory = buildMemory(config, rng)
  const disk = buildDisk(config)
  const processes = buildProcesses(config, rng)
  const maxPid = processes.reduce((max, p) => Math.max(max, p.pid), 0)
  const used = memory.frames.filter((x) => x !== null).length
  const memUtil = Math.round((used / memory.capacity) * 100)

  // 同步初始运行进程的页表以匹配暖机状态的物理内存页框
  const initRunning = processes.find(p => p.state === '运行')
  if (initRunning) {
    initRunning.pageTable = memory.pageTable.map(row => ({ ...row }))
  }

  // 动态构建资源池矩阵，长度与 processes 一致
  // 优先用 config.bankerMax/bankerAllocation；不足以覆盖所有进程时回落到教材样例 + 随机生成。
  const numProcs = processes.length
  const cfgMax = Array.isArray(config.bankerMax) ? config.bankerMax : MAX
  const cfgAlloc = Array.isArray(config.bankerAllocation) ? config.bankerAllocation : ALLOC
  const maxMatrix = []
  const allocMatrix = []
  for (let i = 0; i < numProcs; i++) {
    if (i < cfgMax.length && i < cfgAlloc.length) {
      maxMatrix.push([...cfgMax[i]])
      allocMatrix.push([...cfgAlloc[i]])
    } else {
      maxMatrix.push([
        Math.floor(rng.next() * 4) + 1,
        Math.floor(rng.next() * 4) + 1,
        Math.floor(rng.next() * 3) + 1,
      ])
      allocMatrix.push([0, 0, 0])
    }
  }
  const needMatrix = need(maxMatrix, allocMatrix)
  const availVec = Array.isArray(config.bankerAvailable) && config.bankerAvailable.length === 3
    ? [...config.bankerAvailable] : [3, 3, 2]

  return {
    clock: 0,
    running: false,
    speed: config.clockSpeed || 1,
    rngState: rng.state >>> 0,                                   // 种子 PRNG 当前状态（随 tick 推进）
    scheduler: { rrQueue: [], currentPid: null, quantumUsed: 0 }, // 调度器状态（原 driver 模块级变量上提，可序列化）

    // —— 处理机核心 ——
    processes,
    gantt: [],  // 由 driver 按"实际运行进程"逐拍累加；初始空，clock=0 时尚未发生 CPU 调度
    nextPid: maxPid + 1,

    // —— 存储核心 ——
    memory: {
      ...memory,
      tickAccess: {
        clock: 0, pid: null, processName: null,
        performed: false, result: 'idle', page: null, unit: null,
      },
    },

    // —— 资源核心（银行家）——
    resources: {
      types: ['R0', 'R1', 'R2'],
      available: availVec,
      max: maxMatrix,
      allocation: allocMatrix,
      need: needMatrix,
      safeSeq: [],
      deadlock: false,
    },

    // —— 进程同步（PV）—— 初值来自 config (syncCapacity/syncS1Init/syncS2Init/syncMutexInit)，
    // 兼容旧 fixture 在 config 未提供时回落到默认 (4 / 4 / 0 / 1)
    sync: {
      capacity: Number(config.syncCapacity ?? 4),
      s1: Number(config.syncS1Init ?? 4),
      s2: Number(config.syncS2Init ?? 0),
      mutex: Number(config.syncMutexInit ?? 1),
      buffer: 0,
      produced: 0,
      consumed: 0,
      prodBlocked: [],
      consBlocked: [],
      mutexBlocked: [],
      lockOwner: null
    },

    // —— 设备核心（磁盘驱动调度）——
    disk,

    // —— 全局事件流 ——
    events: [
      { ts: 0, type: '系统启动', core: 'system', level: 'info', desc: 'Quad-OS 内核初始化完成，进程 init 开始运行' },
    ],

    // —— 全局指标 ——
    metrics: {
      cpuUtil: 0, memUtil, throughput: 0, faultRate: 0,
      avgTurnaround: 0,
      readyLen: processes.filter((p) => p.state === '就绪').length,
      blockedLen: processes.filter((p) => p.state === '阻塞').length,
      diskQueueLen: disk.queue.length, completed: 0,
    },
    history: { labels: [0], cpu: [0], mem: [memUtil], fault: [0], throughput: [0] },

    // —— 模拟参数（接口契约 + 可配置）——
    config,
  }
}
