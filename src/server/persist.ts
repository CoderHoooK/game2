// 存档：saves/auto.json.gz（模拟 + AI 座位 + 生成这个世界用的「新世界」设置）。
// 读档时按存档里记的设置重建世界，所以网页上改了新世界设置也不会把旧档读坏。
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import path from 'node:path';
import type { Sim } from '../engine/sim';
import { loadSim, saveSim, type SaveFile } from '../engine/save';
import type { AiHost } from '../ai';
import { Clock } from '../engine/clock';
import type { SaveInfo, SettingValue } from '../protocol/messages';

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

/** 开新局时旧档的备份路径：xxx.json.gz → xxx.prev.json.gz */
export const prevPath = (file: string): string => file.replace(/(\.json)?(\.gz)?$/, '') + '.prev.json.gz';

/** 开新局前把旧档备份成 xxx.prev.json.gz；返回备份路径 */
export function backupSave(file: string): string | null {
  if (!existsSync(file)) return null;
  const to = prevPath(file);
  copyFileSync(file, to);
  return to;
}

/** 存档摘要（给开始界面看）；没有存档返回 null，读不出来返回带 error 的摘要 */
export function describeSave(file: string): SaveInfo | null {
  const prev = existsSync(prevPath(file));
  if (!existsSync(file)) return prev ? { label: '（没有当前存档，只有旧档备份）', savedAt: '', kb: 0, hasPrev: true, error: '没有当前存档' } : null;
  const kb = Math.round(statSync(file).size / 1024);
  try {
    const b = readSave(file)!;
    const clock = new Clock();
    clock.tick = b.sim.tick;
    const npcs = (b.world?.['population.npcs'] as number | undefined) ?? undefined;
    return { label: clock.label(), savedAt: b.savedAt, kb, seed: b.sim.seed, npcs, hasPrev: prev };
  } catch (err) {
    return { label: '（存档读不了）', savedAt: '', kb, hasPrev: prev, error: (err as Error).message };
  }
}

/** 清空存档：删当前存档、临时文件和「开新局备份的旧档」；设置文件不动。返回删掉的文件 */
export function clearSaves(file: string): string[] {
  const gone: string[] = [];
  for (const f of [file, file + '.tmp', prevPath(file)]) {
    if (!existsSync(f)) continue;
    unlinkSync(f);
    gone.push(f);
  }
  return gone;
}
