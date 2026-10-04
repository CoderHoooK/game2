// 压测：不同人数下每拍耗时。用法：npm run bench [-- 2000 5000 10000]
import { createGame } from '../src/game';
import { legacy } from '../tests/helpers';

const counts = process.argv.slice(2).map(Number).filter((n) => n > 0);
for (const n of counts.length ? counts : [2000, 5000, 10000]) {
  let t = performance.now();
  const sim = createGame({ seed: 1, config: legacy(n) });
  const create = performance.now() - t;
  sim.run(100);
  const N = 300;
  const each: number[] = [];
  for (let i = 0; i < N; i++) {
    t = performance.now();
    sim.tick();
    each.push(performance.now() - t);
  }
  each.sort((a, b) => a - b);
  const avg = each.reduce((a, b) => a + b, 0) / N;
  const p99 = each[Math.floor(N * 0.99)];
  console.log(`${String(n).padStart(6)} 人  开局 ${create.toFixed(0).padStart(5)} ms  每拍平均 ${avg.toFixed(3)} ms  p99 ${p99.toFixed(3)} ms  ${avg < 5 ? '✓' : '✗ 超预算 5 ms'}`);
}
