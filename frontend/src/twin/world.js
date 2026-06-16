import { computed } from 'vue'
import { useOsStore } from '../store/os'

/**
 * OS 世界模型（数字孪生就绪层）。
 *
 * 把中央 store 映射为一个**渲染无关**的「OS 世界」快照 —— 任何数字孪生消费者
 * （本平台的 2D SVG 孪生页 / 未来的 3D Three.js 场景 / 外部真实遥测镜像）
 * 都统一消费此模型，与具体渲染技术解耦。详见 docs/数字孪生架构.md。
 */
export function useOsWorld() {
  const os = useOsStore()

  const world = computed(() => {
    const ev = os.events
    const activity = (core) => Math.min(1, ev.slice(0, 8).filter((e) => e.core === core).length / 3)

    return {
      clock: os.clock,
      running: os.running,
      cpuUtil: os.metrics.cpuUtil,
      cores: [
        {
          key: 'processor', title: '处理机', icon: 'Cpu', color: '#15a98a',
          metric: os.runningProc ? os.runningProc.name : '空闲',
          sub: `利用率 ${os.metrics.cpuUtil}%`,
          bar: os.metrics.cpuUtil / 100, health: os.coreHealth.processor,
          active: os.running && (!!os.runningProc || activity('processor') > 0),
        },
        {
          key: 'memory', title: '存储', icon: 'Coin', color: '#3b82f6',
          metric: `${os.metrics.memUtil}%`, sub: `缺页 ${os.memory.faults}`,
          bar: os.metrics.memUtil / 100, health: os.coreHealth.memory,
          active: os.running && activity('memory') > 0,
        },
        {
          key: 'resource', title: '资源', icon: 'Share',
          color: os.resources.deadlock ? '#e64a45' : '#8b5cf6',
          metric: os.resources.deadlock ? '死锁' : '安全',
          sub: os.resources.deadlock ? '循环等待' : '银行家通过',
          bar: os.resources.deadlock ? 1 : 0.96, health: os.coreHealth.resource,
          active: os.running && activity('resource') > 0,
        },
        {
          key: 'device', title: '设备', icon: 'Files', color: '#f0a020',
          metric: `磁道 ${os.disk.head}`, sub: `队列 ${os.disk.queue.length}`,
          bar: os.disk.head / (os.disk.trackCount - 1), health: os.coreHealth.device,
          active: os.running && activity('device') > 0,
        },
      ],
      queues: { ready: os.metrics.readyLen, blocked: os.metrics.blockedLen },
      events: ev.slice(0, 5),
    }
  })

  return { world }
}
