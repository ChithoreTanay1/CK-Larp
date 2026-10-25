import type { Command, CommandResult } from '../sim/commands';
import type { CharDetail, ProvDetail, RealmDetail } from '../sim/snapshot';
import type { FromWorker, Ready, ToWorker } from './protocol';
import type { Update } from '../sim/snapshot';

/** Main-thread side of the worker message bridge. */
export class SimBridge {
  private worker: Worker;
  private nextReq = 1;
  private pending = new Map<number, (v: unknown) => void>();
  onReady: (r: Ready) => void = () => {};
  onUpdate: (u: Update) => void = () => {};
  onResult: (r: CommandResult) => void = () => {};
  onError: (m: string) => void = () => {};

  constructor() {
    this.worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.receive(e.data);
    this.worker.onerror = (e) => this.onError(e.message || 'Simulation worker crashed');
  }

  private receive(m: FromWorker): void {
    switch (m.type) {
      case 'ready':
        this.onReady(m);
        break;
      case 'update':
        this.onUpdate(m);
        break;
      case 'detail':
      case 'saved': {
        const fn = this.pending.get(m.reqId);
        this.pending.delete(m.reqId);
        fn?.(m);
        break;
      }
      case 'cmdResult': {
        if (m.reqId !== undefined) {
          const fn = this.pending.get(m.reqId);
          this.pending.delete(m.reqId);
          fn?.(m.result);
        }
        this.onResult(m.result);
        break;
      }
      case 'error':
        this.onError(m.message);
        break;
    }
  }

  send(msg: ToWorker, transfer: Transferable[] = []): void {
    this.worker.postMessage(msg, transfer);
  }

  command(cmd: Command): Promise<CommandResult> {
    const reqId = this.nextReq++;
    return new Promise((res) => {
      this.pending.set(reqId, res as (v: unknown) => void);
      this.send({ type: 'cmd', cmd, reqId });
    });
  }

  detail(what: 'char', id: number): Promise<CharDetail | null>;
  detail(what: 'realm', id: number): Promise<RealmDetail | null>;
  detail(what: 'province', id: number): Promise<ProvDetail | null>;
  detail(what: 'char' | 'realm' | 'province', id: number): Promise<unknown> {
    const reqId = this.nextReq++;
    return new Promise((res) => {
      this.pending.set(reqId, (m) => res((m as { data: unknown }).data));
      this.send({ type: 'detail', reqId, what, id });
    });
  }

  save(): Promise<{ buffer: ArrayBuffer; meta: { realm: string; ruler: string; date: string } }> {
    const reqId = this.nextReq++;
    return new Promise((res) => {
      this.pending.set(reqId, res as (v: unknown) => void);
      this.send({ type: 'save', reqId });
    });
  }
}
