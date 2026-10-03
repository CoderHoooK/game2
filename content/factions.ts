import type { FactionDef } from '../src/shared/content';

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
