// 性能预算：2000 个 NPC 每拍 < 5 毫秒（10 拍/秒时只占半成 CPU，留给 AI 和网络）。
import { describe, it, expect } from 'vitest';
import { createGame } from '../src/game';

const BUDGET_MS = 5;

describe('性能', () => {
  it(`2000 个 NPC 每拍平均 < ${BUDGET_MS} ms，开局生成 < 3 秒`, () => {
    let t = performance.now();
    const sim = createGame({ seed: 1 });
    const createMs = performance.now() - t;
    sim.run(200);
    const N = 600;
    let worst = 0;
    t = performance.now();
    for (let i = 0; i < N; i++) {
      const a = performance.now();
      sim.tick();
      worst = Math.max(worst, performance.now() - a);
    }
    const avg = (performance.now() - t) / N;
    console.log(`开局 ${createMs.toFixed(0)} ms · 每拍平均 ${avg.toFixed(3)} ms · 最慢 ${worst.toFixed(2)} ms`);
    expect(createMs).toBeLessThan(3000);
    expect(avg).toBeLessThan(BUDGET_MS);
    expect(worst).toBeLessThan(BUDGET_MS * 10);
  });
});
