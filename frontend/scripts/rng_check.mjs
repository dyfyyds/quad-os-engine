// 生成 PRNG 期望向量，用于后端 parity 测试（粘入 backend/tests/test_rng.py）。
// 运行：node frontend/scripts/rng_check.mjs
import { makeRng } from '../src/mock/rng.js'

const r = makeRng(0x9e3779b9)
const vec = Array.from({ length: 8 }, () => Number(r.next().toFixed(12)))
console.log(JSON.stringify(vec))
