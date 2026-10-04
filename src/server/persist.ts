// 存档：saves/auto.json.gz（模拟 + AI 座位 + 生成这个世界用的「新世界」设置）。
// 读档时按存档里记的设置重建世界，所以网页上改了新世界设置也不会把旧档读坏。
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import path from 'node:path';
import type { Sim } from '../engine/sim';
import { loadSim, saveSim, type SaveFile } from '../engine/save';
import type { AiHost } from '../ai';
import type { SettingValue } from '../protocol/messages';

export interface SaveBundle {
  sim: SaveFile;
  ai: unknown;
  savedAt: string;
  /** 生成这个世界用的「新世界」设置（旧存档没有） */
  world?: Record<string, SettingValue>;
}

export function saveTo(file: string, sim: Sim, ai: AiHost | null, world?: Record<string, SettingValue>): number {
  mkdirSync(path.dirname(file), { recursive: true });
  const data: SaveBundle = { sim: saveSim(sim), ai: ai?.save() ?? null, savedAt: new Date().toISOString(), world };
  const buf = gzipSync(Buffer.from(JSON.stringify(data)));
  writeFileSync(file + '.tmp', buf);
  renameSync(file + '.tmp', file);
  return buf.length;
}

/** 读出存档内容（不往世界里装）；没有档返回 null */
export function readSave(file: string): SaveBundle | null {
  if (!existsSync(file)) return null;
  return JSON.parse(gunzipSync(readFileSync(file)).toString()) as SaveBundle;
}

/** 把存档装进（用同样设置建好的）世界；种子对不上返回说明，不抛错 */
export function loadInto(data: SaveBundle, sim: Sim, ai: AiHost | null): { ok: boolean; msg: string } {
  if (data.sim.seed !== sim.seed) return { ok: false, msg: `存档种子 ${data.sim.seed} ≠ 当前种子 ${sim.seed}，开新局` };
  loadSim(sim, data.sim);
  if (ai && data.ai) ai.load(data.ai);
  return { ok: true, msg: `读档：${sim.clock.label()}（存于 ${data.savedAt}）` };
}

/** 开新局前把旧档备份成 xxx.prev.json.gz；返回备份路径 */
export function backupSave(file: string): string | null {
  if (!existsSync(file)) return null;
  const to = file.replace(/(\.json)?(\.gz)?$/, '') + '.prev.json.gz';
  copyFileSync(file, to);
  return to;
}
