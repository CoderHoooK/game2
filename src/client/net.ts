// 连接后端：JSON 消息 + 二进制帧（见 protocol/）
import type { ClientMsg, Defs, ServerMsg } from '../protocol/messages';
import { BIN } from '../protocol/codec';

type Handlers = {
  hello(defs: Defs): void;
  json(m: ServerMsg): void;
  bin(tag: number, buf: ArrayBuffer): void;
  closed(): void;
};

export class Net {
  private ws: WebSocket;
  bytesIn = 0;
  constructor(private h: Handlers) {
    this.ws = this.open();
  }
  private open(): WebSocket {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${location.pathname.replace(/[^/]*$/, '')}ws`;
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        this.bytesIn += ev.data.length;
        const m = JSON.parse(ev.data) as ServerMsg;
        if (m.t === 'hello') this.h.hello(m.defs);
        else this.h.json(m);
      } else {
        const buf = ev.data as ArrayBuffer;
        this.bytesIn += buf.byteLength;
        this.h.bin(new Uint8Array(buf, 0, 1)[0], buf);
      }
    };
    ws.onclose = () => this.h.closed();
    return ws;
  }
  send(m: ClientMsg): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }
}
export { BIN };
