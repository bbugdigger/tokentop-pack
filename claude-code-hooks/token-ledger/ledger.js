import { mkdirSync, appendFileSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

export const LEDGER_DIR = join(homedir(), ".agent-ledger");
export const LEDGER_FILE = join(LEDGER_DIR, "events.jsonl");
export const CURSORS_DIR = join(LEDGER_DIR, "cursors");

export function appendEvent(event) {
  mkdirSync(dirname(LEDGER_FILE), { recursive: true });
  appendFileSync(LEDGER_FILE, JSON.stringify(event) + "\n");
}

export function readCursor(sessionId) {
  const f = join(CURSORS_DIR, `${sessionId}.json`);
  if (!existsSync(f)) return 0;
  try {
    const data = JSON.parse(readFileSync(f, "utf8"));
    return typeof data.byte_offset === "number" ? data.byte_offset : 0;
  } catch {
    return 0;
  }
}

export function writeCursor(sessionId, byteOffset) {
  mkdirSync(CURSORS_DIR, { recursive: true });
  const f = join(CURSORS_DIR, `${sessionId}.json`);
  writeFileSync(f, JSON.stringify({ byte_offset: byteOffset, updated_at: new Date().toISOString() }));
}
