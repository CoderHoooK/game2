// 二进制帧：第一个字节是类型。坐标量化成 u16（10 公里 / 65535 ≈ 0.15 米）。
export const BIN = { units: 1, terrain: 2, chunk: 3, nodes: 4, territory: 5 } as const;
const UNIT_BYTES = 12;

export interface UnitsFrame {
  tick: number;
  count: number;
  id: Uint32Array;
  x: Float32Array;
  y: Float32Array;
  prof: Uint8Array;
  faction: Uint8Array;
  beh: Uint8Array;
  carry: Uint8Array;
}

const q = (v: number, size: number) => Math.max(0, Math.min(65535, Math.round((v / size) * 65535)));
const dq = (v: number, size: number) => (v / 65535) * size;

export function encodeUnits(f: UnitsFrame, size: number): ArrayBuffer {
  const buf = new ArrayBuffer(12 + f.count * UNIT_BYTES);
  const dv = new DataView(buf);
  dv.setUint8(0, BIN.units);
  dv.setUint32(4, f.tick, true);
  dv.setUint32(8, f.count, true);
  for (let i = 0, o = 12; i < f.count; i++, o += UNIT_BYTES) {
    dv.setUint32(o, f.id[i], true);
    dv.setUint16(o + 4, q(f.x[i], size), true);
    dv.setUint16(o + 6, q(f.y[i], size), true);
    dv.setUint8(o + 8, f.prof[i]);
    dv.setUint8(o + 9, f.faction[i]);
    dv.setUint8(o + 10, f.beh[i]);
    dv.setUint8(o + 11, f.carry[i]);
  }
  return buf;
}

export function allocUnits(n: number): UnitsFrame {
  return {
    tick: 0,
    count: 0,
    id: new Uint32Array(n),
    x: new Float32Array(n),
    y: new Float32Array(n),
    prof: new Uint8Array(n),
    faction: new Uint8Array(n),
    beh: new Uint8Array(n),
    carry: new Uint8Array(n),
  };
}

export function decodeUnits(buf: ArrayBuffer, size: number): UnitsFrame {
  const dv = new DataView(buf);
  const count = dv.getUint32(8, true);
  const f = allocUnits(count);
  f.tick = dv.getUint32(4, true);
  f.count = count;
  for (let i = 0, o = 12; i < count; i++, o += UNIT_BYTES) {
    f.id[i] = dv.getUint32(o, true);
    f.x[i] = dq(dv.getUint16(o + 4, true), size);
    f.y[i] = dq(dv.getUint16(o + 6, true), size);
    f.prof[i] = dv.getUint8(o + 8);
    f.faction[i] = dv.getUint8(o + 9);
    f.beh[i] = dv.getUint8(o + 10);
    f.carry[i] = dv.getUint8(o + 11);
  }
  return f;
}

/** 全图地形栅格 */
export function encodeTerrain(res: number, biome: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(4 + biome.length);
  const dv = new DataView(buf);
  dv.setUint8(0, BIN.terrain);
  dv.setUint16(2, res, true);
  new Uint8Array(buf, 4).set(biome);
  return buf;
}
export function decodeTerrain(buf: ArrayBuffer): { res: number; biome: Uint8Array } {
  const res = new DataView(buf).getUint16(2, true);
  return { res, biome: new Uint8Array(buf, 4, res * res) };
}

/** 区块：n×n 字节（低 4 位地形，高 4 位装饰） */
export function encodeChunk(cx: number, cy: number, n: number, cells: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(8 + n * n);
  const dv = new DataView(buf);
  dv.setUint8(0, BIN.chunk);
  dv.setUint16(2, cx, true);
  dv.setUint16(4, cy, true);
  dv.setUint16(6, n, true);
  new Uint8Array(buf, 8).set(cells);
  return buf;
}
export function decodeChunk(buf: ArrayBuffer): { cx: number; cy: number; n: number; cells: Uint8Array } {
  const dv = new DataView(buf);
  const n = dv.getUint16(6, true);
  return { cx: dv.getUint16(2, true), cy: dv.getUint16(4, true), n, cells: new Uint8Array(buf, 8, n * n) };
}

/** 资源点：位置、种类、剩余比例（0–255） */
export function encodeNodes(size: number, n: number, x: ArrayLike<number>, y: ArrayLike<number>, kind: ArrayLike<number>, level: ArrayLike<number>): ArrayBuffer {
  const buf = new ArrayBuffer(8 + n * 6);
  const dv = new DataView(buf);
  dv.setUint8(0, BIN.nodes);
  dv.setUint32(4, n, true);
  for (let i = 0, o = 8; i < n; i++, o += 6) {
    dv.setUint16(o, q(x[i], size), true);
    dv.setUint16(o + 2, q(y[i], size), true);
    dv.setUint8(o + 4, kind[i]);
    dv.setUint8(o + 5, Math.max(0, Math.min(255, Math.round(level[i] * 255))));
  }
  return buf;
}
export function decodeNodes(buf: ArrayBuffer, size: number): { n: number; x: Float32Array; y: Float32Array; kind: Uint8Array; level: Float32Array } {
  const dv = new DataView(buf);
  const n = dv.getUint32(4, true);
  const out = { n, x: new Float32Array(n), y: new Float32Array(n), kind: new Uint8Array(n), level: new Float32Array(n) };
  for (let i = 0, o = 8; i < n; i++, o += 6) {
    out.x[i] = dq(dv.getUint16(o, true), size);
    out.y[i] = dq(dv.getUint16(o + 2, true), size);
    out.kind[i] = dv.getUint8(o + 4);
    out.level[i] = dv.getUint8(o + 5) / 255;
  }
  return out;
}

/** 领土栅格：[类型 u8][3 字节空][版本 u32][边长 u16][2 字节空][边长² 个 u8：势力序号，255 = 无主] */
export function encodeTerritory(version: number, size: number, data: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(12 + size * size);
  const dv = new DataView(buf);
  dv.setUint8(0, BIN.territory);
  dv.setUint32(4, version, true);
  dv.setUint16(8, size, true);
  new Uint8Array(buf, 12).set(data.subarray(0, size * size));
  return buf;
}
export function decodeTerritory(buf: ArrayBuffer): { version: number; size: number; data: Uint8Array } {
  const dv = new DataView(buf);
  const size = dv.getUint16(8, true);
  return { version: dv.getUint32(4, true), size, data: new Uint8Array(buf, 12, size * size) };
}
