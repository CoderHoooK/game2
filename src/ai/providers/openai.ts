// OpenAI 兼容接口（环境变量 AI_BASE_URL、AI_API_KEY、AI_MODEL）。测试里用假的 Provider，不会真的调用。
import type { ChatMessage, Provider } from './types';

export class OpenAIProvider implements Provider {
  name: string;
  constructor(private opts: { baseUrl: string; apiKey: string; model: string; timeoutMs?: number }) {
    this.name = `openai:${opts.model}`;
  }
  static fromEnv(env: Record<string, string | undefined>): OpenAIProvider | null {
    if (!env.AI_BASE_URL || !env.AI_API_KEY || !env.AI_MODEL) return null;
    return new OpenAIProvider({ baseUrl: env.AI_BASE_URL, apiKey: env.AI_API_KEY, model: env.AI_MODEL });
  }
  async complete(messages: ChatMessage[]): Promise<string> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.opts.timeoutMs ?? 60000);
    try {
      const res = await fetch(this.opts.baseUrl.replace(/\/$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.opts.apiKey}` },
        body: JSON.stringify({ model: this.opts.model, messages, temperature: 0.8 }),
        signal: ctl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      return j.choices?.[0]?.message?.content ?? '';
    } finally {
      clearTimeout(timer);
    }
  }
}
