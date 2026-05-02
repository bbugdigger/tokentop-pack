// TUI loop: raw stdin for keys, SIGWINCH for resize, 1Hz re-render.
// Pure rendering lives in views.ts; this file is just I/O.

import { Aggregator } from "./aggregator.ts";
import { renderFrame, type View } from "./views.ts";
import { CLEAR, HOME, HIDE_CURSOR, SHOW_CURSOR } from "./ansi.ts";

export interface UIOptions {
  aggregator: Aggregator;
  now?: () => number;
  refreshMs?: number;
}

export class UI {
  private aggregator: Aggregator;
  private now: () => number;
  private refreshMs: number;
  private view: View = "sessions";
  private timer: ReturnType<typeof setInterval> | undefined;
  private exitCallback: (() => void) | undefined;

  constructor(opts: UIOptions) {
    this.aggregator = opts.aggregator;
    this.now = opts.now ?? (() => Date.now());
    this.refreshMs = opts.refreshMs ?? 1000;
  }

  start(onExit: () => void): void {
    this.exitCallback = onExit;
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => this.handleKey(String(chunk)));
    }
    process.stdout.write(HIDE_CURSOR);
    process.on("SIGWINCH", () => this.render());
    process.on("SIGINT", () => this.exit());
    this.render();
    this.timer = setInterval(() => this.render(), this.refreshMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (process.stdin.isTTY) {
      try { process.stdin.setRawMode(false); } catch { /* ignore */ }
      process.stdin.pause();
    }
    process.stdout.write(SHOW_CURSOR + "\n");
  }

  private exit(): void {
    this.stop();
    this.exitCallback?.();
  }

  private handleKey(s: string): void {
    if (s === "q" || s === "" /* Ctrl+C */) {
      this.exit();
    } else if (s === "s") {
      this.view = "sessions";
      this.render();
    } else if (s === "m") {
      this.view = "models";
      this.render();
    } else if (s === "t") {
      this.view = "tools";
      this.render();
    } else if (s === "r") {
      this.aggregator.reset();
      this.render();
    }
  }

  private render(): void {
    const cols = process.stdout.columns ?? 80;
    const rows = process.stdout.rows ?? 24;
    const snap = this.aggregator.snapshot(this.now());
    const frame = renderFrame(snap, this.view, rows, cols);
    process.stdout.write(CLEAR + HOME + frame);
  }
}
