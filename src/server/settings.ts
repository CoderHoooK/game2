// 设置：网页「⚙ 设置」面板里能改的所有东西都在这里声明一次，存到 saves/settings.json。
// 优先级：默认值 < 设置文件 < 环境变量（环境变量指定的项在网页上锁定，并注明是哪个变量）。
// 「新世界」那一组里自动包含所有模块声明的 config（加了模块配置不用改界面）。
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MODULES } from '../game';
import type { SimOptions } from '../engine/sim';
import type { SettingDef, SettingValue, SettingsMsg } from '../protocol/messages';

type Env = Record<string, string | undefined>;
type Values = Record<string, SettingValue>;

/** 每一项 + 它对应的环境变量（可选：把环境变量的字符串换成值） */
interface Entry extends SettingDef {
  env?: string;
  fromEnv?: (env: Env) => SettingValue | undefined;
}

const DAY = '天';

export function settingEntries(): Entry[] {
  const list: Entry[] = [
    // ---------------------------------------------------------------- 时间与存档（立即生效）
    { key: 'speed', group: '时间与存档', label: '时间倍率', type: 'number', min: 0, max: 16, step: 1, default: 1, apply: 'live', help: '0 = 暂停。顶栏的倍率按钮和「时速」命令改的也是它；这里的值也是下次启动时的倍率' },
    { key: 'autosaveDays', group: '时间与存档', label: '自动存档间隔（游戏' + DAY + '）', type: 'number', min: 1, max: 120, step: 1, default: 5, apply: 'live', help: '退出（Ctrl+C）时也会存一次' },

    // ---------------------------------------------------------------- AI 诸侯（立即生效）
    {
      key: 'aiMode', group: 'AI 诸侯', label: '谁来当诸侯', type: 'select', default: 'script', apply: 'live',
      options: [
        { value: 'script', label: '脚本诸侯（不用联网）' },
        { value: 'llm', label: '大模型（OpenAI 兼容接口）' },
        { value: 'off', label: '关闭（诸侯什么都不做）' },
      ],
      help: '选大模型但接口没填全时，退回脚本诸侯',
      fromEnv: (e) => (e.AI === 'off' ? 'off' : e.AI_BASE_URL && e.AI_API_KEY && e.AI_MODEL ? 'llm' : undefined),
      env: 'AI / AI_BASE_URL',
    },
    { key: 'aiBaseUrl', group: 'AI 诸侯', label: '接口地址', type: 'text', default: '', apply: 'live', env: 'AI_BASE_URL', help: '例：https://api.openai.com/v1、https://api.deepseek.com/v1、http://localhost:11434/v1（Ollama）' },
    { key: 'aiApiKey', group: 'AI 诸侯', label: 'API Key', type: 'secret', default: '', apply: 'live', env: 'AI_API_KEY', help: '只存在本机的设置文件里，网页上只显示后 4 位' },
    { key: 'aiModel', group: 'AI 诸侯', label: '模型名', type: 'text', default: '', apply: 'live', env: 'AI_MODEL', help: '例：gpt-4o-mini、deepseek-chat、qwen2.5:14b' },
    { key: 'aiTemperature', group: 'AI 诸侯', label: '温度', type: 'number', min: 0, max: 2, step: 0.1, default: 0.8, apply: 'live', help: '越高越天马行空' },
    { key: 'aiTimeoutSec', group: 'AI 诸侯', label: '单次调用超时（秒）', type: 'number', min: 5, max: 600, step: 5, default: 60, apply: 'live' },
    { key: 'scriptEveryDays', group: 'AI 诸侯', label: '脚本诸侯几' + DAY + '想一次', type: 'number', min: 1, max: 30, step: 1, default: 3, apply: 'live' },
    { key: 'llmEveryDays', group: 'AI 诸侯', label: '大模型诸侯几' + DAY + '想一次', type: 'number', min: 1, max: 60, step: 1, default: 10, apply: 'live', help: '被宣战、被围城、收到信等急事会提前醒' },

    // ---------------------------------------------------------------- 新世界（开新局时生效）
    { key: 'seed', group: '新世界', label: '地图种子', type: 'number', min: 0, max: 2147483647, step: 1, default: 1, apply: 'world', env: 'SEED', help: '同一个种子 = 同一张地图、同样的开局' },
  ];
  for (const m of MODULES) {
    for (const [k, f] of Object.entries(m.config || {})) {
      const isNum = typeof f.default === 'number';
      list.push({
        key: `${m.id}.${k}`,
        group: `新世界 · ${m.name}`,
        label: f.text,
        type: isNum ? 'number' : typeof f.default === 'boolean' ? 'bool' : 'text',
        min: f.min,
        max: f.max,
        step: isNum ? (Number.isInteger(f.default) && (f.min === undefined || Number.isInteger(f.min)) ? 1 : 0.001) : undefined,
        default: f.default,
        apply: 'world',
      });
    }
  }
  list.push(
    // ---------------------------------------------------------------- 服务器（重启后生效）
    { key: 'port', group: '服务器', label: '端口', type: 'number', min: 1, max: 65535, step: 1, default: 8080, apply: 'restart', env: 'PORT', help: '改完到终端按 Ctrl+C 再 npm start；新地址是 http://localhost:新端口' },
    { key: 'host', group: '服务器', label: '监听地址', type: 'text', default: '', apply: 'restart', env: 'HOST', help: '留空 = 同时监听 IPv4 和 IPv6（推荐）；127.0.0.1 = 只允许本机访问' },
    { key: 'savePath', group: '服务器', label: '存档文件', type: 'text', default: 'saves/auto.json.gz', apply: 'restart', env: 'SAVE', help: '相对路径从项目根目录算' },
  );
  return list;
}

