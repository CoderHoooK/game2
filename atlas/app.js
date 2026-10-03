// 架构图谱页面逻辑：纯原生 JS，无依赖。
// 路由：#/<页面>[/<条目>]，条目会在右侧抽屉里打开，可以直接分享链接、浏览器后退。
(function () {
  'use strict';
  const A = globalThis.ATLAS;
  const P = globalThis.AtlasParser;
  const IX = P.index(A);

  // ------------------------------------------------------------ 小工具
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => [...(el || document).querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const byId = (list, id) => list.find((x) => x.id === id);
  const mod = (id) => byId(A.modules, id);
  const prof = (id) => byId(A.professions, id);
  const layer = (id) => byId(A.layers, id);
  const comp = (id) => byId(A.components, id);
  const order = (id) => byId(A.orders, id);
  const beh = (id) => byId(A.behaviors, id);
  const cmd = (id) => byId(A.commands, id);
  const STATUS = { draft: '草案', wip: '开发中', done: '已实现', open: '待定', decided: '已定' };
  const WHO = { lord: '诸侯', god: '上帝' };
  const badge = (st) => `<span class="badge st-${esc(st)}">${esc(STATUS[st] || st)}</span>`;
  const go = (h) => `data-go="${esc(h)}"`;

  const ownerChip = (id) => {
    if (id === 'engine') return `<span class="chip link" ${go('#/layers/engine')}>🔧 内核</span>`;
    if (id === 'ai') return `<span class="chip link" ${go('#/layers/ai')}>🤖 AI 层</span>`;
    const m = mod(id);
    return m ? `<span class="chip link" ${go('#/modules/' + m.id)}>${m.icon} ${esc(m.name)}</span>` : `<span class="chip">${esc(id)}</span>`;
  };
  const profChip = (p) => `<span class="chip link" ${go('#/professions/' + p.id)}><span class="dot" style="background:${p.color}"></span>${esc(p.name)} <span class="dim mono">@${esc(p.short)}</span></span>`;
  const orderChip = (o) => `<span class="chip link" ${go('#/orders/' + o.id)}>📋 ${esc(o.name)} <span class="dim mono">${esc(o.id)}</span></span>`;
  const behChip = (b) => `<span class="chip link" ${go('#/behaviors/' + b.id)}>⚙ ${esc(b.name)}</span>`;
  const compChip = (c) => `<span class="chip link mono" ${go('#/components/' + c.id)}>${esc(c.id)}</span>`;
  const cmdChip = (c) => `<span class="chip link" ${go('#/commands/' + c.id)}><b style="color:#fcd34d">${esc(c.verb)}</b> <span class="dim mono">${esc(c.id)}</span></span>`;
  const layerChip = (l) => `<span class="chip link" ${go('#/layers/' + l.id)}><span class="dot" style="background:${l.color}"></span>${esc(l.name)} <span class="dim mono">${esc(l.en)}</span></span>`;
  const plainChips = (list, mono) => (list || []).map((x) => `<span class="chip${mono ? ' mono' : ''}">${esc(x)}</span>`).join('') || '<span class="dim">—</span>';

  // 命令行着色：动词黄、选择器青
  function cmdline(text) {
    const toks = text.split(/\s+/);
    return `<span class="cmdline">${toks.map((t, i) => (i === 0 ? `<span class="v">${esc(t)}</span>` : /^[@#*]/.test(t) ? `<span class="sel">${esc(t)}</span>` : esc(t))).join(' ')}</span>`;
  }

  // 极简代码着色
  function hl(code) {
    const re = /(\/\/.*$)|('(?:[^'\\]|\\.)*')|(\b\d+(?:\.\d+)?\b)|(\b(?:export|default|const|function|return|interface|type|run)\b)/gm;
    let out = ''; let last = 0; let m;
    while ((m = re.exec(code))) {
      out += esc(code.slice(last, m.index));
      const cls = m[1] ? 'c' : m[2] ? 's' : m[3] ? 'n' : 'k';
      out += `<span class="${cls}">${esc(m[0])}</span>`;
      last = m.index + m[0].length;
    }
    return out + esc(code.slice(last));
  }
  function lit(v) {
    if (Array.isArray(v)) return '[' + v.map(lit).join(', ') + ']';
    if (v && typeof v === 'object') {
      const ks = Object.keys(v);
      return ks.length ? '{ ' + ks.map((k) => `${k}: ${lit(v[k])}`).join(', ') + ' }' : '{}';
    }
    if (typeof v === 'string') return `'${v.replace(/'/g, "\\'")}'`;
    return String(v);
  }

  let toastTimer = 0;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 1600);
  }
  function copy(text) {
    const done = () => toast('已复制：' + text);
    const fallback = () => {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('复制失败，请手动选中'); }
      ta.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }

  // 定时器：换页 / 关抽屉时统一清掉
  let pageTimers = []; let drawerTimers = [];
  const every = (bucket, fn, ms) => { const id = setInterval(fn, ms); bucket.push(id); return id; };
  const clearTimers = (bucket) => { bucket.forEach(clearInterval); bucket.length = 0; };
  function animateLoop(root, bucket, ms) {
    $$('.loop', root).forEach((loop) => {
      const items = $$('span', loop); if (!items.length) return;
      let i = 0; items[0].classList.add('on');
      every(bucket, () => { items[i].classList.remove('on'); i = (i + 1) % items.length; items[i].classList.add('on'); }, ms || 900);
    });
  }

  // ------------------------------------------------------------ 推导数据
  const profOrders = (p) => P.professionOrders(p, A);
  const profsForOrder = (oid) => A.professions.filter((p) => profOrders(p).some((o) => o.id === oid));
  const behsFor = (p, oid) => A.behaviors.filter((b) => p.behaviors.includes(b.id) && b.fits.includes(oid));
  const commandsFor = (oid) => A.commands.filter((c) => c.order === oid);
  const dependents = (mid) => A.modules.filter((m) => m.requires.includes(mid));
  const layerDependents = (lid) => A.layers.filter((l) => l.deps.includes(lid));
  const optionalCompsFor = (p) => (p.tags.includes('military') ? ['Combat', 'Equipment'] : []);
  const SIZE = { f32: 4, u16: 2, u8: 1, id: 4, bool: 1, enum: 1, handle: 4, vec2: 8, blob: 16, string: 4, 'id[]': 8, 'string[]': 8 };
  const compBytes = (c) => c.fields.reduce((s, f) => s + (SIZE[f[1]] || 4), 0);
  const baseBytes = A.components.filter((c) => c.base).reduce((s, c) => s + compBytes(c), 0);
  const statMax = ['speed', 'carry', 'hp', 'attack'].reduce((o, k) => (o[k] = Math.max(...A.professions.map((p) => p.stats[k])), o), {});
  const STAT_NAME = { speed: '速度', carry: '负重', hp: '血量', attack: '攻击' };
  const fmtCost = (o) => Object.entries(o || {}).map(([k, v]) => `${k} ${v}`).join('、') || '无';
  function statBars(p) {
    return `<div class="bars" style="--pc:${p.color}">${Object.keys(STAT_NAME).map((k) => `<span class="muted">${STAT_NAME[k]}</span><div class="bar"><i style="width:${Math.round((p.stats[k] / statMax[k]) * 100)}%"></i></div><span class="v">${p.stats[k]}</span>`).join('')}</div>`;
  }

  // ------------------------------------------------------------ 导航
  const SECTIONS = [
    { group: '框架' },
    { id: 'overview', name: '总览', ico: '✦' },
    { id: 'layers', name: '分层', ico: '▤', cnt: A.layers.length },
    { id: 'modules', name: '模块', ico: '⬡', cnt: A.modules.length },
    { id: 'tick', name: '节拍', ico: '⟳' },
    { group: 'NPC' },
    { id: 'npc', name: 'NPC 模板', ico: '◉', cnt: A.components.length },
    { id: 'professions', name: '职业', ico: '⚒', cnt: A.professions.length },
    { id: 'matrix', name: '行为矩阵', ico: '▦', cnt: A.behaviors.length },
    { group: '指挥' },
    { id: 'commands', name: '命令与试验台', ico: '⌘', cnt: A.commands.length },
    { group: '开发' },
    { id: 'extend', name: '扩展指南', ico: '＋' },
    { id: 'roadmap', name: '路线图', ico: '➜' },
    { id: 'decisions', name: '待定事项', ico: '?', cnt: A.decisions.filter((d) => d.status === 'open').length },
  ];
  const PAGE_OF = { components: 'npc', orders: 'matrix', behaviors: 'matrix' };

  function renderNav(active) {
    $('#nav').innerHTML = `
      <div class="brand"><div class="brand-logo">诸</div><div><div class="brand-title">${esc(A.meta.title.split(' · ')[0])}</div><div class="brand-sub">架构图谱 · v${esc(A.meta.version)}</div></div></div>
      ${SECTIONS.map((s) => (s.group ? `<div class="nav-group">${esc(s.group)}</div>`
        : `<a class="nav-link${s.id === active ? ' active' : ''}" ${go('#/' + s.id)}><span class="ico">${s.ico}</span>${esc(s.name)}${s.cnt != null ? `<span class="cnt">${s.cnt}</span>` : ''}</a>`)).join('')}
      <div class="nav-foot">数据来源：${esc(A.meta.source)}<br>更新：${esc(A.meta.updated)}<br>改数据后运行 <code>npm run atlas</code></div>`;
  }

  // ------------------------------------------------------------ 页面
  const pages = {};

  pages.overview = () => {
    const stats = [
      ['layers', A.layers.length, '分层'], ['modules', A.modules.length, '模块'], ['npc', A.components.length, '组件'],
      ['professions', A.professions.length, '职业'], ['matrix', A.behaviors.length, '行为'], ['commands', A.commands.length, '命令'],
    ];
    const cur = A.roadmap.find((r) => r.status === 'wip') || A.roadmap[0];
    const dots = A.professions.slice(0, 8).map((p, i) => {
      const y = 30 + (i % 4) * 26; const dur = 4 + (i % 3) * 1.3;
      return `<circle r="5" fill="${p.color}"><animateMotion dur="${dur}s" begin="${-i * 0.7}s" repeatCount="indefinite" path="M60,${y} C120,${y - 18} 180,${y + 18} 240,${y} C180,${y + 20} 120,${y - 20} 60,${y}"/></circle>`;
    }).join('');
    return `
      <div class="hero">
        <svg class="hero-units" viewBox="0 0 300 150" aria-hidden="true">
          <g fill="#166534" opacity=".9"><path d="M30 40 l12 -24 l12 24z"/><path d="M14 70 l12 -24 l12 24z"/><path d="M34 100 l12 -24 l12 24z"/><path d="M12 128 l12 -24 l12 24z"/></g>
          <rect x="246" y="48" width="44" height="54" rx="6" fill="rgba(124,92,255,.25)" stroke="#a78bfa"/><text x="268" y="80" text-anchor="middle" fill="#c4b5fd" font-size="12">仓</text>
          ${dots}
          <circle r="5" fill="#3b82f6"><animateMotion dur="7s" repeatCount="indefinite" path="M80,140 L230,140 L80,140"/></circle>
          <circle r="5" fill="#3b82f6"><animateMotion dur="7s" begin="-2s" repeatCount="indefinite" path="M80,140 L230,140 L80,140"/></circle>
        </svg>
        <div class="row">${badge(cur.status)}<span class="dim mono">v${esc(A.meta.version)} · ${esc(A.meta.updated)}</span></div>
        <h1>${esc(A.meta.title)}</h1>
        <p class="lead">${esc(A.meta.subtitle)}</p>
        <p class="lead" style="font-size:13px">这是 game2 的<b>活文档</b>：框架的每一层、每个模块、每个职业的属性和行为、每条命令都在这里。<br>点任意卡片看详情；在<a class="chip link" ${go('#/commands')}>⌘ 命令试验台</a>里可以直接试写命令。</p>
        <div class="stats">${stats.map(([id, n, label]) => `<div class="stat" ${go('#/' + id)}><b>${n}</b><span>${label}</span></div>`).join('')}</div>
      </div>
      <h2>设计原则 <span class="sub">从旧项目学到的教训</span></h2>
      <div class="grid g3">${A.principles.map((p) => `<div class="card"><div class="card-title"><span class="pr-ico">${p.icon}</span>${esc(p.title)}</div><div class="card-text">${esc(p.text)}</div></div>`).join('')}</div>
      <h2>一条命令怎么变成 NPC 干活</h2>
      ${flowBlock(prof('woodcutter'))}
      <h2>现在进行到哪</h2>
      <div class="grid g2">
        <div class="card click" ${go('#/roadmap')}><div class="card-title">阶段 ${cur.stage} · ${esc(cur.name)} ${badge(cur.status)}</div><div class="card-text">${esc(cur.text)}</div><div class="card-text">🎯 ${esc(cur.goal)}</div></div>
        <div class="card click" ${go('#/decisions')}><div class="card-title">待你决定 <span class="badge st-open">${A.decisions.filter((d) => d.status === 'open').length} 项</span></div><div class="card-text">${A.decisions.filter((d) => d.status === 'open').slice(0, 4).map((d) => '· ' + esc(d.q)).join('<br>')}</div></div>
      </div>`;
  };

  // 命令 → 长期命令 → 行为 → 动作（总览和 NPC 页共用）
  function flowBlock(p) {
    const pcs = P.professionCommands(p, A).filter((x) => x.cmd.order);
    const first = pcs[0];
    const o = first ? order(first.cmd.order) : order('idle');
    const bs = behsFor(p, o.id);
    const main = bs[0] || beh('idle');
    const loopBehs = [main]; if (p.behaviors.includes('deliver') && main.id !== 'deliver' && o.id === 'work') loopBehs.push(beh('deliver'));
    const steps = loopBehs.flatMap((b) => b.loop);
    const acts = [...new Set(loopBehs.flatMap((b) => b.acts))];
    return `<div class="flow" style="--pc:${p.color}">
      <div class="step"><div class="dr-kind">① AI 命令</div><h4>${esc(first ? first.cmd.verb : '—')}</h4>${first ? cmdline(first.example) : ''}<div class="muted" style="margin-top:6px">诸侯一次回复可写多行</div></div>
      <div class="arrow">➜</div>
      <div class="step"><div class="dr-kind">② 长期命令 Order</div><h4>${esc(o.name)} <span class="dim mono">${esc(o.id)}</span></h4><div class="muted">${o.params.map((x) => `<code>${esc(x)}</code>`).join(' ') || '无参数'}</div><div class="muted" style="margin-top:6px">一个编组共用一条，改它 O(1)</div></div>
      <div class="arrow">➜</div>
      <div class="step"><div class="dr-kind">③ 行为（脚本驱动的循环）</div><h4>${loopBehs.map((b) => esc(b.name)).join(' → ')}</h4><div class="loop">${steps.map((s) => `<span>${esc(s)}</span>`).join('')}</div></div>
      <div class="arrow">➜</div>
      <div class="step"><div class="dr-kind">④ 动作（规则唯一入口）</div><h4>actions.*</h4><div>${acts.map((a) => `<span class="chip mono">${esc(a)}</span>`).join('')}</div><div class="muted" style="margin-top:6px">返回 { ok, reason }</div></div>
    </div>`;
  }

  pages.layers = () => {
    const L = (id) => layer(id);
    const row = (l, extra) => `<div class="layer${l.side ? '' : ''}" data-layer="${l.id}" style="--lc:${l.color}" ${go('#/layers/' + l.id)}>
        <div class="layer-head"><span class="layer-name">${esc(l.name)}</span><span class="layer-en">${esc(l.en)}</span><span class="spacer"></span>${badge(l.status)}</div>
        <div class="layer-role">${esc(l.role)}</div>${extra || ''}</div>`;
    const band = (l) => `<div class="layer band" data-layer="${l.id}" style="--lc:${l.color}" ${go('#/layers/' + l.id)}><span class="layer-name">⇅ ${esc(l.name)}</span> <span class="layer-en">${esc(l.en)} · WebSocket · 前后端共用类型</span></div>`;
    const mods = `<div class="mods">${A.modules.map((m) => `<span class="chip link" ${go('#/modules/' + m.id)}>${m.icon} ${esc(m.name)}</span>`).join('')}</div>`;
    return `
      <h1>分层</h1>
      <p class="lead">依赖<b>只能向下</b>。把鼠标放到某一层上，会高亮它依赖的层；点开看这一层管什么、放在哪个目录。</p>
      <div class="stack" style="margin-top:18px">
        <div class="stack-main">
          ${row(L('client'))}${band(L('protocol'))}${row(L('server'))}${row(L('ai'))}${row(L('game'), mods)}${row(L('engine'))}${row(L('shared'))}
        </div>
        <div class="stack-side">
          ${row(L('content'))}
          <div class="rule">📏 <b>规则由测试守着</b><br>向上依赖、绕过模块公开接口（index.ts）都会让 <code>npm test</code> 失败（dependency-cruiser）。</div>
          <div class="rule">🌐 <b>前端只认通信格式</b><br>client 只依赖 protocol 和 shared，绝不碰模拟代码；模拟可以不开画面加速跑。</div>
          <div class="rule">📦 <b>一个 package.json</b><br>不拆多包，层次靠目录 + 依赖检查。</div>
        </div>
      </div>`;
  };
  pages.layers.mount = (root) => {
    $$('.layer', root).forEach((el) => {
      el.addEventListener('mouseenter', () => {
        const l = layer(el.dataset.layer); const keep = new Set([l.id, ...l.deps]);
        $$('.layer', root).forEach((x) => { x.classList.toggle('hl', keep.has(x.dataset.layer) && x !== el); x.classList.toggle('dimmed', !keep.has(x.dataset.layer)); });
      });
      el.addEventListener('mouseleave', () => $$('.layer', root).forEach((x) => x.classList.remove('hl', 'dimmed')));
    });
  };

  pages.modules = () => {
    const depth = {}; const d = (id) => (depth[id] != null ? depth[id] : (depth[id] = mod(id).requires.length ? 1 + Math.max(...mod(id).requires.map(d)) : 0));
    A.modules.forEach((m) => d(m.id));
    const cols = []; A.modules.forEach((m) => (cols[depth[m.id]] = cols[depth[m.id]] || []).push(m));
    const W = 160, H = 56, GX = 46, GY = 18, PAD = 16;
    const pos = {};
    cols.forEach((col, ci) => col.forEach((m, ri) => (pos[m.id] = { x: PAD + ci * (W + GX), y: PAD + ri * (H + GY) })));
    const svgW = PAD * 2 + cols.length * W + (cols.length - 1) * GX;
    const svgH = PAD * 2 + Math.max(...cols.map((c) => c.length)) * (H + GY) - GY;
    const edges = A.modules.flatMap((m) => m.requires.map((r) => {
      const a = pos[r], b = pos[m.id]; const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2; const mx = (x1 + x2) / 2;
      return `<path class="edge" data-from="${r}" data-to="${m.id}" d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" marker-end="url(#arr)"/>`;
    })).join('');
    const count = (m) => ['components', 'systems', 'actions', 'orders', 'events', 'briefing', 'views'].reduce((s, k) => s + (m[k] || []).length, 0)
      + A.behaviors.filter((b) => b.module === m.id).length + A.commands.filter((c) => c.module === m.id).length;
    const nodes = A.modules.map((m) => { const p = pos[m.id]; return `<g class="node" data-id="${m.id}" ${go('#/modules/' + m.id)} transform="translate(${p.x},${p.y})">
        <rect width="${W}" height="${H}" rx="12"/><text x="12" y="23">${m.icon} ${esc(m.name)} <tspan class="sm" dx="3">${esc(m.id)}</tspan></text>
        <text class="sm" x="12" y="42">阶段 ${m.stage} · 登记 ${count(m)} 项</text></g>`; }).join('');
    const contractCode = 'export interface GameModule {\n' + A.contract.map((c) => `  ${c.field}${['id'].includes(c.field) ? '' : '?'}: ${c.type};`.padEnd(40) + ` // ${c.desc}`).join('\n') + '\n}';
    return `
      <h1>模块</h1>
      <p class="lead">一个玩法 = 一个模块文件夹。箭头从被依赖的模块指向依赖它的模块；悬停高亮关系，点开看它向核心登记了什么。</p>
      <div class="graph-wrap" style="margin-top:16px"><svg class="graph" viewBox="0 0 ${svgW} ${svgH}" style="width:100%;min-width:900px;height:auto">
        <defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="rgba(167,139,250,.7)"/></marker></defs>
        ${edges}${nodes}</svg></div>
      <h2>全部模块</h2>
      <div class="grid g3">${A.modules.map((m) => `<div class="card click" ${go('#/modules/' + m.id)}>
        <div class="card-title">${m.icon} ${esc(m.name)} <span class="dim mono">${esc(m.id)}</span><span class="spacer"></span>${badge(m.status)}</div>
        <div class="card-text">${esc(m.summary)}</div>
        <div class="card-text">依赖：${m.requires.length ? m.requires.map((r) => esc(mod(r).name)).join('、') : '无'} · 阶段 ${m.stage}</div></div>`).join('')}</div>
      <h2>模块契约 <span class="sub">GameModule：模块能向核心登记的全部东西，用不到的不填</span></h2>
      <pre class="code">${hl(contractCode)}</pre>
      <p class="lead" style="margin-top:10px">启动时注册表会：按 requires 排序 → 检查 ID 和命令名重复 → 把系统按阶段排好 → 汇总命令生成解析器和 AI 命令表。<b>任何一项不合规，启动直接报错。</b></p>`;
  };
  pages.modules.mount = (root) => {
    $$('.node', root).forEach((n) => {
      n.addEventListener('mouseenter', () => {
        const id = n.dataset.id; const rel = new Set([id]);
        $$('.edge', root).forEach((e) => { const on = e.dataset.from === id || e.dataset.to === id; e.classList.toggle('hl', on); e.classList.toggle('dim', !on); if (on) { rel.add(e.dataset.from); rel.add(e.dataset.to); } });
        $$('.node', root).forEach((x) => x.classList.toggle('dim', !rel.has(x.dataset.id)));
      });
      n.addEventListener('mouseleave', () => { $$('.edge,.node', root).forEach((x) => x.classList.remove('hl', 'dim')); });
    });
  };

  pages.tick = () => `
    <h1>节拍</h1>
    <p class="lead">模拟按固定节拍运行：<b>每秒 ${A.tick.hz} 次</b>。画面照常每秒 60 帧，两次快照之间由前端补帧。每个系统声明自己在哪个阶段、多久跑一次（每拍 / 每 10 拍 / 每游戏日）。</p>
    <div class="pipe" style="margin-top:18px">${A.tick.phases.map((ph, i) => `<div class="ph" data-i="${i}"><span class="no">${i + 1}</span><b>${esc(ph.name)}</b><div class="muted">${esc(ph.text)}</div></div>`).join('')}</div>
    <h2>各模块的系统</h2>
    <div class="card"><table class="t"><tr><th>模块</th><th>系统</th></tr>${A.modules.filter((m) => (m.systems || []).length).map((m) => `<tr class="click" ${go('#/modules/' + m.id)}><td>${m.icon} ${esc(m.name)}</td><td>${plainChips(m.systems)}</td></tr>`).join('')}</table></div>
    <h2>可重现</h2>
    <div class="grid g3">
      <div class="card"><div class="card-title">🎲 只用带种子的随机数</div><div class="card-text">模拟代码里禁用 Math.random / Date.now（ESLint 拦住），随机数一律走 shared/rng。</div></div>
      <div class="card"><div class="card-title">📼 命令记录 = 复盘文件</div><div class="card-text">所有命令都走同一条总线。同一个种子 + 同样的命令记录，结果逐字节相同。</div></div>
      <div class="card"><div class="card-title">⏩ 不开画面也能跑</div><div class="card-text">模拟和画面彻底分开：测试、快进、长跑都在后端直接跑。</div></div>
    </div>`;
  pages.tick.mount = (root) => {
    const phs = $$('.ph', root); let i = 0;
    every(pageTimers, () => { phs.forEach((p) => p.classList.remove('pulse')); phs[i].classList.add('pulse'); i = (i + 1) % phs.length; }, 420);
  };

  pages.npc = () => {
    const card = (c) => `<div class="card click comp-card" ${go('#/components/' + c.id)}>
      <div class="card-title"><code style="color:#c4b5fd">${esc(c.id)}</code> ${esc(c.name)}<span class="spacer"></span>${ownerChip(c.owner)}</div>
      <div class="fields">${c.fields.map((f) => `<div><code>${esc(f[0])}</code><span class="ty">${esc(f[1])}</span><span class="muted">${esc(f[2])}</span></div>`).join('')}</div></div>`;
    return `
      <h1>NPC 通用模板</h1>
      <p class="lead">每个 NPC 只是一个<b>实体 ID</b>，数据按"列"放在紧凑数组里（不是场景节点）。所有 NPC 都有下面这组基础组件；职业只是一份数据，决定数值和能做的行为。</p>
      <div class="row" style="margin:12px 0 4px"><span class="chip">基础组件约 <b>&nbsp;${baseBytes}&nbsp;</b> 字节 / 人</span><span class="chip">2000 人 ≈ ${(baseBytes * 2000 / 1024).toFixed(0)} KB</span><span class="chip">村民规格：只拿一种东西、不单独吃饭</span></div>
      <h2>基础组件 <span class="sub">每个 NPC 都有</span></h2>
      <div class="grid g3">${A.components.filter((c) => c.base).map(card).join('')}</div>
      <h2>可选组件 <span class="sub">按需挂；以后的模块可以随时加新组件</span></h2>
      <div class="grid g3">${A.components.filter((c) => !c.base).map(card).join('')}</div>
      <h2>命令 → 行为 → 动作 <span class="sub">选一个职业看看</span></h2>
      <div class="row" id="flowPick">${A.professions.map((p, i) => `<span class="chip link" data-flow="${p.id}" style="${p.id === 'woodcutter' ? 'border-color:' + p.color : ''}"><span class="dot" style="background:${p.color}"></span>${esc(p.name)}</span>`).join('')}</div>
      <div id="flowBox" style="margin-top:12px">${flowBlock(prof('woodcutter'))}</div>
      <p class="lead" style="margin-top:12px">每一层只管一件事：<b>命令</b>改长期命令，<b>长期命令</b>被一个编组共用，NPC 空闲时按命令和职业挑<b>行为</b>，行为每一步调用<b>动作</b>。动作是改世界的唯一入口。</p>`;
  };
  pages.npc.mount = (root) => {
    animateLoop(root, pageTimers);
    $$('[data-flow]', root).forEach((el) => el.addEventListener('click', () => {
      clearTimers(pageTimers);
      $$('[data-flow]', root).forEach((x) => x.style.borderColor = '');
      el.style.borderColor = prof(el.dataset.flow).color;
      $('#flowBox', root).innerHTML = flowBlock(prof(el.dataset.flow));
      animateLoop(root, pageTimers);
    }));
  };

  let profFilter = 'all';
  pages.professions = () => {
    const tags = [...new Set(A.professions.flatMap((p) => p.tags))];
    const list = A.professions.filter((p) => profFilter === 'all' || p.tags.includes(profFilter));
    return `
      <h1>职业</h1>
      <p class="lead">加一个职业通常只加一份数据。点开任意职业，看它的<b>全部属性、行为和能用的控制命令</b>。</p>
      <div class="filters"><div class="seg">${['all', ...tags].map((t) => `<button data-pf="${t}" class="${profFilter === t ? 'on' : ''}">${t === 'all' ? '全部' : t === 'worker' ? '干活的 @worker' : t === 'military' ? '军事 @military' : t}</button>`).join('')}</div></div>
      <div class="grid g4">${list.map((p) => `<div class="card click prof-card" style="--pc:${p.color}" ${go('#/professions/' + p.id)}>
        <div class="row"><div class="avatar">${esc(p.short)}</div><div><div class="card-title">${esc(p.name)}</div><div class="dim mono" style="font-size:12px">@${esc(p.short)} · ${esc(p.id)}</div></div><span class="spacer"></span>${badge(p.status)}</div>
        ${statBars(p)}
        <div class="card-text">默认：${esc(p.defaultOrder)} · 口粮 ${esc(fmtCost(p.upkeep))}</div>
        <div style="margin-top:6px">${p.tags.map((t) => `<span class="chip mono">@${esc(t)}</span>`).join('')}</div></div>`).join('')}</div>`;
  };
  pages.professions.mount = (root) => {
    $$('[data-pf]', root).forEach((b) => b.addEventListener('click', () => { profFilter = b.dataset.pf; renderPage('professions', true); }));
  };

  pages.matrix = () => `
    <h1>行为矩阵</h1>
    <p class="lead">行是职业，列是长期命令；格子里是"这个职业靠哪个行为完成这条命令"。空格表示接不了：给伐木工下"攻"，执行时会被跳过并在结果里说明。</p>
    <div class="matrix" style="margin-top:16px"><table>
      <tr><th style="text-align:left">职业 \\ 长期命令</th>${A.orders.map((o) => `<th ${go('#/orders/' + o.id)}>${esc(o.name)}<br><span class="dim mono" style="font-weight:400">${esc(o.id)}</span></th>`).join('')}</tr>
      ${A.professions.map((p) => `<tr><td class="rowh" ${go('#/professions/' + p.id)}><span class="chip"><span class="dot" style="background:${p.color}"></span>${esc(p.name)}</span></td>${A.orders.map((o) => {
        const bs = behsFor(p, o.id);
        const plus = o.id === 'work' && bs.length && p.behaviors.includes('deliver') ? ` <span class="dim" ${go('#/behaviors/deliver')}>+ 送回</span>` : '';
        return bs.length ? `<td class="yes" style="--pc:${p.color}">${bs.map((b) => `<span ${go('#/behaviors/' + b.id)}>${esc(b.name)}</span>`).join(' / ')}${plus}</td>` : '<td class="no">·</td>';
      }).join('')}</tr>`).join('')}
    </table></div>
    <h2>全部行为</h2>
    <div class="grid g3">${A.behaviors.map((b) => `<div class="card click" ${go('#/behaviors/' + b.id)}>
      <div class="card-title">⚙ ${esc(b.name)} <span class="dim mono">${esc(b.id)}</span><span class="spacer"></span>${ownerChip(b.module)}</div>
      <div class="card-text">${esc(b.text)}</div>
      <div class="card-text">完成：${b.support ? '辅助行为（跟在别的行为后面）' : b.fits.map((f) => (f === '*' ? '任何命令（兜底）' : esc(order(f).name))).join('、')}</div></div>`).join('')}</div>`;

  // ---------------- 命令页
  const pg = { text: '派 @木:5 伐木 北林', who: 'lord' };
  let cmdFilter = { who: 'all', q: '' };
  pages.commands = () => {
    const sampleLines = ['派 @木:5 伐木 北林', '比例 青石城 农50 木20 石10 兵20', '编 @兵@青石城:20 一队', '攻 #一队 赤焰.河口镇', '转 @农:30% 兵', '攻 @木:5 赤焰.河口镇', '信 赤焰 北林归你，河口归我，如何？', '派 @木 伐木 火星'];
    const w = A.sampleWorld;
    return `
      <h1>命令与试验台</h1>
      <p class="lead">命令 = <b>动词 + 选择器 + 参数</b>，一行一条。每条命令只定义一次：解析器、AI 命令表、上帝面板按钮、文档、契约测试都由同一份定义生成。</p>
      <div class="playground" style="margin-top:16px">
        <div class="row" style="margin-bottom:10px"><b>⌘ 命令试验台</b><span class="dim">用和游戏同一套语法实时解析（示例世界：你是 ${esc(w.me)}，城镇 ${w.myTowns.map(esc).join('、')}）</span></div>
        <div class="pg-input"><input id="pgInput" value="${esc(pg.text)}" spellcheck="false" autocomplete="off"><div class="seg"><button data-who="lord" class="${pg.who === 'lord' ? 'on' : ''}">诸侯</button><button data-who="god" class="${pg.who === 'god' ? 'on' : ''}">上帝</button></div></div>
        <div class="pg-sig" id="pgSig"></div>
        <div class="pg-out" id="pgOut"></div>
        <div class="pg-ex">${sampleLines.map((l) => `<span class="chip link" data-try="${esc(l)}">${esc(l)}</span>`).join('')}</div>
      </div>
      <h2>选择器速查 <span class="sub">选中哪些 NPC；点一下放进试验台</span></h2>
      <div class="card"><table class="t">${A.selectors.map((s) => `<tr><td style="width:200px">${s.syntax.split(' / ').map((x) => `<span class="chip link mono" data-sel="${esc(x)}">${esc(x)}</span>`).join('')}</td><td class="muted">${esc(s.meaning)}</td></tr>`).join('')}</table>
        <div class="card-text" style="margin-top:8px">选择器只能选到<b>自己势力</b>的 NPC，由命令总线统一校验。两种指挥方式并存：<b>比例</b>（系统自动分配空闲的人）和<b>直接派</b>（被派的人锁定，"放"才解除）。</div></div>
      <h2>全部命令</h2>
      <div class="filters"><div class="seg">${[['all', '全部'], ['lord', '诸侯'], ['god', '上帝']].map(([k, n]) => `<button data-cw="${k}" class="${cmdFilter.who === k ? 'on' : ''}">${n}</button>`).join('')}</div><input id="cmdQ" placeholder="筛选：动词、说明、ID…" value="${esc(cmdFilter.q)}"></div>
      <div id="cmdList">${commandList()}</div>
      <h2>AI 看到的命令表 <span class="sub">由命令定义自动生成，插进提示词</span></h2>
      <details class="card"><summary style="cursor:pointer">展开预览</summary><pre class="code" style="margin-top:12px">${esc(aiCommandTable())}</pre></details>`;
  };
  function commandList() {
    const q = cmdFilter.q.trim().toLowerCase();
    const groups = ['jobs', 'building', 'military', 'population', 'diplomacy', 'ai', 'god'];
    return groups.map((g) => {
      const list = A.commands.filter((c) => c.module === g && (cmdFilter.who === 'all' || c.who.includes(cmdFilter.who)) && (!q || (c.verb + c.id + c.help + c.examples.join(' ')).toLowerCase().includes(q)));
      if (!list.length) return '';
      return `<h3>${ownerChip(g)}</h3><div class="card" style="padding:4px 8px"><table class="t">${list.map((c) => `<tr class="click cmd-row" ${go('#/commands/' + c.id)}>
        <td><span class="verb">${esc(c.verb)}</span></td>
        <td><code class="muted">${esc(P.signature(c))}</code><div class="muted" style="font-size:12.5px">${esc(c.help)}</div></td>
        <td style="text-align:right;white-space:nowrap">${c.order ? `<span class="chip mono">→ ${esc(c.order)}</span>` : ''}${c.who.map((x) => `<span class="badge st-${x === 'god' ? 'open' : 'draft'}">${WHO[x]}</span>`).join(' ')}</td></tr>`).join('')}</table></div>`;
    }).join('') || '<p class="muted">没有匹配的命令</p>';
  }
  function aiCommandTable() {
    const lines = ['【命令】每行一条：动词 选择器 参数。<必填> [可省略]', ''];
    lines.push('选择器：' + A.selectors.map((s) => `${s.syntax.split(' / ')[0]}=${s.meaning}`).join('；'), '');
    for (const g of ['jobs', 'building', 'military', 'population', 'diplomacy', 'ai']) {
      const list = A.commands.filter((c) => c.module === g && c.who.includes('lord'));
      if (!list.length) continue;
      lines.push(`# ${g === 'ai' ? '心里话' : mod(g).name}`);
      list.forEach((c) => lines.push(`${P.signature(c)}  —— ${c.help}。例：${c.examples[0]}`));
      lines.push('');
    }
    return lines.join('\n');
  }
  function renderPlayground(root) {
    const out = $('#pgOut', root); const sig = $('#pgSig', root);
    const text = pg.text.trim();
    const verb = text.split(/\s+/)[0] || '';
    const c = IX.cmds.get(verb);
    sig.innerHTML = c ? `格式：<b style="color:#e6e9f2">${esc(P.signature(c))}</b> · ${esc(c.help)}` : text ? '输入动词开头，例如：派、攻、比例、编…' : '';
    if (!text) { out.innerHTML = ''; return; }
    const r = P.parseCommand(text, A, { ix: IX, who: pg.who });
    if (!r.ok) {
      out.innerHTML = `<div class="pg-err"><b>✗ ${esc(r.error)}</b>${r.hint ? `<div class="muted" style="margin-top:4px">💡 ${esc(r.hint)}</div>` : ''}</div>`;
      return;
    }
    const o = r.cmd.order ? order(r.cmd.order) : null;
    const warns = [...(r.warns || [])];
    if (o) {
      for (const a of r.args.filter((x) => x.type === 'sel' && Array.isArray(x.raw))) {
        for (const part of a.raw) {
          if (part.kind === 'prof') {
            const p = prof(part.prof);
            if (!profOrders(p).some((x) => x.id === o.id)) warns.push(`${p.name}接不了"${o.name}"（没有能完成它的行为），执行时这些人会被跳过并在结果里说明`);
          }
        }
      }
    }
    out.innerHTML = `<div class="pg-ok"><div class="row"><b style="color:#6ee7b7">✓ 解析成功</b>${cmdChip(r.cmd)}${ownerChip(r.cmd.module)}${o ? `<span class="muted">→ 生成长期命令</span>${orderChip(o)}` : ''}</div>
      <div style="margin-top:8px">${r.args.map((a) => `<div class="pg-arg"><b>${esc(a.name)}</b><span class="ty">${esc(a.typeName)}</span><span>${a.skipped ? '<span class="dim">（省略）</span>' : esc(a.show)}</span></div>`).join('')}</div></div>
      ${warns.map((w) => `<div class="pg-err" style="border-color:rgba(251,191,36,.4);background:rgba(251,191,36,.07)">⚠ ${esc(w)}</div>`).join('')}`;
  }
  pages.commands.mount = (root) => {
    const input = $('#pgInput', root);
    input.addEventListener('input', () => { pg.text = input.value; renderPlayground(root); });
    $$('[data-who]', root).forEach((b) => b.addEventListener('click', () => { pg.who = b.dataset.who; $$('[data-who]', root).forEach((x) => x.classList.toggle('on', x === b)); renderPlayground(root); }));
    $$('[data-sel]', root).forEach((s) => s.addEventListener('click', () => {
      const t = pg.text.trim().split(/\s+/); const verb = t[0] && IX.cmds.get(t[0]) ? t[0] : '派';
      pg.text = verb === '派' ? `派 ${s.dataset.sel} 伐木 北林` : `${verb} ${s.dataset.sel}`; input.value = pg.text; renderPlayground(root); input.focus();
    }));
    $$('[data-cw]', root).forEach((b) => b.addEventListener('click', () => { cmdFilter.who = b.dataset.cw; $$('[data-cw]', root).forEach((x) => x.classList.toggle('on', x === b)); $('#cmdList', root).innerHTML = commandList(); }));
    $('#cmdQ', root).addEventListener('input', (e) => { cmdFilter.q = e.target.value; $('#cmdList', root).innerHTML = commandList(); });
    renderPlayground(root);
  };

  pages.extend = () => `
    <h1>扩展指南</h1>
    <p class="lead">以后加东西，照着做就行。原则：<b>核心文件不用改</b>，新东西都通过模块登记。</p>
    <div class="grid g2" style="margin-top:16px">${A.recipes.map((r) => `<div class="card"><div class="card-title">${esc(r.title)}</div>
      <ol style="margin:8px 0 0;padding-left:20px;color:var(--muted);font-size:13px">${r.steps.map((s) => `<li style="margin:3px 0">${esc(s)}</li>`).join('')}</ol>
      ${r.note ? `<div class="card-text">💡 ${esc(r.note)}</div>` : ''}</div>`).join('')}</div>
    <h2>测试与守门 <span class="sub">npm test 一条命令跑全部</span></h2>
    <div class="grid g3">${A.gates.map((g) => `<div class="card"><div class="card-title">✅ ${esc(g.name)}</div><div class="card-text">${esc(g.text)}</div></div>`).join('')}</div>
    <h2>维护这个页面</h2>
    <div class="card">
      <div class="kv"><span class="k2">现在</span><span>手工维护 <code>atlas/data.js</code>，和 docs/ 里的设计文档保持一致</span>
      <span class="k2">以后</span><span><code>npm run atlas:export</code> 从代码里的模块注册表导出已实现的部分（状态"已实现"），没实现的继续留在 data.js（"草案/开发中"）</span>
      <span class="k2">每次改完</span><span><code>npm run atlas</code>：校验（引用完整、命令例子都能解析、能力事实）→ 生成单文件 <code>docs/atlas.html</code></span>
      <span class="k2">本地预览</span><span><code>npm run atlas:serve</code>，浏览器打开 http://localhost:8080</span></div>
    </div>`;

  pages.roadmap = () => `
    <h1>路线图</h1>
    <p class="lead">每个阶段都带测试和压测，单独提交。<b>第 3 阶段结束是第一个关键验收点</b>：用真实模型跑一局，看冲突够不够、好不好看。</p>
    <div class="timeline" style="margin-top:18px">${A.roadmap.map((r) => `<div class="tl-item ${r.status}"><div class="card">
      <div class="card-title">阶段 ${r.stage} · ${esc(r.name)} ${badge(r.status)}</div>
      <div class="card-text">${esc(r.text)}</div><div class="card-text">🎯 ${esc(r.goal)}</div>
      <div style="margin-top:6px">${A.modules.filter((m) => m.stage === r.stage).map((m) => `<span class="chip link" ${go('#/modules/' + m.id)}>${m.icon} ${esc(m.name)}</span>`).join('')}</div></div></div>`).join('')}</div>`;

  pages.decisions = () => `
    <h1>待定事项</h1>
    <p class="lead">需要你拍板的问题。定下来后会改成"已定"，并同步到设计文档。</p>
    <div class="card" style="margin-top:16px;padding:6px 10px"><table class="t"><tr><th>问题</th><th>建议</th><th style="width:80px">状态</th></tr>
      ${A.decisions.map((d) => `<tr><td>${esc(d.q)}</td><td class="muted">${esc(d.proposal)}</td><td>${badge(d.status)}</td></tr>`).join('')}</table></div>`;

  // ------------------------------------------------------------ 抽屉
  const drawers = {};

  drawers.layers = (l) => {
    const deps = l.deps.map(layer); const users = layerDependents(l.id);
    let extra = '';
    if (l.id === 'game') extra = `<h3>模块（${A.modules.length}）</h3>${A.modules.map((m) => `<span class="chip link" ${go('#/modules/' + m.id)}>${m.icon} ${esc(m.name)}</span>`).join('')}`;
    if (l.id === 'engine') extra = `<h3>内核负责的组件</h3>${A.components.filter((c) => c.owner === 'engine').map(compChip).join('')}<h3>内核动作</h3><span class="chip mono">moveTo</span><span class="chip mono">wait</span>`;
    if (l.id === 'ai') extra = `<h3>AI 层的命令</h3>${A.commands.filter((c) => c.module === 'ai').map(cmdChip).join('')}`;
    if (l.id === 'content') extra = `<h3>职业数据（${A.professions.length}）</h3>${A.professions.map(profChip).join('')}`;
    return { kind: '分层', title: `<span class="dot" style="width:14px;height:14px;border-radius:5px;background:${l.color};display:inline-block"></span>${esc(l.name)} <span class="dim mono" style="font-size:15px">${esc(l.en)}</span>`, sub: badge(l.status),
      body: `<p>${esc(l.role)}</p>
        <div class="kv"><span class="k2">目录</span><span>${l.dirs.map((d) => `<code>${esc(d)}</code>`).join(' ')}</span>
        <span class="k2">包含</span><span>${plainChips(l.items, true)}</span>
        <span class="k2">依赖</span><span>${deps.map(layerChip).join('') || '<span class="dim">无（最底层）</span>'}</span>
        <span class="k2">被依赖</span><span>${users.map(layerChip).join('') || '<span class="dim">无</span>'}</span></div>${extra}` };
  };

  drawers.modules = (m) => {
    const behs = A.behaviors.filter((b) => b.module === m.id);
    const cmds = A.commands.filter((c) => c.module === m.id);
    const sec = (title, html) => `<h3>${title}</h3><div class="contrib">${html}</div>`;
    const files = ['index.ts'];
    if ((m.components || []).length) files.push('components.ts');
    if ((m.systems || []).length) files.push('systems/');
    if ((m.actions || []).length) files.push('actions.ts');
    if ((m.orders || []).length) files.push('orders.ts');
    if (behs.length) files.push('behaviors/');
    if (cmds.length) files.push('commands.ts');
    if ((m.events || []).length) files.push('events.ts');
    if ((m.briefing || []).length) files.push('briefing.ts');
    if ((m.views || []).length) files.push('views.ts');
    if (m.config) files.push('config.ts');
    if (m.save) files.push('save.ts');
    files.push('tests/');
    const tree = `src/game/modules/${m.id}/\n` + files.map((f, i) => `${i === files.length - 1 ? '└─' : '├─'} ${f}`).join('\n');
    return { kind: '模块', title: `${m.icon} ${esc(m.name)} <span class="dim mono" style="font-size:15px">${esc(m.id)}</span>`, sub: `${badge(m.status)} <span class="dim">阶段 ${m.stage}</span>`,
      body: `<p>${esc(m.summary)}</p>
        <div class="kv"><span class="k2">依赖</span><span>${m.requires.map(ownerChip).join('') || '<span class="dim">无</span>'}</span>
        <span class="k2">被依赖</span><span>${dependents(m.id).map((x) => ownerChip(x.id)).join('') || '<span class="dim">无</span>'}</span></div>
        ${sec('组件 components', (m.components || []).map((c) => compChip(comp(c))).join('') || '<span class="dim">—</span>')}
        ${sec('长期命令 orders', (m.orders || []).map((o) => orderChip(order(o))).join('') || '<span class="dim">—</span>')}
        ${sec('行为 behaviors', behs.map(behChip).join('') || '<span class="dim">—</span>')}
        ${sec('命令 commands', cmds.map(cmdChip).join('') || '<span class="dim">—</span>')}
        ${sec('动作 actions', plainChips(m.actions, true))}
        ${sec('系统 systems', plainChips(m.systems))}
        ${sec('事件 events', plainChips(m.events, true))}
        ${sec('唤醒 AI 的事件 wake', plainChips(m.wake, true))}
        ${sec('AI 简报段落 briefing', plainChips(m.briefing))}
        ${sec('前端数据通道 views', plainChips(m.views, true))}
        ${sec('内容数据 content', plainChips(m.content, true))}
        ${sec('配置 config', plainChips(m.config))}
        ${sec('存档 save', m.save ? `<span class="chip">${esc(m.save)}</span>` : '<span class="dim">—</span>')}
        <h3>文件夹（规划）</h3><pre class="code">${esc(tree)}</pre>` };
  };

  drawers.professions = (p) => {
    const orders = profOrders(p);
    const pcs = P.professionCommands(p, A);
    const mainSteps = [beh(p.behaviors[0])].concat(p.behaviors.includes('deliver') && p.behaviors[0] !== 'deliver' ? [beh('deliver')] : []).flatMap((b) => b.loop);
    const comps = A.components.filter((c) => c.base).map(compChip).join('') + optionalCompsFor(p).map((id) => compChip(comp(id))).join('');
    const code = `// content/professions/${p.id}.ts\nexport default defineProfession({\n  id: '${p.id}', name: '${p.name}', short: '${p.short}',\n  tags: ${lit(p.tags)},\n  stats: ${lit(p.stats)},\n  behaviors: ${lit(p.behaviors)},\n  defaultOrder: '${p.defaultOrder}',\n  tools: ${lit(p.tools)},\n  upkeep: ${lit(p.upkeep)},\n  train: ${lit(p.train)},\n});`;
    return { kind: '职业', title: `<div class="avatar lg" style="--pc:${p.color}">${esc(p.short)}</div><div>${esc(p.name)}<div class="dim mono" style="font-size:13px;font-weight:400">@${esc(p.short)} · ${esc(p.id)}</div></div>`,
      sub: `${badge(p.status)} ${p.tags.map((t) => `<span class="chip mono">@${esc(t)}</span>`).join('')}`,
      body: `<p>${esc(p.text)}</p>
        <h3>属性</h3>${statBars(p)}
        <div class="kv" style="margin-top:12px"><span class="k2">默认命令</span><span>${esc(p.defaultOrder)}</span>
        <span class="k2">工具加成</span><span>${Object.keys(p.tools).length ? Object.entries(p.tools).map(([k, v]) => `<span class="chip">${esc(k)} ×${v}</span>`).join('') : '<span class="dim">无</span>'}</span>
        <span class="k2">每天口粮</span><span>${esc(fmtCost(p.upkeep))}</span>
        <span class="k2">转职成本</span><span>${esc(fmtCost(p.train.cost))} · ${p.train.days} 天</span></div>
        <h3>干活循环</h3><div class="loop" style="--pc:${p.color}">${mainSteps.map((s) => `<span>${esc(s)}</span>`).join('')}</div>
        <h3>行为（按优先级）</h3>
        <table class="t">${p.behaviors.map((id, i) => { const b = beh(id); return `<tr class="click" ${go('#/behaviors/' + b.id)}><td style="width:28px" class="dim mono">${i + 1}</td><td>⚙ ${esc(b.name)} <span class="dim mono">${esc(b.id)}</span></td><td class="muted">${b.support ? '辅助' : b.fits.map((f) => (f === '*' ? '兜底' : esc(order(f).name))).join('、')}</td></tr>`; }).join('')}</table>
        <h3>能接的长期命令</h3>${orders.map(orderChip).join('')}
        <h3>控制命令（${pcs.length}）</h3>
        <div>${pcs.map((x) => `<div class="ex-row">${cmdline(x.example)}<button class="btn sm" data-copy="${esc(x.example)}">复制</button><button class="btn sm" data-try="${esc(x.example)}">试一试</button><span class="why">${esc(x.cmd.help.split('，')[0].split('（')[0])}</span></div>`).join('')}</div>
        <div class="card-text">选择器还可以写成 <code>@${esc(p.short)}@青石城</code>（限定城镇）、<code>@${esc(p.short)}:30%</code>（按比例）、<code>@${esc(p.tags[0])}</code>（按标签）。</div>
        <h3>组件</h3>${comps}
        <h3>数据定义</h3><pre class="code">${hl(code)}</pre>` };
  };

  drawers.commands = (c) => {
    const o = c.order ? order(c.order) : null;
    const ps = o ? profsForOrder(o.id) : [];
    const argsCode = c.args.map(([n, t]) => (n.endsWith('?') ? `${t}('${n.replace('?', '')}', { optional: true })` : `${t}('${n}')`)).join(', ');
    const code = `export const ${c.id}: CommandDef = {\n  id: '${c.id}', verb: '${c.verb}', module: '${c.module}',\n  who: ${lit(c.who)},\n  args: [${argsCode}],${o ? `\n  order: '${o.id}',` : ''}\n  help: '${c.help}',\n  examples: ${lit(c.examples)},\n  run(ctx, args) { /* 校验 → 执行（写长期命令 / 调动作）→ 返回结果 */ },\n};`;
    return { kind: '命令', title: `<span class="verb" style="font-size:28px">${esc(c.verb)}</span> <span class="dim mono" style="font-size:15px">${esc(c.id)}</span>`,
      sub: `${ownerChip(c.module)} ${c.who.map((x) => `<span class="badge st-${x === 'god' ? 'open' : 'draft'}">${WHO[x]}</span>`).join(' ')}`,
      body: `<p>${esc(c.help)}</p>
        <h3>格式</h3><pre class="code">${esc(P.signature(c))}</pre>
        <h3>参数</h3><table class="t"><tr><th>参数</th><th>类型</th><th>必填</th></tr>${c.args.map(([n, t]) => `<tr><td>${esc(n.replace('?', ''))}</td><td><code>${esc(t)}</code> <span class="muted">${esc(P.TYPES[t].name)}</span></td><td>${n.endsWith('?') ? '<span class="dim">可省略</span>' : '是'}</td></tr>`).join('')}</table>
        ${o ? `<h3>生成的长期命令</h3>${orderChip(o)}<h3>能接这条命令的职业（${ps.length}）</h3>${ps.map(profChip).join('') || '<span class="dim">无</span>'}` : ''}
        <h3>例子</h3>${c.examples.map((e) => `<div class="ex-row">${cmdline(e)}<button class="btn sm" data-copy="${esc(e)}">复制</button><button class="btn sm" data-try="${esc(e)}">试一试</button></div>`).join('')}
        <h3>这一份定义自动用于</h3>${['文本解析器', 'AI 提示词命令表', '上帝面板按钮', 'docs/commands.md', '契约测试（例子必须执行成功）'].map((x) => `<span class="chip">✓ ${x}</span>`).join('')}
        <h3>定义（草案）</h3><pre class="code">${hl(code)}</pre>` };
  };

  drawers.components = (c) => {
    const users = c.base ? A.professions : A.professions.filter((p) => optionalCompsFor(p).includes(c.id));
    return { kind: '组件', title: `<code style="color:#c4b5fd">${esc(c.id)}</code> ${esc(c.name)}`, sub: `${ownerChip(c.owner)} ${c.base ? '<span class="chip">基础组件：每个 NPC 都有</span>' : '<span class="chip">可选组件</span>'}`,
      body: `<h3>字段</h3><table class="t"><tr><th>字段</th><th>类型</th><th>说明</th></tr>${c.fields.map((f) => `<tr><td><code>${esc(f[0])}</code></td><td class="mono dim">${esc(f[1])}</td><td>${esc(f[2])}</td></tr>`).join('')}</table>
        <div class="row" style="margin-top:10px"><span class="chip">约 ${compBytes(c)} 字节 / 人</span><span class="chip">按列存放：同一字段的所有 NPC 在一个紧凑数组里</span></div>
        <h3>哪些职业有它（${users.length}）</h3>${users.map(profChip).join('') || '<span class="dim">暂无</span>'}` };
  };

  drawers.orders = (o) => {
    const bs = A.behaviors.filter((b) => b.fits.includes(o.id));
    return { kind: '长期命令 Order', title: `📋 ${esc(o.name)} <span class="dim mono" style="font-size:15px">${esc(o.id)}</span>`, sub: ownerChip(o.module),
      body: `<p>${esc(o.text)}</p>
        <div class="kv"><span class="k2">参数</span><span>${o.params.map((x) => `<code>${esc(x)}</code>`).join(' ') || '<span class="dim">无</span>'}</span></div>
        <h3>由哪些命令生成</h3>${commandsFor(o.id).map(cmdChip).join('') || '<span class="dim">无（只作为默认命令）</span>'}
        <h3>能完成它的行为</h3>${bs.map(behChip).join('')}
        <h3>能接它的职业（${profsForOrder(o.id).length}）</h3>${profsForOrder(o.id).map(profChip).join('') || '<span class="dim">无</span>'}
        <div class="card-text" style="margin-top:14px">一个编组共用一条 Order：500 个人接同一条命令只存一份；改它，NPC 下次空闲时自然换活。</div>` };
  };

  drawers.behaviors = (b) => {
    const ps = A.professions.filter((p) => p.behaviors.includes(b.id));
    const code = `export const ${b.id}: BehaviorDef = {\n  id: '${b.id}',\n  fits(npc, order, ctx) { /* ${b.support ? '辅助行为：由前一个行为接力调用，这里返回 0' : '能完成 ' + b.fits.join(' / ') + ' 时返回优先级，做不了返回 0'} */ },\n  start(npc, ctx) { },\n  tick(npc, ctx) { /* ${b.loop.join(' → ')} */ return 'running'; },\n  coarse(npc, ctx, dt) { /* 远处粗算：按时间推进 */ },\n};`;
    return { kind: '行为 Behavior', title: `⚙ ${esc(b.name)} <span class="dim mono" style="font-size:15px">${esc(b.id)}</span>`, sub: `${ownerChip(b.module)} ${b.coarse ? '<span class="chip">支持远处粗算</span>' : ''}`,
      body: `<p>${esc(b.text)}</p>
        <h3>循环</h3><div class="loop">${b.loop.map((s) => `<span>${esc(s)}</span>`).join('')}</div>
        <h3>能完成的长期命令</h3>${b.support ? '<span class="chip">辅助行为：不单独完成命令，跟在采集、耕种后面自动接上</span>' : b.fits.map((f) => (f === '*' ? '<span class="chip">任何命令（兜底）</span>' : orderChip(order(f)))).join('')}
        <h3>调用的动作</h3>${plainChips(b.acts, true)}
        <h3>哪些职业会做（${ps.length}）</h3>${ps.map(profChip).join('')}
        <h3>接口（草案）</h3><pre class="code">${hl(code)}</pre>` };
  };

  const FINDERS = { layers: layer, modules: mod, professions: prof, commands: cmd, components: comp, orders: order, behaviors: beh };

  function openDrawer(sec, id) {
    const item = FINDERS[sec] && FINDERS[sec](decodeURIComponent(id));
    const dr = $('#drawer');
    if (!item) { closeDrawerUI(); return null; }
    const d = drawers[sec](item);
    clearTimers(drawerTimers);
    dr.innerHTML = `<div class="dr-head"><button class="dr-close" type="button" data-close>✕</button><div class="dr-kind">${esc(d.kind)}</div><div class="dr-title">${d.title}</div><div class="row">${d.sub || ''}</div></div><div class="dr-body">${d.body}</div>`;
    dr.scrollTop = 0;
    dr.classList.add('on'); dr.setAttribute('aria-hidden', 'false'); $('#scrim').classList.add('on');
    animateLoop(dr, drawerTimers, 850);
    return item;
  }
  function closeDrawerUI() {
    clearTimers(drawerTimers);
    $('#drawer').classList.remove('on'); $('#drawer').setAttribute('aria-hidden', 'true'); $('#scrim').classList.remove('on');
  }

  // ------------------------------------------------------------ 路由
  let currentPage = null;
  function renderPage(page, force) {
    if (page === currentPage && !force) return;
    currentPage = page;
    clearTimers(pageTimers);
    const view = $('#view');
    view.innerHTML = pages[page]();
    view.style.animation = 'none'; void view.offsetHeight; view.style.animation = '';
    if (pages[page].mount) pages[page].mount(view);
    if (!force) $('#main').scrollTop = 0;
    renderNav(page);
  }
  function route() {
    const parts = location.hash.replace(/^#\/?/, '').split('/');
    let sec = parts[0] || 'overview'; const id = parts.slice(1).join('/');
    if (!pages[sec] && !PAGE_OF[sec]) sec = 'overview';
    const page = PAGE_OF[sec] || sec;
    renderPage(page);
    const secName = (SECTIONS.find((s) => s.id === page) || {}).name || '';
    let itemName = '';
    if (id) { const item = openDrawer(sec, id); if (item) itemName = item.name || item.verb || item.id; } else closeDrawerUI();
    $('#crumb').innerHTML = `架构图谱 / <b>${esc(secName)}</b>${itemName ? ' / ' + esc(itemName) : ''}`;
    document.title = `${itemName || secName} · ${A.meta.title}`;
  }
  function closeDrawer() {
    const parts = location.hash.replace(/^#\/?/, '').split('/');
    if (parts.length > 1) location.hash = '#/' + (PAGE_OF[parts[0]] || parts[0]); else closeDrawerUI();
  }

  // ------------------------------------------------------------ 搜索
  const searchIndex = [
    ...A.layers.map((l) => ({ kind: '分层', title: `${l.name} ${l.en}`, desc: l.role, go: '#/layers/' + l.id })),
    ...A.modules.map((m) => ({ kind: '模块', title: `${m.icon} ${m.name} ${m.id}`, desc: m.summary, go: '#/modules/' + m.id })),
    ...A.professions.map((p) => ({ kind: '职业', title: `${p.name} @${p.short}`, desc: p.text, go: '#/professions/' + p.id, extra: p.id })),
    ...A.commands.map((c) => ({ kind: '命令', title: `${c.verb}  ${c.id}`, desc: c.help, go: '#/commands/' + c.id, extra: c.examples.join(' ') })),
    ...A.components.map((c) => ({ kind: '组件', title: `${c.id} ${c.name}`, desc: c.fields.map((f) => f[0]).join(' '), go: '#/components/' + c.id })),
    ...A.orders.map((o) => ({ kind: '长期命令', title: `${o.name} ${o.id}`, desc: o.text, go: '#/orders/' + o.id })),
    ...A.behaviors.map((b) => ({ kind: '行为', title: `${b.name} ${b.id}`, desc: b.text, go: '#/behaviors/' + b.id })),
    ...SECTIONS.filter((s) => s.id).map((s) => ({ kind: '页面', title: s.name, desc: '', go: '#/' + s.id })),
  ].map((e) => ({ ...e, key: (e.title + ' ' + e.desc + ' ' + (e.extra || '')).toLowerCase() }));
  let palSel = 0; let palHits = [];
  function openPalette() { $('#palette').classList.add('on'); const i = $('#palInput'); i.value = ''; renderPalette(); setTimeout(() => i.focus(), 10); }
  function closePalette() { $('#palette').classList.remove('on'); }
  function renderPalette() {
    const q = $('#palInput').value.trim().toLowerCase();
    const toks = q.split(/\s+/).filter(Boolean);
    palHits = (toks.length ? searchIndex.filter((e) => toks.every((t) => e.key.includes(t))) : searchIndex.filter((e) => e.kind === '页面' || e.kind === '职业')).slice(0, 40);
    palSel = Math.min(palSel, Math.max(0, palHits.length - 1));
    $('#palList').innerHTML = palHits.map((e, i) => `<div class="pal-item${i === palSel ? ' on' : ''}" data-i="${i}"><span class="kind">${esc(e.kind)}</span><span>${esc(e.title)}</span><span class="desc">${esc(e.desc)}</span></div>`).join('') || '<div class="pal-item dim">没有结果</div>';
  }
  function pickPalette(i) { const e = palHits[i]; if (!e) return; closePalette(); location.hash = e.go; }

  // ------------------------------------------------------------ 全局事件
  document.addEventListener('click', (ev) => {
    const t = ev.target;
    const cp = t.closest('[data-copy]'); if (cp) { ev.stopPropagation(); copy(cp.dataset.copy); return; }
    const tr = t.closest('[data-try]');
    if (tr) {
      ev.stopPropagation(); pg.text = tr.dataset.try;
      if (currentPage === 'commands' && !location.hash.split('/')[2]) { const inp = $('#pgInput'); inp.value = pg.text; renderPlayground($('#view')); inp.focus(); }
      else { currentPage = null; location.hash = '#/commands'; }
      return;
    }
    if (t.closest('[data-close]') || t.id === 'scrim') { closeDrawer(); return; }
    const pi = t.closest('.pal-item[data-i]'); if (pi) { pickPalette(+pi.dataset.i); return; }
    if (t.id === 'palette') { closePalette(); return; }
    const g = t.closest('[data-go]'); if (g) { ev.preventDefault(); location.hash = g.dataset.go; }
  });
  $('#searchBtn').addEventListener('click', openPalette);
  $('#palInput').addEventListener('input', () => { palSel = 0; renderPalette(); });
  document.addEventListener('keydown', (ev) => {
    const palOpen = $('#palette').classList.contains('on');
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); palOpen ? closePalette() : openPalette(); return; }
    if (palOpen) {
      if (ev.key === 'Escape') closePalette();
      else if (ev.key === 'ArrowDown') { ev.preventDefault(); palSel = Math.min(palSel + 1, palHits.length - 1); renderPalette(); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); palSel = Math.max(palSel - 1, 0); renderPalette(); }
      else if (ev.key === 'Enter') pickPalette(palSel);
      return;
    }
    if (ev.key === 'Escape' && $('#drawer').classList.contains('on')) closeDrawer();
    if (ev.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { ev.preventDefault(); openPalette(); }
  });
  window.addEventListener('hashchange', route);
  route();
})();
