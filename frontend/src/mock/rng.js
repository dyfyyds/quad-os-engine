// Mulberry32 确定性 PRNG —— 与后端 backend/app/engines/rng.py 逐位一致。
// 仅用于模拟中的"随机"决策，使整段仿真可复现，并支撑前后端 parity 测试。
export function makeRng(state) {
  return {
    state: state >>> 0,
    next() {
      this.state = (this.state + 0x6d2b79f5) >>> 0
      let t = this.state
      t = Math.imul(t ^ (t >>> 15), 1 | t)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    },
    randint(lo, hi) {
      return lo + Math.floor(this.next() * (hi - lo + 1))
    },
  }
}
