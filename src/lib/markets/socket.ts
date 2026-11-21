import { backoffDelay } from "@/lib/markets/bars";

export type SocketStatus = "connecting" | "live" | "reconnecting" | "closed";

interface WebSocketLike {
  readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  send(data: string): void;
  close(): void;
}

export interface ReconnectingSocketOptions {
  url: string;
  /** Called on every (re)connect, e.g. to subscribe again. */
  onOpen?: (socket: ReconnectingSocket) => void;
  onMessage: (data: string) => void;
  onStatus?: (status: SocketStatus) => void;
  /** Send this every pingMs to keep idle connections open (Deriv drops them after ~2 minutes). */
  ping?: { ms: number; payload: string };
  /** Treat the connection as dead when nothing arrives for this long. */
  staleMs?: number;
  WebSocketImpl?: new (url: string) => WebSocketLike;
  /** For tests. */
  timers?: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout; setInterval: typeof setInterval; clearInterval: typeof clearInterval };
}

const BROWSER_TIMERS = {
  setTimeout: ((fn: () => void, ms?: number) => setTimeout(fn, ms)) as typeof setTimeout,
  clearTimeout: ((id: ReturnType<typeof setTimeout>) => clearTimeout(id)) as typeof clearTimeout,
  setInterval: ((fn: () => void, ms?: number) => setInterval(fn, ms)) as typeof setInterval,
  clearInterval: ((id: ReturnType<typeof setInterval>) => clearInterval(id)) as typeof clearInterval,
};

/**
 * A WebSocket that reconnects with exponential backoff (1s, 2s, 4s … 30s) when it drops,
 * reports live / reconnecting status, and can be closed for good with close().
 */
export class ReconnectingSocket {
  private ws: WebSocketLike | null = null;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastMessageAt = 0;
  private stopped = false;
  private queue: string[] = [];
  status: SocketStatus = "connecting";

  constructor(private readonly opts: ReconnectingSocketOptions) {
    this.connect();
  }

  private get t() {
    // Browsers throw "Illegal invocation" if their timer functions are called as methods of another
    // object, so the defaults are wrapped rather than copied onto one.
    return this.opts.timers ?? BROWSER_TIMERS;
  }

  private setStatus(s: SocketStatus) {
    if (this.status === s) return;
    this.status = s;
    this.opts.onStatus?.(s);
  }

  private connect() {
    if (this.stopped) return;
    const Impl = this.opts.WebSocketImpl ?? (globalThis.WebSocket as unknown as new (url: string) => WebSocketLike);
    let ws: WebSocketLike;
    try {
      ws = new Impl(this.opts.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.attempt = 0;
      this.lastMessageAt = Date.now();
      this.setStatus("live");
      const pending = this.queue;
      this.queue = [];
      this.opts.onOpen?.(this);
      for (const m of pending) ws.send(m);
      this.startPing();
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      this.lastMessageAt = Date.now();
      this.opts.onMessage(String(ev.data));
    };
    ws.onerror = () => {
      // onclose follows; reconnecting happens there.
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopPing();
      if (!this.stopped) this.scheduleRetry();
    };
  }

  private scheduleRetry() {
    if (this.stopped) return;
    this.setStatus("reconnecting");
    const delay = backoffDelay(this.attempt++);
    this.retryTimer = this.t.setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  private startPing() {
    this.stopPing();
    const { ping, staleMs } = this.opts;
    if (!ping && !staleMs) return;
    const every = Math.min(ping?.ms ?? Infinity, staleMs ? staleMs / 2 : Infinity);
    this.pingTimer = this.t.setInterval(() => {
      if (staleMs && Date.now() - this.lastMessageAt > staleMs) {
        this.reconnectNow();
        return;
      }
      if (ping && this.ws?.readyState === 1) this.ws.send(ping.payload);
    }, every);
  }

  private stopPing() {
    if (this.pingTimer) this.t.clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  /** Drop the current connection and connect again straight away (e.g. the browser came back online). */
  reconnectNow() {
    if (this.stopped) return;
    if (this.retryTimer) this.t.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const old = this.ws;
    this.ws = null;
    this.stopPing();
    try {
      old?.close();
    } catch {
      // already closed
    }
    this.attempt = 0;
    this.setStatus("reconnecting");
    this.connect();
  }

  /** Sends now when connected, otherwise once the connection opens. */
  send(data: unknown) {
    const text = typeof data === "string" ? data : JSON.stringify(data);
    if (this.ws?.readyState === 1) this.ws.send(text);
    else this.queue.push(text);
  }

  get isOpen() {
    return this.ws?.readyState === 1;
  }

  close() {
    this.stopped = true;
    if (this.retryTimer) this.t.clearTimeout(this.retryTimer);
    this.stopPing();
    const ws = this.ws;
    this.ws = null;
    try {
      ws?.close();
    } catch {
      // already closed
    }
    this.setStatus("closed");
  }
}
