// ⚙ 设置面板：表单完全由服务器发来的 SettingDef 生成（服务端加一项设置，这里不用改）。
// 只把改过的项发回去；密钥类留空 = 不改。被环境变量锁定的项只读。
// 同一个面板还当「开始界面」用（lobby 模式）：服务器没开局时整页显示，设置好才能开始；有存档可继续，也可清空存档。
import type { ClientMsg, SaveInfo, SettingDef, SettingValue, SettingsMsg } from '../../protocol/messages';
import { $, esc, toast } from '../util';

type Patch = Record<string, SettingValue | null>;
const APPLY: Record<SettingDef['apply'], [string, string]> = {
  live: ['立即生效', 'live'],
  world: ['开新局时生效', 'world'],
  restart: ['重启服务器后生效', 'restart'],
};

export class SettingsPanel {
  private msg: SettingsMsg | null = null;
  private clear = new Set<string>();
  private busy = false;
  /** 点了开始：成功后服务器会换页面，别让按钮再亮起来 */
  private starting = false;
  private last: { ok: boolean; text: string } | null = null;
  /** 开始界面模式：不能关；save = 磁盘上的存档摘要（null = 没有） */
  private lobby = false;
  private save: SaveInfo | null = null;

  constructor(
    private send: (m: ClientMsg) => void,
    private el: HTMLElement = $('#settings'),
  ) {
    this.el.addEventListener('click', (ev) => {
      const t = ev.target as HTMLElement;
      if (!this.lobby && (t === this.el || t.closest('[data-close]'))) this.close();
      const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act) this.action(act);
      const clr = t.closest<HTMLElement>('[data-clear]')?.dataset.clear;
      if (clr) {
        this.clear.has(clr) ? this.clear.delete(clr) : this.clear.add(clr);
        this.refreshRow(clr);
      }
    });
    this.el.addEventListener('input', (ev) => {
      const key = (ev.target as HTMLElement).closest<HTMLElement>('[data-key]')?.dataset.key;
      if (key) this.refreshRow(key);
    });
    // 打开时吃掉键盘（不让 WASD / T / J 之类动到地图），Esc 关掉
    window.addEventListener(
      'keydown',
      (ev) => {
        if (!this.isOpen) return;
        if (ev.key === 'Escape') this.lobby || this.close();
        else if (ev.key === 'Enter' && (ev.target as HTMLElement).tagName === 'INPUT') {
          ev.preventDefault();
          this.action('save');
        }
        ev.stopPropagation();
      },
      true,
    );
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }
  open(): void {
    this.el.hidden = false;
    this.clear.clear();
    this.last = null;
    this.el.innerHTML = `<div class="sheet"><div class="sheet-body"><div class="dim" style="padding:30px;text-align:center">读取设置…</div></div></div>`;
    this.send({ t: 'settings' });
  }
  /** 开始界面：服务器还没开局，整页显示这个面板 */
  openLobby(save: SaveInfo | null): void {
    this.lobby = true;
    this.save = save;
    this.open();
  }
  /** 存档摘要变了（清空存档之后）：只重画存档区和按钮，表单里没保存的改动保留 */
  setSave(save: SaveInfo | null): void {
    this.save = save;
    const box = this.el.querySelector('#lobbySave');
    const foot = this.el.querySelector('.sheet-foot');
    if (box) box.innerHTML = this.saveHtml();
    if (foot) foot.innerHTML = this.footHtml();
  }
  close(): void {
    if (this.lobby) return;
    this.el.hidden = true;
  }
  toggle(): void {
    this.isOpen ? this.close() : this.open();
  }

  /** 服务器发来最新设置 */
  show(m: SettingsMsg): void {
    this.msg = m;
    this.busy = false;
    if (!this.isOpen) return;
    this.clear.clear();
    const groups = new Map<string, SettingDef[]>();
    for (const d of m.defs) groups.set(d.group, [...(groups.get(d.group) ?? []), d]);
    const lockedN = Object.keys(m.locked).length;
    const shown = this.lobby ? [...groups].filter(([, defs]) => defs[0].apply !== 'restart') : [...groups];
    this.el.innerHTML = this.lobby
      ? `<div class="sheet" role="dialog" aria-label="开始游戏">
      <header class="sheet-head">
        <span class="logo">诸</span><b>诸侯争霸 · 开始游戏</b>
        <span class="dim small">先在这里设置好，再开始。设置存在 <code>${esc(m.file)}</code>${lockedN ? ` · ${lockedN} 项由环境变量指定（灰色，只读）` : ''}</span>
      </header>
      <div class="sheet-body">
        <section class="sgroup" id="lobbySave">${this.saveHtml()}</section>
        ${shown.map(([g, defs]) => `<section class="sgroup"><h3>${esc(g)}${badge(defs[0].apply)}</h3>${defs.map((d) => this.row(d)).join('')}</section>`).join('')}
      </div>
      <footer class="sheet-foot">${this.footHtml()}</footer>
    </div>`
      : `<div class="sheet" role="dialog" aria-label="设置">
      <header class="sheet-head">
        <b>⚙ 设置</b>
        <span class="dim small">存在 <code>${esc(m.file)}</code>${lockedN ? ` · ${lockedN} 项由环境变量指定（灰色，只读）` : ''}</span>
        <span class="spacer"></span>
        <button class="btn ghost" data-close title="关闭（Esc）">✕</button>
      </header>
      <div class="sheet-body">
        ${shown.map(([g, defs]) => `<section class="sgroup"><h3>${esc(g)}${badge(defs[0].apply)}</h3>${defs.map((d) => this.row(d)).join('')}</section>`).join('')}
      </div>
      <footer class="sheet-foot">${this.footHtml()}</footer>
    </div>`;
    for (const d of m.defs) this.refreshRow(d.key);
  }

  private saveHtml(): string {
    const v = this.save;
    if (!v) return `<h3>存档</h3><div class="savecard"><span class="dim">还没有存档 —— 设置好下面的选项，点右下角「开始游戏」。</span></div>`;
    const when = v.savedAt ? new Date(v.savedAt).toLocaleString() : '';
    const detail = [v.savedAt ? `存于 ${when}` : '', v.seed !== undefined ? `种子 ${v.seed}` : '', v.npcs !== undefined ? `${v.npcs} 人` : '', v.kb ? `${v.kb} KB` : '', v.hasPrev ? '另有旧档备份' : ''].filter(Boolean).join(' · ');
    return `<h3>存档</h3><div class="savecard">
      <b>${esc(v.label)}</b>
      <span class="dim small">${esc(detail)}</span>
      ${v.error ? `<span class="err small">${esc(v.error === '没有当前存档' ? '当前存档已不存在，只剩备份' : '存档读不了：' + v.error)}（可以清空存档后重新开始）</span>` : ''}
    </div>`;
  }

  private footHtml(): string {
    const msg = `<div id="setMsg" class="small ${this.last ? (this.last.ok ? 'ok' : 'err') : ''}">${this.last ? esc(this.last.text) : ''}</div><span class="spacer"></span>`;
    const test = `<button class="btn ghost" data-act="test" title="用表单里的接口设置（不用先保存）发一句话试试">测试 AI 连接</button>`;
    if (!this.lobby)
      return `${msg}${test}
        <button class="btn ghost danger" data-act="back" title="先存档，再回到开始界面（在那里可以清空存档、换设置重新开始）">回到开始界面</button>
        <button class="btn ghost danger" data-act="newWorld" title="保存后，用「新世界」设置重新生成世界">用这些设置开新局</button>
        <button class="btn" data-act="save">保存</button>`;
    const v = this.save;
    const canContinue = !!v && !v.error;
    return `${msg}${test}
      ${v ? `<button class="btn ghost danger" data-act="clear" title="删除存档和旧档备份（设置不动）">清空存档</button>` : ''}
      ${canContinue ? `<button class="btn" data-act="continue" title="读取存档，接着玩（新世界设置以存档为准）">继续游戏</button>` : ''}
      <button class="btn ${canContinue ? 'ghost danger' : ''}" data-act="start" title="${v ? '用上面的「新世界」设置开新局，覆盖现有存档（旧档备份成 .prev）' : '用上面的设置生成世界并开始'}">${v ? '开始新游戏' : '开始游戏'}</button>`;
  }

  /** 保存 / 开新局 / 测试 的回复 */
  result(ok: boolean, text: string): void {
    if (!(this.starting && ok)) {
      this.busy = false;
      this.starting = false;
    }
    this.last = { ok, text };
    const box = this.el.querySelector('#setMsg');
    if (box) {
      box.className = `small ${ok ? 'ok' : 'err'}`;
      box.textContent = text;
    }
    toast(text, ok ? 'ok' : 'err');
  }

  private row(d: SettingDef): string {
    const m = this.msg!;
    const v = m.values[d.key];
    const lock = m.locked[d.key];
    const dis = lock ? 'disabled' : '';
    const id = `set-${d.key.replace(/\W/g, '_')}`;
    let input: string;
    if (d.type === 'select')
      input = `<select id="${id}" ${dis}>${(d.options ?? []).map((o) => `<option value="${esc(o.value)}" ${o.value === v ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
    else if (d.type === 'bool') input = `<input id="${id}" type="checkbox" ${v ? 'checked' : ''} ${dis} />`;
    else if (d.type === 'number')
      input = `<input id="${id}" type="number" value="${esc(String(v))}" ${d.min !== undefined ? `min="${d.min}"` : ''} ${d.max !== undefined ? `max="${d.max}"` : ''} step="${d.step ?? 'any'}" ${dis} />`;
    else if (d.type === 'secret') {
      const has = m.secrets[d.key];
      input = `<input id="${id}" type="password" autocomplete="off" placeholder="${has ? esc(has) + '（留空 = 不改）' : '未设置'}" ${dis} />${has && !lock ? `<button class="btn ghost tiny" type="button" data-clear="${d.key}">清除</button>` : ''}`;
    } else input = `<input id="${id}" type="text" value="${esc(String(v))}" spellcheck="false" ${dis} />`;
    const range = d.type === 'number' && d.min !== undefined && d.max !== undefined ? `${d.min} – ${d.max}` : '';
    return `<div class="srow${lock ? ' locked' : ''}" data-key="${esc(d.key)}">
      <label for="${id}">${esc(d.label)}</label>
      <div class="sinput">${input}</div>
      <div class="snote small">
        ${d.help ? `<span class="dim">${esc(d.help)}</span>` : ''}
        ${range ? `<span class="dim">范围 ${range}，默认 ${esc(String(d.default))}</span>` : d.type !== 'secret' && d.type !== 'select' && d.default !== '' ? `<span class="dim">默认 ${esc(String(d.default))}</span>` : ''}
        ${lock ? `<span class="warnc">由环境变量 <code>${esc(lock)}</code> 指定</span>` : ''}
        <span class="diff"></span>
      </div>
    </div>`;
  }

  private input(key: string): HTMLInputElement | HTMLSelectElement | null {
    return this.el.querySelector(`[data-key="${CSS.escape(key)}"] input, [data-key="${CSS.escape(key)}"] select`);
  }
  private read(d: SettingDef): SettingValue | null | undefined {
    const el = this.input(d.key);
    if (!el) return undefined;
    if (d.type === 'secret') return this.clear.has(d.key) ? null : el.value === '' ? undefined : el.value;
    if (d.type === 'bool') return (el as HTMLInputElement).checked;
    if (d.type === 'number') return el.value.trim() === '' ? NaN : Number(el.value);
    return el.value;
  }

  /** 改过的项 */
  private patch(): Patch {
    const m = this.msg;
    if (!m) return {};
    const out: Patch = {};
    for (const d of m.defs) {
      if (m.locked[d.key]) continue;
      const v = this.read(d);
      if (v === undefined) continue;
      if (d.type === 'secret' || v !== m.values[d.key]) out[d.key] = Number.isNaN(v) ? '' : v;
    }
    return out;
  }

  private refreshRow(key: string): void {
    const m = this.msg;
    const row = this.el.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
    const d = m?.defs.find((x) => x.key === key);
    if (!m || !row || !d) return;
    const v = this.read(d);
    const changed = d.type === 'secret' ? v !== undefined : v !== m.values[key];
    row.classList.toggle('changed', changed && !m.locked[key]);
    const diff = row.querySelector('.diff')!;
    const notes: string[] = [];
    if (d.type === 'secret' && this.clear.has(key)) notes.push('<span class="warnc">保存时清除</span>');
    if (d.apply === 'world' && key in m.world && (v ?? m.values[key]) !== m.world[key]) notes.push(`<span class="acc">当前世界用的是 ${esc(String(m.world[key]))}</span>`);
    if (m.pendingRestart.includes(key)) notes.push('<span class="warnc">已保存，重启服务器后生效</span>');
    diff.innerHTML = notes.join(' ');
    const clr = row.querySelector<HTMLElement>('[data-clear]');
    if (clr) clr.textContent = this.clear.has(key) ? '撤销清除' : '清除';
  }

  private action(act: string): void {
    if (!this.msg || this.busy) return;
    const values = this.patch();
    if (act === 'save') {
      if (!Object.keys(values).length) return this.result(true, '没有改动');
      this.busy = true;
      this.send({ t: 'settings.set', values });
    } else if (act === 'newWorld') {
      const w = this.msg.defs.filter((d) => d.apply === 'world');
      const v = (d: SettingDef) => (d.key in values ? values[d.key] : this.msg!.values[d.key]);
      const list = w.map((d) => `  ${d.label}：${v(d)}`).join('\n');
      if (!confirm(`用这些设置重新生成世界？\n\n${list}\n\n当前世界会被替换（旧存档备份为 .prev.json.gz）。`)) return;
      this.busy = true;
      this.send({ t: 'settings.newWorld', values });
    } else if (act === 'start' || act === 'continue') {
      const v = this.save;
      if (act === 'start' && v && !confirm(`已经有存档（${v.label}）。\n开始新游戏会覆盖它（旧档备份成 .prev.json.gz）。\n\n继续吗？`)) return;
      this.busy = this.starting = true;
      this.result(true, act === 'continue' ? '正在读取存档…' : '正在生成世界…');
      this.send({ t: 'lobby.start', mode: act === 'continue' ? 'continue' : 'new', values });
    } else if (act === 'clear') {
      if (!confirm(`清空存档？\n\n当前存档${this.save ? `（${this.save.label}）` : ''}和旧档备份会被永久删除，不能恢复。\n设置不受影响。`)) return;
      this.busy = true;
      this.send({ t: 'lobby.clear' });
    } else if (act === 'back') {
      if (!confirm('回到开始界面？\n\n会先存一次档，然后停掉当前世界。在开始界面可以继续游戏、清空存档或换设置开新局。')) return;
      this.busy = true;
      this.send({ t: 'lobby.back' });
    } else if (act === 'test') {
      this.result(true, '正在连接…');
      this.busy = true;
      this.send({ t: 'settings.testAi', values });
    }
  }
}

function badge(apply: SettingDef['apply']): string {
  const [text, cls] = APPLY[apply];
  return `<span class="badge ${cls}">${text}</span>`;
}
