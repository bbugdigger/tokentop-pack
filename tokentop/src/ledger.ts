// Watches ~/.agent-ledger/events.jsonl for new entries.
// Emits "event" for each parsed LedgerEvent, "truncated" if the file shrinks
// (e.g. user reset), and "ready" once the initial load completes.
//
// Cross-platform reliability: uses fs.watchFile (polling) instead of fs.watch.
// fs.watch is faster but unreliable on Windows for individual files.

import { EventEmitter } from "node:events";
import {
  existsSync,
  statSync,
  openSync,
  readSync,
  closeSync,
  watchFile,
  unwatchFile,
} from "node:fs";
import type { LedgerEvent } from "./types.ts";

const POLL_INTERVAL_MS = 250;

export class LedgerWatcher extends EventEmitter {
  private cursor = 0;
  private partial = "";
  private active = false;
  private filePath: string;

  constructor(filePath: string) {
    super();
    this.filePath = filePath;
  }

  async start(): Promise<void> {
    this.active = true;
    this.poll();
    this.emit("ready");
    watchFile(this.filePath, { interval: POLL_INTERVAL_MS }, () => this.poll());
  }

  stop(): void {
    this.active = false;
    unwatchFile(this.filePath);
  }

  /** For testing: drive a single poll synchronously. */
  pollOnce(): void {
    this.poll();
  }

  private poll(): void {
    if (!this.active) return;
    if (!existsSync(this.filePath)) return;

    let stat;
    try {
      stat = statSync(this.filePath);
    } catch {
      return;
    }

    // Truncation detection: cursor past current file end -> reset and replay.
    if (this.cursor > stat.size) {
      this.cursor = 0;
      this.partial = "";
      this.emit("truncated");
    }

    if (this.cursor >= stat.size) return;

    const length = stat.size - this.cursor;
    const buf = Buffer.alloc(length);
    const fd = openSync(this.filePath, "r");
    try {
      readSync(fd, buf, 0, length, this.cursor);
    } finally {
      closeSync(fd);
    }

    const chunk = this.partial + buf.toString("utf8");
    const lines = chunk.split("\n");
    // After split: if chunk ends with "\n", last element is "". If mid-line, last is partial.
    this.partial = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      let parsed: any;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (parsed && (parsed.event === "llm_call" || parsed.event === "tool_call")) {
        this.emit("event", parsed as LedgerEvent);
      }
    }

    this.cursor = stat.size;
  }
}

export function createLedgerWatcher(filePath: string): LedgerWatcher {
  return new LedgerWatcher(filePath);
}
