import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, existsSync, mkdirSync, truncateSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LedgerWatcher } from "../src/ledger.ts";
import type { LedgerEvent } from "../src/types.ts";

let tmp: string;
let ledgerPath: string;

before(() => { tmp = mkdtempSync(join(tmpdir(), "tlw-")); });
after(() => { if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true }); });
beforeEach(() => {
  if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  ledgerPath = join(tmp, "events.jsonl");
});

function makeLlm(session: string, cost = 0.05): LedgerEvent {
  return {
    ts: new Date().toISOString(),
    event: "llm_call",
    harness: "pi",
    session,
    model: "claude-opus-4-7",
    input_tokens: 100,
    output_tokens: 50,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    cost_usd: cost,
  } as LedgerEvent;
}

function collectEvents(w: LedgerWatcher): LedgerEvent[] {
  const out: LedgerEvent[] = [];
  w.on("event", e => out.push(e));
  return out;
}

test("missing file: starts cleanly, emits no events", () => {
  const w = new LedgerWatcher(ledgerPath);
  const events = collectEvents(w);
  w.start();
  w.pollOnce();
  w.stop();
  assert.equal(events.length, 0);
});

test("initial load: reads existing file in one poll", () => {
  writeFileSync(ledgerPath, JSON.stringify(makeLlm("s1")) + "\n" + JSON.stringify(makeLlm("s2")) + "\n");
  const w = new LedgerWatcher(ledgerPath);
  const events = collectEvents(w);
  w.start();
  w.stop();
  assert.equal(events.length, 2);
  assert.equal(events[0].session, "s1");
  assert.equal(events[1].session, "s2");
});

test("incremental: appended lines surface on next poll", () => {
  writeFileSync(ledgerPath, JSON.stringify(makeLlm("s1")) + "\n");
  const w = new LedgerWatcher(ledgerPath);
  const events = collectEvents(w);
  w.start();
  assert.equal(events.length, 1);

  appendFileSync(ledgerPath, JSON.stringify(makeLlm("s2")) + "\n" + JSON.stringify(makeLlm("s3")) + "\n");
  w.pollOnce();
  w.stop();
  assert.equal(events.length, 3);
  assert.equal(events[2].session, "s3");
});

test("partial trailing line is held until newline arrives", () => {
  // Write a complete line + a partial line (no \n)
  const complete = JSON.stringify(makeLlm("s1")) + "\n";
  const partial = JSON.stringify(makeLlm("s2"));
  writeFileSync(ledgerPath, complete + partial);

  const w = new LedgerWatcher(ledgerPath);
  const events = collectEvents(w);
  w.start();
  // Only the complete line is emitted; the partial waits.
  assert.equal(events.length, 1);
  assert.equal(events[0].session, "s1");

  // Finish the partial line.
  appendFileSync(ledgerPath, "\n");
  w.pollOnce();
  w.stop();
  assert.equal(events.length, 2);
  assert.equal(events[1].session, "s2");
});

test("invalid JSON lines are silently skipped", () => {
  writeFileSync(ledgerPath, "not json\n" + JSON.stringify(makeLlm("ok")) + "\n" + "{ bad\n");
  const w = new LedgerWatcher(ledgerPath);
  const events = collectEvents(w);
  w.start();
  w.stop();
  assert.equal(events.length, 1);
  assert.equal(events[0].session, "ok");
});

test("non-ledger lines (unknown 'event' type) are skipped", () => {
  const garbage = JSON.stringify({ event: "something_else", foo: "bar" });
  writeFileSync(ledgerPath, garbage + "\n" + JSON.stringify(makeLlm("ok")) + "\n");
  const w = new LedgerWatcher(ledgerPath);
  const events = collectEvents(w);
  w.start();
  w.stop();
  assert.equal(events.length, 1);
});

test("blank lines are skipped", () => {
  writeFileSync(ledgerPath, "\n\n" + JSON.stringify(makeLlm("a")) + "\n\n");
  const w = new LedgerWatcher(ledgerPath);
  const events = collectEvents(w);
  w.start();
  w.stop();
  assert.equal(events.length, 1);
});

test("truncation: when file shrinks below cursor, replay from start and emit 'truncated'", () => {
  writeFileSync(ledgerPath, JSON.stringify(makeLlm("s1")) + "\n" + JSON.stringify(makeLlm("s2")) + "\n");
  const w = new LedgerWatcher(ledgerPath);
  const events = collectEvents(w);
  let truncatedCount = 0;
  w.on("truncated", () => truncatedCount++);

  w.start();
  assert.equal(events.length, 2);

  // Truncate the file to nothing, then put a new event in.
  truncateSync(ledgerPath, 0);
  writeFileSync(ledgerPath, JSON.stringify(makeLlm("fresh")) + "\n");
  w.pollOnce();
  w.stop();

  assert.equal(truncatedCount, 1);
  // After truncation reset, the fresh event is emitted.
  assert.equal(events.length, 3);
  assert.equal(events[2].session, "fresh");
});

test("ready event fires once after start", () => {
  let readyCount = 0;
  const w = new LedgerWatcher(ledgerPath);
  w.on("ready", () => readyCount++);
  w.start();
  w.pollOnce();
  w.stop();
  assert.equal(readyCount, 1);
});

test("two appended events split across two polls both surface", () => {
  writeFileSync(ledgerPath, "");
  const w = new LedgerWatcher(ledgerPath);
  const events = collectEvents(w);
  w.start();
  assert.equal(events.length, 0);

  appendFileSync(ledgerPath, JSON.stringify(makeLlm("a")) + "\n");
  w.pollOnce();
  appendFileSync(ledgerPath, JSON.stringify(makeLlm("b")) + "\n");
  w.pollOnce();
  w.stop();

  assert.equal(events.length, 2);
  assert.deepEqual(events.map(e => e.session), ["a", "b"]);
});
