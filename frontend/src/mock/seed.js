/**
 * 中央 OS 状态的初始种子数据（mock）。
 *
 * seedState(cfg) —— 不传参用出厂默认；传入 config 时按其重建 memory/disk，
 * 让「系统设置」页保存配置后真正驱动模拟（详见 store.applyConfig 与 docs/接口契约.md）。
 */

// —— 出厂默认配置（也是「重置模拟」的基线）——
export const DEFAULT_CONFIG = {
  quantum: 2,
  frameCount: 8,         // 内存（物理）块数
  resTotal: 10,
  cylinders: 200,        // 柱面总数（移臂调度的定位维度）
  tracksPerCyl: 4,       // 每柱面磁道数（磁头数）
  recordsPerTrack: 8,    // 每磁道物理记录数（扇区）
  schedAlgo: 'RR',
  pageAlgo: 'LRU',
  diskAlgo: 'SCAN',
  clockSpeed: 1,
  // —— 可编辑的实验数据 ——
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
function buildMemory(config) {
  const refString = parseRefString(config.refStringText)
  const frameCount = Math.max(1, config.frameCount | 0)
  const maxPage = Math.max(...refString)

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
  }
}

export function seedState(cfg) {
  const config = { ...DEFAULT_CONFIG, ...(cfg || {}) }
  // 深拷贝可编辑数据，避免与已 seed 的运行态共享引用
  config.ioRequests = (config.ioRequests || DEFAULT_CONFIG.ioRequests).map((r) => ({ ...r }))

  const memory = buildMemory(config)
  const disk = buildDisk(config)

  const processes = [
    { pid: 1, name: 'init', state: '运行', arrival: 0, burst: 12, ran: 3, priority: 1 },
    { pid: 2, name: 'shell', state: '就绪', arrival: 1, burst: 6, ran: 0, priority: 2 },
    { pid: 3, name: 'editor', state: '就绪', arrival: 2, burst: 9, ran: 0, priority: 4 },
    { pid: 4, name: 'logger', state: '阻塞', arrival: 3, burst: 5, ran: 2, priority: 2 },
    { pid: 5, name: 'daemon', state: '就绪', arrival: 4, burst: 7, ran: 0, priority: 3 },
  ]
  const used = memory.frames.filter((x) => x !== null).length
  const memUtil = Math.round((used / memory.capacity) * 100)

  return {
    clock: 0,
    running: false,
    speed: config.clockSpeed || 1,

    // —— 处理机核心 ——
    processes,
    gantt: [{ 作业: 'init', 开始: 0, 结束: 3 }],
    nextPid: 6,

    // —— 存储核心 ——
    memory,

    // —— 资源核心（银行家）——
    resources: {
      types: ['R0', 'R1', 'R2'],
      available: [3, 3, 2],
      max: MAX,
      allocation: ALLOC,
      need: need(MAX, ALLOC),
      safeSeq: [],
      deadlock: false,
    },

    // —— 进程同步（PV）——
    sync: { capacity: 10, s1: 10, s2: 0, buffer: 0, produced: 0, consumed: 0, prodBlocked: [], consBlocked: [] },

    // —— 设备核心（磁盘驱动调度）——
    disk,

    // —— 全局事件流 ——
    events: [
      { ts: 0, type: '系统启动', core: 'system', level: 'info', desc: 'Quad-OS 内核初始化完成，进程 init 开始运行' },
    ],

    // —— 全局指标 ——
    metrics: {
      cpuUtil: 35, memUtil, throughput: 0, faultRate: 0,
      avgTurnaround: 0,
      readyLen: processes.filter((p) => p.state === '就绪').length,
      blockedLen: processes.filter((p) => p.state === '阻塞').length,
      diskQueueLen: disk.queue.length, completed: 0,
    },
    history: { labels: [0], cpu: [35], mem: [memUtil], fault: [0], throughput: [0] },

    // —— 模拟参数（接口契约 + 可配置）——
    config,
  }
}
