// 命令与选择器解析（浏览器和 Node 共用；不依赖任何库）。
//
// 这是第 0 阶段之前的**规格原型**：语法和将来 src/engine/commands/ 的解析器保持一致，
// 图谱页面的"命令试验台"和 tools/check-atlas.mjs 都用它。
(function () {
  'use strict';

  function index(atlas) {
    const profs = new Map();
    for (const p of atlas.professions) {
      profs.set(p.id, p); profs.set(p.name, p); profs.set(p.short, p);
    }
    const tags = new Set(atlas.professions.flatMap((p) => p.tags));
    const cmds = new Map();
    for (const c of atlas.commands) { cmds.set(c.verb, c); cmds.set(c.id, c); }
    return { profs, tags, cmds, w: atlas.sampleWorld };
  }

  const ok = (value, show) => ({ ok: true, value, show });
  const bad = (error, hint) => ({ ok: false, error, hint });

  // ---------------------------------------------------------------- 选择器
  // 一段：头部（@职业|@标签|*|#队伍|人名）+ 可选 @地点 + 可选 :数量 / :百分比，用逗号多选
  function parseSelector(text, ix) {
    if (!text) return bad('缺少选择器', '例：@木:5、#一队、阿三');
    const parts = [];
    for (const raw of text.split(',')) {
      const seg = raw.trim();
      if (!seg) return bad('选择器里有空段', '多选用逗号隔开：@木,@石');
      let i = 0; const part = { raw: seg };
      const readName = () => { let s = ''; while (i < seg.length && seg[i] !== '@' && seg[i] !== ':') s += seg[i++]; return s; };
      if (seg[0] === '@') {
        i = 1; const n = readName();
        const p = ix.profs.get(n);
        if (p) { part.kind = 'prof'; part.prof = p.id; part.label = p.name; }
        else if (ix.tags.has(n)) { part.kind = 'tag'; part.tag = n; part.label = '标签 ' + n; }
        else return bad(`没有叫"${n}"的职业或标签`, '职业简称：' + [...new Set([...ix.profs.values()].map((x) => x.short))].join(' '));
      } else if (seg[0] === '*') {
        i = 1; part.kind = 'all'; part.label = '所有人';
      } else if (seg[0] === '#') {
        i = 1; const n = readName();
        if (!n) return bad('# 后面要写队名');
        part.kind = 'group'; part.group = n; part.label = '队伍 ' + n;
        if (!ix.w.groups.includes(n)) part.warn = `示例世界里还没有队伍"${n}"（真实游戏里要先"编"）`;
      } else {
        const n = readName();
        if (!ix.w.people.includes(n) && !ix.w.notables.includes(n)) return bad(`不认识"${n}"`, '选职业要加 @，选队伍要加 #；人名示例：' + ix.w.people.join('、'));
        part.kind = 'person'; part.person = n; part.label = n;
      }
      while (i < seg.length) {
        if (seg[i] === '@') {
          i++; const pl = readName();
          if (!ix.w.places.includes(pl)) return bad(`没有地点"${pl}"`, '示例地点：' + ix.w.places.join('、'));
          if (part.place) return bad('一段选择器只能限定一个地点');
          part.place = pl;
        } else if (seg[i] === ':') {
          i++; let num = ''; while (i < seg.length && /[0-9]/.test(seg[i])) num += seg[i++];
          let pct = false; if (seg[i] === '%') { pct = true; i++; }
          const n = parseInt(num, 10);
          if (!num || n <= 0) return bad('冒号后面要写正整数', '例：@木:5 或 @农:30%');
          if (pct && n > 100) return bad('百分比不能超过 100');
          if (part.kind === 'person') return bad('指定某个人时不能再写数量');
          if (pct) part.percent = n; else part.count = n;
        } else return bad(`选择器"${seg}"写法不对`);
      }
      parts.push(part);
    }
    const show = parts.map((p) => {
      let s = p.label;
      if (p.place) s = p.place + '的' + s;
      if (p.count) s += ` ×${p.count}`;
      if (p.percent) s += ` ${p.percent}%`;
      return s;
    }).join(' + ');
    return ok(parts, show);
  }

  // ---------------------------------------------------------------- 参数类型
  const TYPES = {
    sel: { name: '选择器', parse: (t, ix) => parseSelector(t, ix) },
    town: { name: '己方城镇', parse: (t, ix) => (ix.w.myTowns.includes(t) ? ok(t) : bad(`"${t}"不是你的城镇`, '你的城镇：' + ix.w.myTowns.join('、'))) },
    place: { name: '地点', parse: (t, ix) => (ix.w.places.includes(t) ? ok(t) : bad(`没有地点"${t}"`, '示例地点：' + ix.w.places.join('、'))) },
    target: { name: '目标', parse: (t, ix) => {
      if (t.includes('.')) {
        const [f, town] = t.split('.');
        if (!ix.w.factions.includes(f)) return bad(`没有势力"${f}"`);
        if (!(ix.w.towns[f] || []).includes(town)) return bad(`${f}没有城镇"${town}"`, `${f}的城镇：` + (ix.w.towns[f] || []).join('、'));
        return ok({ faction: f, town }, `${f} 的 ${town}`);
      }
      return ix.w.places.includes(t) ? ok({ place: t }, t) : bad(`没有目标"${t}"`, '写成 势力.城镇 或地点名');
    } },
    work: { name: '活', parse: (t, ix) => (ix.w.works[t] ? ok(t, `${t}（${ix.profs.get(ix.w.works[t]).name}的活）`) : bad(`没有"${t}"这种活`, '可选：' + Object.keys(ix.w.works).join('、'))) },
    prof: { name: '职业', parse: (t, ix) => { const p = ix.profs.get(t); return p ? ok(p.id, p.name) : bad(`没有职业"${t}"`); } },
    item: { name: '物品', parse: (t, ix) => (ix.w.items.includes(t) ? ok(t) : bad(`没有物品"${t}"`, '可选：' + ix.w.items.join('、'))) },
    building: { name: '建筑', parse: (t, ix) => (ix.w.buildings.includes(t) ? ok(t) : bad(`没有建筑"${t}"`, '可选：' + ix.w.buildings.join('、'))) },
    group: { name: '队名', parse: (t) => { const n = t.replace(/^#/, ''); return n ? ok(n, '#' + n) : bad('缺少队名'); } },
    faction: { name: '势力', parse: (t, ix) => (t === ix.w.me ? bad('不能对自己') : ix.w.factions.includes(t) ? ok(t) : bad(`没有势力"${t}"`, '示例势力：' + ix.w.factions.filter((f) => f !== ix.w.me).join('、'))) },
    notable: { name: '名人', parse: (t, ix) => (ix.w.notables.includes(t) ? ok(t) : bad(`不认识名人"${t}"`, '示例：' + ix.w.notables.join('、'))) },
    int: { name: '整数', parse: (t) => (/^\d+$/.test(t) ? ok(parseInt(t, 10)) : bad(`"${t}"不是整数`)) },
    amount: { name: '数量', parse: (t, ix) => {
      const items = [...ix.w.items].sort((a, b) => b.length - a.length);
      for (const it of items) {
        let m = t.match(new RegExp('^' + it + '(\\d+)$')); if (m) return ok({ item: it, n: +m[1] }, `${it} ${m[1]}`);
        m = t.match(new RegExp('^(\\d+)' + it + '$')); if (m) return ok({ item: it, n: +m[1] }, `${it} ${m[1]}`);
      }
      return bad(`"${t}"不是数量写法`, '例：粮200 或 300金');
    } },
    duration: { name: '时长', parse: (t) => { const m = t.match(/^(\d+)(天|日|季|年)$/); return m ? ok({ n: +m[1], unit: m[2] }, t) : bad(`"${t}"不是时长`, '例：30天、2季'); } },
    treaty: { name: '条约', parse: (t, ix) => (ix.w.treaties.includes(t) ? ok(t) : bad(`没有条约"${t}"`, '可选：' + ix.w.treaties.join('、'))) },
    disaster: { name: '天灾', parse: (t, ix) => (ix.w.disasters.includes(t) ? ok(t) : bad(`没有天灾"${t}"`, '可选：' + ix.w.disasters.join('、'))) },
    quota: { name: '职业比例', rest: true, parse: (toks, ix) => {
      if (!toks.length) return bad('缺少比例', '例：农50 木20 兵30');
      const out = []; let sum = 0;
      for (const t of toks) {
        const m = t.match(/^(\D+?)(\d+)%?$/);
        const p = m && ix.profs.get(m[1]);
        if (!p) return bad(`"${t}"不是"职业+数字"`, '例：农50');
        out.push({ prof: p.id, pct: +m[2] }); sum += +m[2];
      }
      if (sum > 100) return bad(`比例加起来 ${sum}，超过 100`);
      return ok(out, out.map((o) => `${ix.profs.get(o.prof).name} ${o.pct}%`).join('，') + (sum < 100 ? `（余下 ${100 - sum}% 不指定）` : ''));
    } },
    text: { name: '文字', rest: true, parse: (toks) => (toks.length ? ok(toks.join(' ')) : bad('缺少内容')) },
  };

  // ---------------------------------------------------------------- 命令
  function parseCommand(line, atlas, opts) {
    const ix = opts && opts.ix ? opts.ix : index(atlas);
    const who = (opts && opts.who) || null;
    const toks = String(line || '').trim().split(/\s+/).filter(Boolean);
    if (!toks.length) return { ok: false, error: '空命令' };
    const verb = toks[0];
    const cmd = ix.cmds.get(verb);
    if (!cmd) {
      const near = atlas.commands.filter((c) => c.verb.includes(verb) || verb.includes(c.verb)).map((c) => c.verb);
      return { ok: false, error: `没有命令"${verb}"`, hint: near.length ? '是不是：' + near.join('、') : '命令列表见"命令"一页' };
    }
    if (who && !cmd.who.includes(who)) return { ok: false, cmd, error: `"${cmd.verb}"不是${who === 'god' ? '上帝' : '诸侯'}能用的命令` };
    const args = []; let k = 1;
    for (const [rawName, type] of cmd.args) {
      const optional = rawName.endsWith('?'); const name = rawName.replace('?', '');
      const T = TYPES[type];
      if (!T) return { ok: false, cmd, error: `内部错误：未知参数类型 ${type}` };
      if (T.rest) {
        const res = T.parse(toks.slice(k), ix); k = toks.length;
        if (!res.ok) return { ok: false, cmd, args, error: `${name}：${res.error}`, hint: res.hint };
        args.push({ name, type, typeName: T.name, raw: res.value, show: res.show || String(res.value) });
        continue;
      }
      if (k >= toks.length) {
        if (optional) { args.push({ name, type, typeName: T.name, skipped: true }); continue; }
        return { ok: false, cmd, args, error: `缺少参数：${name}（${T.name}）`, hint: '格式：' + signature(cmd) };
      }
      const res = T.parse(toks[k], ix);
      if (!res.ok) return { ok: false, cmd, args, error: `${name}：${res.error}`, hint: res.hint };
      args.push({ name, type, typeName: T.name, token: toks[k], raw: res.value, show: res.show || String(res.value) });
      k++;
    }
    if (k < toks.length) return { ok: false, cmd, args, error: `多了参数：${toks.slice(k).join(' ')}`, hint: '格式：' + signature(cmd) };
    const warns = args.flatMap((a) => (a.type === 'sel' && Array.isArray(a.raw) ? a.raw.filter((p) => p.warn).map((p) => p.warn) : []));
    return { ok: true, cmd, args, warns };
  }

  function signature(cmd) {
    return cmd.verb + ' ' + cmd.args.map(([n, t]) => {
      const opt = n.endsWith('?'); const name = n.replace('?', '');
      const s = (TYPES[t] && TYPES[t].rest) ? name + '…' : name;
      return opt ? `[${s}]` : `<${s}>`;
    }).join(' ');
  }

  // ---------------------------------------------------------------- 推导：职业 → 能接的命令
  function professionOrders(prof, atlas) {
    const bs = atlas.behaviors.filter((b) => prof.behaviors.includes(b.id));
    return atlas.orders.filter((o) => bs.some((b) => b.fits.includes(o.id)));
  }

  function professionCommands(prof, atlas) {
    const w = atlas.sampleWorld;
    const orderIds = new Set(professionOrders(prof, atlas).map((o) => o.id));
    const myWork = Object.keys(w.works).find((k) => w.works[k] === prof.id);
    const sel = `@${prof.short}:5`;
    const fill = { town: '青石城', place: '北林', target: '赤焰.河口镇', item: '木头', prof: prof.id === 'soldier' ? '农' : '兵',
      group: prof.short + '队', faction: '白鹿', building: '兵营', int: '10', duration: '30天' };
    const out = [];
    for (const c of atlas.commands) {
      if (!c.who.includes('lord')) continue;
      const selArgs = c.args.filter(([, t]) => t === 'sel');
      if (c.id === 'quota') {
        const other = prof.short === '农' ? '木' : '农';
        out.push({ cmd: c, example: `比例 青石城 ${prof.short}30 ${other}50`, why: '职业比例里写上它' });
        continue;
      }
      if (!selArgs.length) continue;
      if (c.order && !orderIds.has(c.order)) continue;
      if (c.order === 'work' && !myWork) continue;
      const parts = [c.verb]; let firstSel = true;
      const places = c.id === 'build' ? ['青石城'] : ['北林', '青石城'];
      for (const [n, t] of c.args) {
        const optional = n.endsWith('?');
        if (t === 'sel') {
          if (firstSel) { parts.push(sel); firstSel = false; } else if (!optional) parts.push('#商队');
          else parts.push(sel);
        } else if (t === 'work') parts.push(myWork);
        else if (t === 'place') { if (!optional || c.id !== 'retreat') parts.push(places.shift() || '北林'); }
        else if (!optional) parts.push(fill[t] || '?');
      }
      out.push({ cmd: c, example: parts.join(' '), why: c.order ? `长期命令 ${c.order}` : '通用' });
    }
    return out;
  }

  globalThis.AtlasParser = { index, parseSelector, parseCommand, signature, professionOrders, professionCommands, TYPES };
})();
