// 前端入口：连接 → 收定义和地形 → 建图层和面板 → 每帧插值渲染。
// 前端只依赖 protocol 和 shared，不碰模拟代码（分层测试会拦住）。
import './style.css';
import { Application, Container } from 'pixi.js';
import type { Defs, InspectInfo, ServerMsg, StatsMsg } from '../protocol/messages';
import { BIN, decodeChunk, decodeNodes, decodeTerrain, decodeTerritory, decodeUnits } from '../protocol/codec';
import { Net } from './net';
import { Camera } from './camera';
import { TerrainLayer } from './layers/terrain';
import { NodesLayer } from './layers/nodes';
import { TownsLayer } from './layers/towns';
import { UnitsLayer } from './layers/units';
import { TerritoryLayer } from './layers/territory';
import { Drawer } from './panels/drawer';
import { Inspector } from './panels/inspector';
import { Console } from './panels/console';
import { Minimap } from './panels/minimap';
import { Legend } from './panels/legend';
import { SettingsPanel } from './panels/settings';
import { $, esc } from './util';

interface Game {
  defs: Defs;
  cam: Camera;
  terrain: TerrainLayer;
  nodes: NodesLayer;
  towns: TownsLayer;
  units: UnitsLayer;
  territory: TerritoryLayer;
  drawer: Drawer;
  inspector: Inspector;
  console: Console;
  minimap: Minimap;
  legend: Legend;
}

let defs: Defs | null = null;
let game: Game | null = null;
let stats: StatsMsg | null = null;
const early: ArrayBuffer[] = [];

const app = new Application();
const world = new Container();
const screen = new Container();