/** 把任意输入变成这一项的合法值；不合法返回错误说明 */
export function coerce(def: SettingDef, raw: unknown): { ok: true; value: SettingValue } | { ok: false; error: string } {
  switch (def.type) {
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
      if (!Number.isFinite(n) || String(raw).trim() === '') return { ok: false, error: `${def.label}：要填数字` };
      if (def.min !== undefined && n < def.min) return { ok: false, error: `${def.label}：不能小于 ${def.min}` };
      if (def.max !== undefined && n > def.max) return { ok: false, error: `${def.label}：不能大于 ${def.max}` };
      return { ok: true, value: def.step === 1 ? Math.round(n) : n };
    }
    case 'bool':
      return { ok: true, value: raw === true || raw === 'true' || raw === 1 || raw === '1' };
    case 'select': {
      const v = String(raw);
      if (!def.options?.some((o) => o.value === v)) return { ok: false, error: `${def.label}：没有「${v}」这个选项` };
      return { ok: true, value: v };
    }
    default:
      return { ok: true, value: String(raw ?? '').trim() };
  }
}

export const mask = (s: string) => (!s ? '' : s.length < 12 ? '已设置' : `已设置 ••••${s.slice(-4)}`);

export class Settings {
  readonly entries: Entry[];
  private byKey: Map<string, Entry>;
  private file: Values = {};
  private env: Values = {};
  private envName: Record<string, string> = {};
  /** 启动时的值（restart 组改了以后提示要重启） */
  private boot: Values;

  constructor(
    readonly path: string,
    env: Env = process.env,
  ) {
    this.entries = settingEntries();
    this.byKey = new Map(this.entries.map((e) => [e.key, e]));
    if (existsSync(path)) {
      try {
        const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
        for (const [k, v] of Object.entries(raw)) {
          const d = this.byKey.get(k);
          if (!d) continue; // 旧版本留下的、已经不存在的设置：忽略
          const c = coerce(d, v);
          if (c.ok) this.file[k] = c.value;
        }
      } catch (err) {
        console.log(`设置文件读不了，用默认值：${(err as Error).message}`);
      }
    }
    for (const e of this.entries) {
      const raw = e.fromEnv ? e.fromEnv(env) : e.env && env[e.env] !== undefined && env[e.env] !== '' ? env[e.env] : undefined;
      if (raw === undefined) continue;
      const c = coerce(e, raw);
      if (c.ok) {
        this.env[e.key] = c.value;
        this.envName[e.key] = e.env ?? '';
      } else console.log(`环境变量 ${e.env} 不对，忽略：${c.error}`);
    }
    this.boot = this.all();
  }

