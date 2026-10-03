// 图谱冒烟测试：真浏览器逐个打开所有页面和详情抽屉，试命令试验台和搜索。
// 需要 playwright（第 0 阶段会加进 devDependencies）；没装时退出码 2，表示"没跑"，不是"通过"。
// 用法：node tools/atlas-smoke.mjs        截图：ATLAS_SHOTS=/某目录 node tools/atlas-smoke.mjs
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let chromium;
try { ({ chromium } = await import('playwright')); } catch { console.log('⚠ 没装 playwright，冒烟测试没跑（不算通过）'); process.exit(2); }
const url = pathToFileURL(path.join(root, 'docs/atlas.html')).href;
const shots = process.env.ATLAS_SHOTS || '';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(url);
const A = await page.evaluate(() => ({
  pages: ['overview','layers','modules','tick','npc','professions','matrix','commands','extend','roadmap','decisions'],
  items: { layers: ATLAS.layers.map(x=>x.id), modules: ATLAS.modules.map(x=>x.id), professions: ATLAS.professions.map(x=>x.id),
    commands: ATLAS.commands.map(x=>x.id), components: ATLAS.components.map(x=>x.id), orders: ATLAS.orders.map(x=>x.id), behaviors: ATLAS.behaviors.map(x=>x.id) },
}));
let visited = 0;
for (const p of A.pages) {
  await page.goto(url + '#/' + p); await page.waitForTimeout(120);
  const len = await page.evaluate(() => document.querySelector('#view').innerText.length);
  if (len < 80) errors.push(`页面 ${p} 内容过少 (${len})`);
  visited++;
}
for (const [sec, ids] of Object.entries(A.items)) {
  for (const id of ids) {
    await page.evaluate((h) => (location.hash = h), `#/${sec}/${id}`); await page.waitForTimeout(40);
    const ok = await page.evaluate(() => document.querySelector('#drawer').classList.contains('on') && document.querySelector('.dr-body').innerText.length > 20);
    if (!ok) errors.push(`抽屉 ${sec}/${id} 没打开或为空`);
    visited++;
  }
}
// 关抽屉：Esc
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
if (await page.evaluate(() => document.querySelector('#drawer').classList.contains('on'))) errors.push('Esc 没关掉抽屉');
// 试验台
await page.goto(url + '#/commands'); await page.waitForTimeout(150);
const tryLine = async (line) => { await page.fill('#pgInput', line); await page.waitForTimeout(60); return page.evaluate(() => document.querySelector('#pgOut').innerText); };
let out = await tryLine('攻 @木:5 赤焰.河口镇');
if (!out.includes('解析成功') || !out.includes('伐木工接不了')) errors.push('试验台：伐木工进攻没给出警告 → ' + out);
out = await tryLine('派 @木 伐木 火星'); if (!out.includes('没有地点')) errors.push('试验台：错误地点没报错 → ' + out);
out = await tryLine('灾 旱 北林'); if (!out.includes('不是诸侯能用')) errors.push('试验台：诸侯用上帝命令没拦 → ' + out);
await page.click('[data-who="god"]'); await page.waitForTimeout(60);
out = await page.evaluate(() => document.querySelector('#pgOut').innerText); if (!out.includes('解析成功')) errors.push('试验台：切到上帝后应能用"灾" → ' + out);
await page.click('[data-who="lord"]');
await tryLine('编 @兵@青石城:20 一队');
if (shots) await page.screenshot({ path: `${shots}/commands.png` });
// 从职业抽屉点"试一试"
await page.goto(url + '#/professions/soldier'); await page.waitForTimeout(400);
if (shots) await page.screenshot({ path: `${shots}/prof-drawer.png` });
await page.click('#drawer [data-try]'); await page.waitForTimeout(250);
const v = await page.evaluate(() => [location.hash, document.querySelector('#pgInput') && document.querySelector('#pgInput').value]);
if (v[0] !== '#/commands' || !v[1] || !v[1].includes('兵')) errors.push('试一试 没带到试验台：' + v.join(' | '));
// 搜索
await page.keyboard.press('Control+k'); await page.waitForTimeout(80);
await page.keyboard.type('伐木'); await page.waitForTimeout(80);
const hits = await page.evaluate(() => document.querySelectorAll('.pal-item[data-i]').length);
if (!hits) errors.push('搜索"伐木"没有结果');
await page.keyboard.press('Enter'); await page.waitForTimeout(250);
const h2 = await page.evaluate(() => location.hash); if (!h2.includes('/')) errors.push('搜索回车没跳转：' + h2);
// 截图
for (const [p, f] of [['overview','overview'],['layers','layers'],['modules','modules'],['npc','npc'],['professions','professions'],['matrix','matrix'],['modules/jobs','module-drawer']]) {
  await page.goto(url + '#/' + p); await page.waitForTimeout(500); if (shots) await page.screenshot({ path: `${shots}/${f}.png` });
}
await page.setViewportSize({ width: 1440, height: 2400 }); await page.goto(url + '#/overview'); await page.waitForTimeout(400);
if (shots) await page.screenshot({ path: `${shots}/overview-full.png` });
await browser.close();
console.log(`访问 ${visited} 个页面/抽屉`);
if (errors.length) { console.log('✗ 问题 ' + errors.length + ' 个：\n' + errors.join('\n')); process.exit(1); }
console.log('✓ 冒烟测试全部通过');
