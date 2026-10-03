import { describe, it, expect } from 'vitest';
import { allocUnits, encodeUnits, decodeUnits, encodeTerrain, decodeTerrain, encodeChunk, decodeChunk, encodeNodes, decodeNodes, BIN } from '../src/protocol/codec';
import { PROTOCOL_VERSION } from '../src/protocol/messages';

describe('二进制协议', () => {
  it('有版本号', () => expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(1));
  it('单位帧往返误差 < 0.2 米', () => {
    const f = allocUnits(300);
    f.tick = 12345;
    f.count = 300;
    for (let i = 0; i < 300; i++) {
      f.id[i] = i * 7;
      f.x[i] = (i * 33.3) % 10000;
      f.y[i] = 10000 - ((i * 71.1) % 10000);
      f.prof[i] = i % 10;
      f.faction[i] = i % 6;
      f.beh[i] = i % 9;
      f.carry[i] = i % 5;
    }
    const buf = encodeUnits(f, 10000);
    expect(new Uint8Array(buf)[0]).toBe(BIN.units);
    expect(buf.byteLength).toBe(12 + 300 * 12);
    const g = decodeUnits(buf, 10000);
    expect(g.tick).toBe(12345);
    expect(g.count).toBe(300);
    for (let i = 0; i < 300; i++) {
      expect(g.id[i]).toBe(f.id[i]);
      expect(Math.abs(g.x[i] - f.x[i])).toBeLessThan(0.2);
      expect(Math.abs(g.y[i] - f.y[i])).toBeLessThan(0.2);
      expect([g.prof[i], g.faction[i], g.beh[i], g.carry[i]]).toEqual([f.prof[i], f.faction[i], f.beh[i], f.carry[i]]);
    }
  });
  it('地形、区块、资源点往返', () => {
    const biome = Uint8Array.from({ length: 64 * 64 }, (_, i) => i % 200);
    expect(Array.from(decodeTerrain(encodeTerrain(64, biome)).biome)).toEqual(Array.from(biome));
    const cells = Uint8Array.from({ length: 32 * 32 }, (_, i) => (i * 7) % 11);
    const c = decodeChunk(encodeChunk(31, 7, 32, cells));
    expect([c.cx, c.cy, c.n]).toEqual([31, 7, 32]);
    expect(Array.from(c.cells)).toEqual(Array.from(cells));
    const n = decodeNodes(encodeNodes(10000, 3, [1, 5000, 9999], [2, 3, 4], [0, 1, 3], [0, 0.5, 1]), 10000);
    expect(n.n).toBe(3);
    expect(Array.from(n.kind)).toEqual([0, 1, 3]);
    expect(Math.abs(n.x[1] - 5000)).toBeLessThan(0.2);
    expect(Math.abs(n.level[1] - 0.5)).toBeLessThan(0.01);
  });
});
