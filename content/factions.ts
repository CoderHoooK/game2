import type { FactionDef, NotableDef } from '../src/shared/content';

// 诸侯（4–6 位，已定 6 位）。第一座城是都城。
export const FACTIONS: FactionDef[] = [
  { name: '青龙', color: '#2dd4bf', towns: ['青石城', '河口镇'] },
  { name: '赤焰', color: '#f43f5e', towns: ['赤焰城', '落霞镇'] },
  { name: '白鹿', color: '#e2e8f0', towns: ['鹿鸣城', '松溪镇'] },
  { name: '玄武', color: '#818cf8', towns: ['北冥城', '寒水镇'] },
  { name: '金乌', color: '#fbbf24', towns: ['金乌城', '沙洲镇'] },
  { name: '苍狼', color: '#a3a3a3', towns: ['狼牙城', '风口镇'] },
];

// 青石城周边固定地名（命令例子、文档里用到）：[名字, 想要的地形, 方位角（度，0 = 东，90 = 南）]
export const FIXED_PLACES: [string, string[], number][] = [
  ['北林', ['forest'], 270],
  ['东山', ['hills', 'mountain'], 0],
  ['南湖', ['plains', 'swamp', 'forest'], 90],
  ['西岭', ['hills', 'mountain', 'forest'], 180],
];

export const SURNAMES = '王李张刘陈杨赵黄周吴徐孙胡朱高林何郭马罗梁宋郑谢韩唐冯于董萧程曹袁邓许傅沈曾彭吕苏卢蒋蔡贾丁魏薛叶阎余潘杜戴夏钟汪田任姜范方石姚谭廖邹熊金陆郝孔白崔康毛邱秦江史顾侯邵孟龙万段雷钱汤尹黎易常武乔贺赖龚文'.split('');
export const GIVEN = '大小二三四五六七八九春夏秋冬山水石木金铁牛虎龙豹鹰狗柱根旺福贵富顺安平喜庆宝来成发财明亮光华强勇刚毅忠义仁礼智信德才良善文武云霞月星雨雪'.split('');
/** 青龙最先出生的几个人（命令例子里的"阿三"等） */
export const FIXED_PEOPLE = ['阿三', '阿四', '老王'];

/** 开局每个诸侯的营地：物资和各职业人数的默认值（网页「新世界」设置里改；键 = 设置名去掉 population. 前缀） */
export const START_DEFAULTS = {
  /** 物资 */
  gold: 200,
  food: 300,
  wood: 200,
  stone: 60,
  iron: 0,
  weapon: 0,
  /** 各职业开局人数（职业 ID → 人数） */
  people: { farmer: 8, woodcutter: 4, builder: 3 } as Record<string, number>,
  /** 营地人口上限（房屋每座 +30） */
  campCap: 20,
};

/** 流寇：上帝召唤的无主势力，不占城、见人就打 */
export const BANDITS = { name: '流寇', color: '#57534e' };
/** 起义军 / 叛将自立时新势力的颜色（按顺序取） */
export const REBEL_COLORS = ['#f97316', '#22c55e', '#ec4899', '#06b6d4', '#84cc16', '#d946ef', '#facc15', '#60a5fa'];

/** 名人：每个诸侯一位将军一位谋士，另有几位在野（可以用"招"招揽）。忠诚低、野心高的将军可能自立。 */
export const NOTABLES: NotableDef[] = [
  { name: '赵云峰', faction: '青龙', profession: 'soldier', title: '将军', traits: ['勇'], loyalty: 80, ambition: 30 },
  { name: '钱谋', faction: '青龙', profession: 'merchant', title: '谋士', traits: ['智'], loyalty: 75, ambition: 20 },
  { name: '霍烈', faction: '赤焰', profession: 'soldier', title: '将军', traits: ['勇', '暴'], loyalty: 55, ambition: 70 },
  { name: '庞策', faction: '赤焰', profession: 'merchant', title: '谋士', traits: ['智', '诈'], loyalty: 60, ambition: 50 },
  { name: '白守义', faction: '白鹿', profession: 'soldier', title: '将军', traits: ['忠'], loyalty: 90, ambition: 15 },
  { name: '鹿清', faction: '白鹿', profession: 'merchant', title: '谋士', traits: ['仁'], loyalty: 80, ambition: 20 },
  { name: '玄甲', faction: '玄武', profession: 'soldier', title: '将军', traits: ['稳'], loyalty: 70, ambition: 40 },
  { name: '冥算', faction: '玄武', profession: 'merchant', title: '谋士', traits: ['智'], loyalty: 65, ambition: 45 },
  { name: '金戈', faction: '金乌', profession: 'soldier', title: '将军', traits: ['勇'], loyalty: 60, ambition: 60 },
  { name: '乌衣', faction: '金乌', profession: 'merchant', title: '谋士', traits: ['诈'], loyalty: 50, ambition: 65 },
  { name: '狼骁', faction: '苍狼', profession: 'soldier', title: '将军', traits: ['暴'], loyalty: 45, ambition: 80 },
  { name: '风语', faction: '苍狼', profession: 'merchant', title: '谋士', traits: ['智'], loyalty: 70, ambition: 30 },
  { name: '李将军', faction: '', profession: 'soldier', title: '将军', traits: ['勇', '稳'], loyalty: 50, ambition: 40 },
  { name: '张谋士', faction: '', profession: 'merchant', title: '谋士', traits: ['智'], loyalty: 50, ambition: 35 },
];