let reloading = '';
let settingsPanel: SettingsPanel | null = null;
let lobbyPanel: SettingsPanel | null = null;
const net = new Net({
  hello(d) {
    defs = d;
  },
  json(m: ServerMsg) {
    if (m.t === 'reload') {
      // 服务器换了新世界：马上会断开，重连后整页刷新
      reloading = m.why;
      $('#loading').classList.add('show');
      $('#loading span').textContent = m.why;
      return;
    }
    if (m.t === 'lobby') {
      // 服务器还没开局：显示开始界面（设置好才能开始；有存档可继续 / 清空）
      $('#loading').classList.remove('show');
      if (lobbyPanel) lobbyPanel.setSave(m.save);
      else {
        lobbyPanel = settingsPanel = new SettingsPanel((x) => net.send(x), $('#lobby'));
        lobbyPanel.openLobby(m.save);
      }
      return;
    }
    if (m.t === 'settings') return settingsPanel?.show(m);
    if (m.t === 'settings.result') return settingsPanel?.result(m.ok, m.msg);
    if (!game) return;
    if (m.t === 'stats') onStats(m);
    else if (m.t === 'result') game.console.result(m.id, m.ok, m.msg, m.warns, m.hint);
    else if (m.t === 'chronicle') game.drawer.addEntries(m.entries);
    else if (m.t === 'ailog') game.drawer.setMind(m);
    else if (m.t === 'inspect' && m.id === game.units.selected) {
      lastInfo = m.info;
      game.inspector.showNpc(m.info);
    }
  },
  bin(tag, buf) {
    if (!game) {
      if (tag === BIN.terrain && defs) void start(defs, buf);
      else early.push(buf);
      return;
    }
    onBin(tag, buf);
  },
  closed() {
    $('#loading').classList.add('show');
    $('#loading span').textContent = reloading || '和服务器的连接断了，正在重连…';
    const retry = () => {
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${location.pathname.replace(/[^/]*$/, '')}ws`);
      ws.onopen = () => location.reload();
      ws.onerror = () => setTimeout(retry, 2000);
    };
    setTimeout(retry, 1500);
  },
});

function onBin(tag: number, buf: ArrayBuffer): void {
  const g = game!;
  if (tag === BIN.units) g.units.apply(decodeUnits(buf, g.defs.size));
  else if (tag === BIN.chunk) {
    const c = decodeChunk(buf);
    g.terrain.addChunk(c.cx, c.cy, c.n, c.cells);
  } else if (tag === BIN.nodes) g.nodes.draw(decodeNodes(buf, g.defs.size));
  else if (tag === BIN.territory) {
    const t = decodeTerritory(buf);
    g.territory.apply(t.size, t.data);
    paintOwners();
  }
}

/** 势力颜色（新势力会冒出来）+ 每座城现在归谁 → 城镇、领土、小地图一起重画 */
function paintOwners(): void {
  const g = game!;
  const fs = stats?.factions ?? g.defs.factions;
  const colors = g.defs.towns.map((t, i) => fs[stats?.towns[i]?.faction ?? t.faction]?.color ?? '#999');
  g.towns.recolor(colors, g.defs.towns.map((t, i) => stats?.towns[i]?.founded ?? t.founded));
  g.territory.draw(fs);
  g.minimap.paint(colors, g.territory.visible ? g.territory.canvas : null, `${colors.join(',')}|${fs.length}|${g.territory.visible}|${g.territory.version}`);
}

/** 顶栏走马灯：最近一条天下大事 */
let lastNews = 0;
function ticker(): void {
  const e = game!.drawer.latest(1)[0];
  if (!e || e.id === lastNews) return;
  lastNews = e.id;
  const el = $('#news');
  el.textContent = e.text;
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

let lastInfo: InspectInfo | null = null;
function onStats(s: StatsMsg): void {
  stats = s;
  const g = game!;
  $('#clock').textContent = s.label;
  const ok = s.tickMs < 5;
  const sys = Object.entries(s.systems).map(([k, v]) => `${k} ${v.toFixed(3)}ms`).join('\n');
  $('#perf').innerHTML =
    `<span title="每拍模拟耗时（预算 5ms）\n${esc(sys)}" class="${ok ? 'good' : 'bad'}">⚙ ${s.tickMs.toFixed(2)} ms/拍</span>` +
    `<span title="NPC 总数 / 视野内">👥 ${s.npcs} / ${g.units.count}</span>` +
    `<span title="画面帧率">🎞 ${fps.toFixed(0)} fps</span>` +
    `<span title="收到的数据量">⇣ ${(kbps).toFixed(0)} KB/s</span>`;
  document.querySelectorAll<HTMLElement>('#speed button').forEach((b) => b.classList.toggle('on', Number(b.dataset.n) === s.speed));
  g.legend.counts(s);
  if (g.inspector.townId >= 0 && g.units.selected < 0) g.inspector.showTown(g.inspector.townId, s);
  g.drawer.addEntries(s.chronicle);
  g.drawer.update(s);
  g.console.setFactions(s.factions.filter((f) => f.alive && (f.kind === 'lord' || f.kind === 'rebel')).map((f) => f.name));
  paintOwners();
  ticker();
  const mind = g.drawer.wantsMind();
  if (mind && s.tick % 30 < 12) net.send({ t: 'ailog', faction: mind });
}

let fps = 60;
let kbps = 0;
let lastBytes = 0;
setInterval(() => {
  kbps = (net.bytesIn - lastBytes) / 1024;
  lastBytes = net.bytesIn;
}, 1000);

async function start(d: Defs, terrainBuf: ArrayBuffer): Promise<void> {
  if (game) return;
  await app.init({ resizeTo: window, background: '#0b1626', antialias: true, autoDensity: true, resolution: Math.min(2, window.devicePixelRatio || 1) });
  $('#stage').appendChild(app.canvas);
  const { res, biome } = decodeTerrain(terrainBuf);
  const cam = new Camera(d.size);
  const terrain = new TerrainLayer(d, res, biome);
  const nodes = new NodesLayer(d);
  const towns = new TownsLayer(d);
  const units = new UnitsLayer(d);
  const territory = new TerritoryLayer(d);
  world.addChild(terrain.root, territory.sprite, nodes.g, towns.world, units.root);
  screen.addChild(towns.screen);
  app.stage.addChild(world, screen);

  const select = (id: number) => {
    units.selected = id;
    if (id < 0) {
      game!.inspector.hide();
      return;
    }
    net.send({ t: 'inspect', id });
  };
  const inspector = new Inspector(d, {
    close: () => select(-1),
    fill: (line, as) => {
      if (as !== undefined) game!.console.setWho(as);
      game!.console.fill(line);
    },
    follow: (on) => on && units.selected >= 0 && cam.zoom < 3 && cam.flyTo(cam.cx, cam.cy, 4),
  });
  settingsPanel = new SettingsPanel((m) => net.send(m));
  $('#setBtn').addEventListener('click', () => settingsPanel!.toggle());
  const consoleP = new Console(d, (id, line, as) => net.send({ t: 'cmd', id, line, as }));
  const minimap = new Minimap(d, terrain.overview, cam);
  const legend = new Legend(d, {
    highlight: (p) => (units.highlight = p),
    town: (id) => {
      const t = d.towns[id];
      cam.flyTo(t.x, t.y, 2.2);
      units.selected = -1;
      inspector.showTown(id, stats);
    },
  });
  const drawer = new Drawer(d, {
    fill: (line, asGod) => {
      if (asGod) consoleP.setWho(null);
      consoleP.fill(line);
    },
    ailog: (faction) => net.send({ t: 'ailog', faction }),
    town: (name) => {
      const t = d.towns.find((x) => x.name === name);
      if (!t) return;
      cam.flyTo(t.x, t.y, 2.2);
      units.selected = -1;
      inspector.showTown(t.id, stats);
    },
  });
  game = { defs: d, cam, terrain, nodes, towns, units, territory, drawer, inspector, console: consoleP, minimap, legend };
  document.querySelectorAll<HTMLElement>('[data-drawer]').forEach((b) =>
    b.addEventListener('click', () => {
      const tab = b.dataset.drawer as 'chronicle';
      if (drawer.open && (drawer as unknown as { tab: string }).tab === tab) drawer.toggle(false);
      else drawer.show(tab);
    }),
  );
  $('#terrBtn').addEventListener('click', () => toggleTerritory());
  const toggleTerritory = () => {
    territory.visible = !territory.visible;
    territory.sprite.visible = territory.visible;
    $('#terrBtn').classList.toggle('on', territory.visible);
    paintOwners();
  };
  $('#terrBtn').classList.add('on');
  for (const b of early.splice(0)) onBin(new Uint8Array(b, 0, 1)[0], b);

  // 速度按钮：发的是上帝的"时速"命令（和命令框同一条路）
  $('#speed').innerHTML = [0, 1, 2, 4, 8].map((n) => `<button data-n="${n}" title="时速 ${n}">${n === 0 ? '⏸' : n + '×'}</button>`).join('');
  $('#speed').addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLElement>('button');
    if (b) consoleP.submit(`时速 ${b.dataset.n}`, null);
  });

  // ---- 输入：拖动平移、滚轮缩放、点击选人
  const canvas = app.canvas;
  let down: { x: number; y: number; moved: boolean } | null = null;
  canvas.addEventListener('pointerdown', (ev) => {
    down = { x: ev.clientX, y: ev.clientY, moved: false };
    canvas.setPointerCapture(ev.pointerId);
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!down) return;
    const dx = ev.clientX - down.x;
    const dy = ev.clientY - down.y;
    if (!down.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    down.moved = true;
    cam.pan(dx, dy);
    down.x = ev.clientX;
    down.y = ev.clientY;
    inspector.follow = false;
  });
  canvas.addEventListener('pointerup', (ev) => {
    if (down && !down.moved) {
      const id = units.pick(cam, ev.clientX, ev.clientY);
      if (id >= 0) select(id);
      else {
        const t = towns.pick(cam, ev.clientX, ev.clientY);
        if (t >= 0) {
          units.selected = -1;
          inspector.showTown(t, stats);
        } else select(-1);
      }
    }
    down = null;
  });
  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    cam.zoomAt(ev.clientX, ev.clientY, Math.exp(-ev.deltaY * 0.0015));
  }, { passive: false });
  window.addEventListener('keydown', (ev) => {
    if ((ev.target as HTMLElement).tagName === 'INPUT') return;
    const step = 120;
    if (ev.key === 'Home') cam.fitAll();
    else if (ev.key === 'Escape') select(-1);
    else if (ev.key === 't' || ev.key === 'T') toggleTerritory();
    else if (ev.key === 'j' || ev.key === 'J') drawer.open ? drawer.toggle(false) : drawer.show('chronicle');
    else if (ev.key === 'f' || ev.key === 'F') (inspector.follow = !inspector.follow), select(units.selected);
    else if (ev.key === 'ArrowLeft' || ev.key === 'a') cam.pan(step, 0);
    else if (ev.key === 'ArrowRight' || ev.key === 'd') cam.pan(-step, 0);
    else if (ev.key === 'ArrowUp' || ev.key === 'w') cam.pan(0, step);
    else if (ev.key === 'ArrowDown' || ev.key === 's') cam.pan(0, -step);
    else if (ev.key === '+' || ev.key === '=') cam.zoomAt(cam.w / 2, cam.h / 2, 1.4);
    else if (ev.key === '-') cam.zoomAt(cam.w / 2, cam.h / 2, 1 / 1.4);
    else if (ev.key === '/' || ev.key === 'Enter') (ev.preventDefault(), $('#cmd').focus());
  });

  // 开局镜头：全图，然后飞到青龙都城附近
  cam.resize(app.screen.width, app.screen.height);
  cam.zoom = cam.minZoom * 1.08;
  cam.center(d.size / 2, d.size / 2);
  const q = new URLSearchParams(location.search);
  if (q.has('x')) {
    cam.zoom = Number(q.get('z') || 2);
    cam.center(Number(q.get('x')), Number(q.get('y')));
  } else setTimeout(() => cam.flyTo(d.towns[0].x, d.towns[0].y, 0.9), 900);

  let lastView = '';
  let lastViewAt = 0;
  let lastInspect = 0;
  app.ticker.add((tk) => {
    fps = fps * 0.95 + (1000 / Math.max(1, tk.deltaMS)) * 0.05;
    if (cam.w !== app.screen.width || cam.h !== app.screen.height) cam.resize(app.screen.width, app.screen.height);
    cam.update(tk.deltaMS);
    // 领土色块：看全图时清楚，拉近后淡出（格子 40 米，近看会变成粗色带）
    const z = cam.zoom;
    territory.sprite.alpha = z <= 0.5 ? 1 : z >= 4 ? 0.12 : 1 - 0.88 * (Math.log2(z / 0.5) / 3);
    if (inspector.follow && units.selected >= 0) {
      const p = units.pos(units.selected);
      if (p) cam.center(p[0], p[1]);
    }
    world.scale.set(cam.zoom);
    world.position.set(cam.w / 2 - cam.cx * cam.zoom, cam.h / 2 - cam.cy * cam.zoom);
    nodes.g.visible = cam.zoom > 0.22;
    units.render(cam);
    towns.update(cam);
    minimap.draw();
    const now = performance.now();
    const v = cam.view();
    const key = [v.x0, v.y0, v.x1, v.y1].map((n) => Math.round(n / 8)).join(',');
    if (key !== lastView && now - lastViewAt > 120) {
      lastView = key;
      lastViewAt = now;
      net.send({ t: 'view', ...v });
      const want = terrain.wanted(cam);
      if (want.length) net.send({ t: 'chunks', list: want });
    }
    if (units.selected >= 0 && now - lastInspect > 500) {
      lastInspect = now;
      net.send({ t: 'inspect', id: units.selected });
    }
  });
  $('#loading').classList.remove('show');
  // 调试 / 冒烟测试用的入口（不影响游戏）
  (window as unknown as { __game: unknown }).__game = {
    cam,
    units,
    stats: () => stats,
    drawer,
    territory: () => territory.ownerAt(d.towns[0].x, d.towns[0].y),
    info: () => lastInfo,
    chunks: () => terrain.chunkCount,
    townsXY: () => d.towns.map((t) => [Math.round(t.x), Math.round(t.y)]),
    screenOf: (id: number) => {
      const p = units.pos(id);
      return p ? cam.toScreen(p[0], p[1]) : null;
    },
  };
}
$('#loading').classList.add('show');
