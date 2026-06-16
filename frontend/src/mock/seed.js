/**
 * 中央 OS 状态的初始种子数据（mock）。
 * 取材自操作系统经典例子，便于脚手架页面「有血有肉」。
 */
const MAX = [[7, 5, 3], [3, 2, 2], [9, 0, 2], [2, 2, 2], [4, 3, 3]]
const ALLOC = [[0, 1, 0], [2, 0, 0], [3, 0, 2], [2, 1, 1], [0, 0, 2]]
const need = (mx, al) => mx.map((row, i) => row.map((v, j) => v - al[i][j]))

export function seedState() {
  return {
    clock: 0,
    running: false,
    speed: 1,

    // —— 处理机核心 ——
    processes: [
      { pid: 1, name: 'init', state: '运行', arrival: 0, burst: 12, ran: 3, priority: 1 },
      { pid: 2, name: 'shell', state: '就绪', arrival: 1, burst: 6, ran: 0, priority: 2 },
      { pid: 3, name: 'editor', state: '就绪', arrival: 2, burst: 9, ran: 0, priority: 4 },
      { pid: 4, name: 'logger', state: '阻塞', arrival: 3, burst: 5, ran: 2, priority: 2 },
      { pid: 5, name: 'daemon', state: '就绪', arrival: 4, burst: 7, ran: 0, priority: 3 },
    ],
    gantt: [{ 作业: 'init', 开始: 0, 结束: 3 }],
    nextPid: 6,

    // —— 存储核心 ——
    memory: {
      capacity: 8,
      frames: [7, 0, 1, 2, null, null, null, null],
      pageTable: [
        { 页号: 0, 标志: 1, 主存块号: 5 },
        { 页号: 1, 标志: 1, 主存块号: 8 },
        { 页号: 2, 标志: 1, 主存块号: 9 },
        { 页号: 3, 标志: 1, 主存块号: 1 },
        { 页号: 4, 标志: 0, 主存块号: null },
        { 页号: 5, 标志: 0, 主存块号: null },
        { 页号: 6, 标志: 0, 主存块号: null },
      ],
      refString: [7, 0, 1, 2, 0, 3, 0, 4, 2, 3, 0, 3, 2, 1, 2],
      refPtr: 0,
      faults: 0,
      hits: 0,
    },

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

    // —— 设备核心（磁盘）——
    disk: {
      trackCount: 200,
      head: 53,
      queue: [98, 183, 37, 122, 14, 124, 65, 67],
      path: [53],
      totalSeek: 0,
      served: 0,
    },

    // —— 全局事件流 ——
    events: [
      { ts: 0, type: '系统启动', core: 'system', level: 'info', desc: 'Quad-OS 内核初始化完成，进程 init 开始运行' },
    ],

    // —— 全局指标 ——
    metrics: {
      cpuUtil: 35, memUtil: 50, throughput: 0, faultRate: 0,
      avgTurnaround: 0, readyLen: 3, blockedLen: 1, diskQueueLen: 8, completed: 0,
    },
    history: { labels: [0], cpu: [35], mem: [50], fault: [0], throughput: [0] },

    // —— 模拟参数 ——
    config: {
      quantum: 2, memFrames: 8, resTotal: 10, trackCount: 200,
      schedAlgo: 'RR', pageAlgo: 'LRU', diskAlgo: 'SCAN', clockSpeed: 1,
    },
  }
}
