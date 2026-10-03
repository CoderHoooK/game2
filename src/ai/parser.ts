// 解析 AI 的回复：只挑以命令动词开头的行（容忍序号、列表符号、代码块），最多 12 行。
import type { Sim } from '../engine/sim';
import type { CommandResult } from '../engine/commands/types';

export const MAX_LINES = 12;

export function extractCommands(sim: Sim, text: string): { lines: string[]; dropped: number } {
  const verbs = new Set<string>();
  for (const c of sim.bus.list()) if (c.who.includes('lord')) (verbs.add(c.verb), (c.aliases ?? []).forEach((a) => verbs.add(a)));
  const lines: string[] = [];
  let dropped = 0;
  for (let raw of text.split(/\r?\n/)) {
    raw = raw.replace(/^\s*(?:[-*•>]|\d+[.、)）]|```\w*)\s*/, '').replace(/`/g, '').trim();
    if (!raw) continue;
    const verb = raw.split(/\s+/)[0];
    if (!verbs.has(verb)) continue;
    if (lines.length >= MAX_LINES) {
      dropped++;
      continue;
    }
    lines.push(raw);
  }
  return { lines, dropped };
}

/** 以某诸侯身份执行（origin = ai）；返回每行的结果 */
export function runCommands(sim: Sim, faction: string, lines: string[]): { line: string; result: CommandResult }[] {
  return lines.map((line) => ({ line, result: sim.bus.exec(line, { role: 'lord', faction, origin: 'ai' }) }));
}