  get(key: string): SettingValue {
    if (key in this.env) return this.env[key];
    if (key in this.file) return this.file[key];
    const d = this.byKey.get(key);
    if (!d) throw new Error(`没有设置项 ${key}`);
    return d.default;
  }
  num = (key: string) => Number(this.get(key));
  str = (key: string) => String(this.get(key));
  all(): Values {
    return Object.fromEntries(this.entries.map((e) => [e.key, this.get(e.key)]));
  }
  isLocked = (key: string) => key in this.env;

  /** 改设置：只改给了的项。密钥空串 = 不改，null = 清除。返回改了哪些、哪些不合法 */
  set(patch: Record<string, SettingValue | null | undefined>, opts: { dryRun?: boolean } = {}): { changed: string[]; errors: string[]; values: Values } {
    const changed: string[] = [];
    const errors: string[] = [];
    const next: Values = { ...this.file };
    for (const [k, raw] of Object.entries(patch)) {
      const d = this.byKey.get(k);
      if (!d) {
        errors.push(`没有设置项 ${k}`);
        continue;
      }
      if (this.isLocked(k)) {
        if (raw === null || raw === '' || (coerce(d, raw) as { value?: SettingValue }).value === this.get(k)) continue; // 没想改它
        errors.push(`${d.label}：由环境变量 ${this.envName[k]} 指定，网页里改不了`);
        continue;
      }
      if (d.type === 'secret' && (raw === '' || raw === undefined)) continue;
      if (raw === null) {
        if (k in next) {
          delete next[k];
          changed.push(k);
        }
        continue;
      }
      const c = coerce(d, raw);
      if (!c.ok) {
        errors.push(c.error);
        continue;
      }
      if (this.get(k) !== c.value) changed.push(k);
      next[k] = c.value;
    }
    if (!opts.dryRun && !errors.length) {
      this.file = next;
      this.write();
    }
    const values = Object.fromEntries(this.entries.map((e) => [e.key, e.key in this.env ? this.env[e.key] : e.key in next ? next[e.key] : e.default]));
    return { changed, errors, values };
  }

  private write(): void {
    mkdirSync(path.dirname(this.path), { recursive: true });
    writeFileSync(this.path + '.tmp', JSON.stringify(this.file, null, 2) + '\n');
    renameSync(this.path + '.tmp', this.path);
  }

  /** 「新世界」组的值（存进存档：读档时按存档自己的设置重建世界） */
  worldValues(values: Values = this.all()): Values {
    return Object.fromEntries(this.entries.filter((e) => e.apply === 'world').map((e) => [e.key, values[e.key] ?? e.default]));
  }

  /** 新世界设置 → createGame 的参数 */
  static worldOptions(world: Values): SimOptions {
    const config: Record<string, Record<string, SettingValue>> = {};
    for (const [k, v] of Object.entries(world)) {
      const dot = k.indexOf('.');
      if (dot < 0) continue;
      (config[k.slice(0, dot)] ??= {})[k.slice(dot + 1)] = v;
    }
    return { seed: Number(world.seed ?? 1), config };
  }

  /** 发给网页的样子：密钥打码 */
  toMsg(world: Values): SettingsMsg {
    const values: Values = {};
    const secrets: Record<string, string> = {};
    for (const e of this.entries) {
      const v = this.get(e.key);
      if (e.type === 'secret') {
        values[e.key] = '';
        secrets[e.key] = mask(String(v));
      } else values[e.key] = v;
    }
    const defs: SettingDef[] = this.entries.map(({ env: _e, fromEnv: _f, ...d }) => d);
    const pendingRestart = this.entries.filter((e) => e.apply === 'restart' && this.get(e.key) !== this.boot[e.key]).map((e) => e.key);
    return { t: 'settings', defs, values, secrets, locked: { ...this.envName }, world, pendingRestart, file: this.path };
  }
}
