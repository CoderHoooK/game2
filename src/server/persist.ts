// 存档：saves/auto.json.gz（模拟 + AI 座位）。读档要求同一个种子。
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import path from 'node:path';
import type { Sim } from '../engine/sim';
import { loadSim, saveSim, type SaveFile } from '../engine/save';
import type { AiHost } from '../ai';

export interface SaveBundle {
  sim: SaveFile;
  ai: unknown;
  savedAt: string;
}

export function saveTo(file: string, sim: Sim, ai: AiHost | null): number {
  mkdirSync(path.dirname(file), { recursive: true });
  const data: SaveBundle = { sim: saveSim(sim), ai: ai?.save() ?? null, savedAt: new Date().toISOString() };
  const buf = gzipSync(Buffer.from(JSON.stringify(data)));
  writeFileSync(file + '.tmp', buf);
  renameSync(file + '.tmp', file);
  return buf.length;
}

/** 读档；没有档或种子不同返回说明（不抛错，照常开新局） */
export function loadFrom(file: string, sim: Sim, ai: AiHost | null): string {
  if (!existsSync(file)) return '没有存档，开新局';
  const data = JSON.parse(gunzipSync(readFileSync(file)).toString()) as SaveBundle;
  if (data.sim.seed !== sim.seed) return `存档种子 ${data.sim.seed} ≠ 当前种子 ${sim.seed}，开新局`;
  loadSim(sim, data.sim);
  if (ai && data.ai) ai.load(data.ai);
  return `读档：${sim.clock.label()}（存于 ${data.savedAt}）`;
}
