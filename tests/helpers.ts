// 测试用的开局配置。
// 游戏默认是「从零开始」（每个诸侯 1 座空营地、十几个人），很多规则测试需要一个「已经发展起来」的世界：
// legacy(n) 给出和旧版开局等价的配置 —— 每个诸侯 2 座营地都有人、n 个人按旧比例分职业、有营地边的田和名人、有自然出生。
import { START_RATIO, PROFESSIONS } from '../content/professions';

type Cfg = Record<string, Record<string, number | string | boolean>>;

/** n 个 NPC（两座营地平分，12 座营地各 n/12）按旧比例分职业 */
export function legacy(npcs = 2000, extra: Cfg = {}): Cfg {
  const perCamp = Math.round(npcs / 12);
  // 最大余数法，保证每座营地人数 = perCamp
  const ids = Object.keys(START_RATIO);
  const total = ids.reduce((a, k) => a + START_RATIO[k], 0);
  const raw = ids.map((k) => (perCamp * START_RATIO[k]) / total);
  const out = raw.map(Math.floor);
  const order = raw.map((v, i) => [v - out[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; out.reduce((a, b) => a + b, 0) < perCamp; k++) out[order[k % ids.length][1]]++;
  const people: Record<string, number> = {};
  for (const p of PROFESSIONS) people[`start${p.id[0].toUpperCase()}${p.id.slice(1)}`] = out[ids.indexOf(p.id)] ?? 0;
  return {
    population: {
      camps: 2,
      // 旧版每城 金 300 / 粮 400 / 木 150 / 石 80 / 铁 20 / 兵器 20，都城翻倍；现在每座营地一份，取翻倍后的数
      startGold: 600,
      startFood: 800,
      startWood: 300,
      startStone: 160,
      startIron: 40,
      startWeapon: 40,
      ...people,
      startFields: 18,
      campCap: Math.ceil(perCamp * 1.25) + 20,
      lordNotables: 1,
      growth: 0.004,
      ...extra.population,
    },
    world: { ...extra.world },
  };
}

/** 一座营地各职业的人数（对应 legacy 的 n） */
export const perCamp = (npcs: number) => Math.round(npcs / 12);
