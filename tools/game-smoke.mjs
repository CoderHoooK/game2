// 游戏冒烟测试：真浏览器打开游戏（先 npm start），看全图 → 拉近 → 点小人看详情 → 下命令 → 格子级近景。
// 需要 playwright + chromium；没装时退出码 2 = 没跑（不算通过）。
// 用法：URL=http://localhost:8080/ ATLAS_SHOTS=/某目录 node tools/game-smoke.mjs
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('⚠ 没装 playwright，游戏冒烟测试没跑（不算通过）');
  process.exit(2);
}
const base = process.env.URL || 'http://localhost:8080/';
const shots = process.env.ATLAS_SHOTS || '';
const fail = (m) => {
  console.error('✗ ' + m);
  process.exitCode = 1;
};
let browser;
try {
  browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
} catch (e) {
  console.log('⚠ 浏览器起不来，游戏冒烟测试没跑（不算通过）：' + e.message.split('\n')[0]);
  process.exit(2);
}
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
const shot = async (name) => shots && (await page.screenshot({ path: `${shots}/${name}.png` }));
const ready = () => page.waitForFunction(() => window.__game && window.__game.stats(), null, { timeout: 30000 });

await page.goto(base);
await ready();
await page.waitForTimeout(3500);
const s0 = await page.evaluate(() => window.__game.stats());
console.log(`世界：${s0.label}，${s0.npcs} 个 NPC，每拍 ${s0.tickMs.toFixed(3)} ms`);
if (s0.npcs < 2000) fail(`NPC 不足 2000：${s0.npcs}`);
if (!(s0.tickMs < 5)) fail(`每拍 ${s0.tickMs} ms，超过 5 ms 预算`);
await shot('g-start');

await page.keyboard.press('Home');
await page.waitForTimeout(2500);
const full = await page.evaluate(() => window.__game.units.count);
console.log(`全图视野内单位：${full}`);
if (full < 1900) fail(`全图应该看到几乎所有人，只看到 ${full}`);
await shot('g-full');

const t = await page.evaluate(() => fetch('/healthz').then((r) => r.json()));
if (!t.ok) fail('/healthz 不正常');
const towns = await page.evaluate(() => window.__game.townsXY?.() ?? null);
const [tx, ty] = towns?.[0] ?? [Number(process.env.TX || 0), Number(process.env.TY || 0)];
await page.goto(base + (tx ? `?x=${tx}&y=${ty}&z=3` : ''));
await ready();
await page.waitForTimeout(3500);
const chunks = await page.evaluate(() => window.__game.chunks());
console.log(`拉近后加载区块：${chunks}`);
if (chunks < 4) fail('拉近后没加载区块');
await shot('g-town');

const target = await page.evaluate(() => {
  const g = window.__game;
  for (let id = 0; id < 2000; id++) {
    const p = g.screenOf(id);
    if (p && p[0] > 300 && p[0] < 1050 && p[1] > 150 && p[1] < 650) return { id, p };
  }
  return null;
});
if (!target) fail('视野里找不到可以点的小人');
else {
  await page.mouse.click(target.p[0], target.p[1]);
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => window.__game.info());
  if (!info) fail('点了小人但没有详情');
  else {
    console.log(`详情：${info.name} · ${info.profession.name} · 正在${info.behavior?.name ?? '想'} · ${info.order?.label} · ${info.commands.length} 条命令 · ${Object.keys(info.components).length} 个组件`);
    if (!(await page.isVisible('#inspector'))) fail('详情面板没显示');
    if (Object.keys(info.components).length < 9) fail('组件不全');
  }
  await shot('g-inspect');
}

for (const line of ['派 @木:5 伐木 北林', '派 @木 种田', '攻 #一队 赤焰城']) {
  await page.fill('#cmd', line);
  await page.press('#cmd', 'Enter');
}
await page.waitForTimeout(1500);
const rows = await page.$$eval('#log .row', (els) => els.map((e) => ({ cls: e.className, text: e.textContent.replace(/\s+/g, ' ') })));
for (const r of rows) console.log('  ' + r.text);
const want = ['ok', 'err', 'err'];
rows.slice(-3).forEach((r, i) => !r.cls.includes(want[i]) && fail(`命令结果不对：${r.text}`));
await shot('g-cmd');

await page.evaluate(() => {
  const g = window.__game;
  g.cam.flyTo(g.cam.cx + 60, g.cam.cy + 40, 14);
});
await page.waitForTimeout(3000);
await shot('g-close');

if (errors.length) fail('页面报错：\n' + errors.join('\n'));
await browser.close();
if (!process.exitCode) console.log('✓ 游戏冒烟测试通过');
