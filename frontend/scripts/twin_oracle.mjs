// 生成前后端 parity 的金标准 fixtures：用纯 localTick 跑固定初始态 30 拍。
// 运行：node frontend/scripts/twin_oracle.mjs
import { writeFileSync, mkdirSync } from 'node:fs'
import { seedSim, localTick, serializeSim } from '../src/mock/localTick.js'

// 固定配置（覆盖 RR 调度 / LRU 置换 / SCAN 移臂 / 自动到达 / 动态访存）。
const config = {
  rngSeed: 0x12345678,
  schedAlgo: 'RR',
  pageAlgo: 'LRU',
  diskAlgo: 'SCAN',
  processAutoArrival: true,
  dynamicPages: true,
}

const state = seedSim(config)
const init = serializeSim(state)

const expected = []
let s = state
for (let i = 0; i < 30; i++) {
  const { state: ns, events } = localTick(s)
  s = ns
  expected.push({ tick: i + 1, state: serializeSim(s), events })
}

mkdirSync('backend/tests/fixtures', { recursive: true })
writeFileSync('backend/tests/fixtures/twin_init.json', JSON.stringify(init, null, 2))
writeFileSync('backend/tests/fixtures/twin_expected.json', JSON.stringify(expected, null, 2))
console.log('oracle written: 30 ticks; init clock', init.clock, 'final clock', s.clock, 'procs', s.processes.length)
