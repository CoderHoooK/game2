// 游戏冒烟测试：真浏览器打开游戏（先 npm start）→ 开始界面点开始 → 看全图 → 拉近 → 点小人看详情 → 下命令 → 格子级近景。
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
// 服务器启动后先停在「开始界面」（没开局）：检查开始界面，再点开始；已经在游戏里（重复跑冒烟）就跳过
await page.waitForFunction(() => (window.__game && window.__game.stats()) || document.querySelector('#lobby .srow'), null, { timeout: 30000 });
if (await page.isVisible('#lobby')) {
  const lobby = await page.evaluate(() => ({
    keys: [...document.querySelectorAll('#lobby .srow')].map((r) => r.dataset.key),
    acts: [...document.querySelectorAll('#lobby .sheet-foot [data-act]')].map((b) => b.dataset.act),
    hasClose: !!document.querySelector('#lobby [data-close]'),
  }));
  console.log(`开始界面：${lobby.keys.length} 项设置，按钮 ${lobby.acts.join('/')}`);
  for (const k of ['seed', 'population.startFarmer', 'aiMode']) if (!lobby.keys.includes(k)) fail(`开始界面缺 ${k}`);
  if (lobby.keys.includes('port')) fail('开始界面不该显示需要重启的服务器设置');
  if (lobby.hasClose) fail('开始界面不该能关掉');
  if (!lobby.acts.includes('start')) fail('开始界面没有开始按钮');
  await page.keyboard.press('Escape');
  if (!(await page.isVisible('#lobby'))) fail('Esc 不该关掉开始界面');
  if (await page.evaluate(() => !!window.__game)) fail('还没点开始，世界就已经在跑了');
  await shot('g-lobby');
  page.once('dialog', (d) => d.accept()); // 有存档时「开始新游戏」会确认覆盖
  await page.click('#lobby [data-act="start"]');
}
await ready();
await page.waitForTimeout(3500);
const s0 = await page.evaluate(() => window.__game.stats());
console.log(`世界：${s0.label}，${s0.npcs} 个 NPC，每拍 ${s0.tickMs.toFixed(3)} ms`);
if (s0.npcs < 60) fail(`从零开始的开局人数不对：${s0.npcs}`);
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

// ---- 第 1–6 阶段：统计、领土、史册抽屉（四个标签页）、城镇面板
const st = await page.evaluate(() => {
  const s = window.__game.stats();
  return { f: s.factions?.length ?? 0, t: s.towns?.length ?? 0, mood: s.towns?.[0]?.mood };
});
console.log(`势力 ${st.f} 个 · 城镇 ${st.t} 座 · 青石城民心 ${st.mood}`);
if (st.f < 6 || st.t < 12) fail('统计里没有势力 / 城镇');
const owner = await page.evaluate(() => window.__game.territory());
if (owner !== 0) fail(`青石城脚下的领土应归青龙（0），实际 ${owner}`);
await page.click('#terrBtn');
await page.waitForTimeout(300);
if (await page.$eval('#terrBtn', (b) => b.classList.contains('on'))) fail('领土按钮关不掉');
await page.click('#terrBtn');
for (const tab of ['chronicle', 'lords', 'minds', 'god']) {
  if (!(await page.isVisible('#drawer'))) await page.click(`[data-drawer="${tab}"]`);
  else await page.click(`#drawer .tab[data-tab="${tab}"]`);
  await page.waitForTimeout(tab === 'minds' ? 3500 : 700);
  const len = await page.$eval('#drawer .dr-body', (el) => el.textContent.trim().length);
  console.log(`抽屉「${tab}」：${len} 字`);
  if (len < 20) fail(`抽屉「${tab}」是空的`);
  await shot('g-drawer-' + tab);
}
if (!(await page.$('#drawer svg.relgraph')) && !(await page.$('#drawer .tab.on[data-tab="god"]'))) fail('诸侯关系图没画出来');
await page.click('#drawer .tab[data-tab="lords"]');
await page.waitForTimeout(500);
if (!(await page.$('#drawer svg.relgraph'))) fail('诸侯关系图没画出来');
await page.click('#legend a[data-town="0"]');
await page.waitForTimeout(1200);
const townText = await page.$eval('#inspector', (el) => el.textContent);
if (!/民心/.test(townText) || !/建筑/.test(townText)) fail('城镇面板没有民心 / 建筑');
await shot('g-town-panel');

// ⚙ 设置：只打开看看，不改、不开新局（不能动正在跑的世界）
await page.click('#setBtn');
await page.waitForSelector('#settings .srow', { timeout: 10000 });
const set = await page.evaluate(() => ({
  rows: document.querySelectorAll('#settings .srow').length,
  keys: [...document.querySelectorAll('#settings .srow')].map((r) => r.dataset.key),
  groups: [...document.querySelectorAll('#settings .sgroup h3')].map((h) => h.textContent),
  secret: document.querySelector('[data-key="aiApiKey"] input')?.type,
}));
console.log(`设置面板：${set.rows} 项，${set.groups.length} 组`);
for (const k of ['speed', 'aiMode', 'aiApiKey', 'seed', 'population.startFarmer', 'port']) if (!set.keys.includes(k)) fail(`设置面板缺 ${k}`);
if (set.secret !== 'password') fail('API Key 输入框应该是密码框');
await shot('g-settings');
await page.keyboard.press('Escape');
if (!(await page.$eval('#settings', (e) => e.hidden))) fail('Esc 没关掉设置面板');

if (errors.length) fail('页面报错：\n' + errors.join('\n'));
await browser.close();
if (!process.exitCode) console.log('✓ 游戏冒烟测试通过');
