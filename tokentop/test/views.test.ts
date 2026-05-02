// Pure-render tests for views.ts. We disable color so output is plain ASCII
// and we can do simple substring assertions.

process.env.NO_COLOR = "1";

import { test } from "node:test";
import assert from "node:assert/strict";
import { Aggregator } from "../src/aggregator.ts";
import {
  renderSessionsView,
  renderModelsView,
  renderToolsView,
  renderHeader,
  renderFooter,
  renderFrame,
} from "../src/views.ts";
import type { LedgerEvent } from "../src/types.ts";

const T0 = Date.parse("2026-04-30T14:00:00.000Z");

function llm(session: string, model: string, cost: number, in_tok = 1000, out_tok = 500): LedgerEvent {
  return {
    ts: new Date(T0).toISOString(),
    event: "llm_call",
    harness: "claude-code",
    session,
    model,
    input_tokens: in_tok,
    output_tokens: out_tok,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    cost_usd: cost,
  } as LedgerEvent;
}

function tool(session: string, name: string, ok = true): LedgerEvent {
  return {
    ts: new Date(T0).toISOString(),
    event: "tool_call",
    harness: "claude-code",
    session,
    tool: name,
    ok,
    bytes_out: 1024,
    duration_ms: 200,
  } as LedgerEvent;
}

test("renderSessionsView: empty state shows guidance", () => {
  const a = new Aggregator();
  const snap = a.snapshot(T0);
  const lines = renderSessionsView(snap, 80);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /no events yet/);
});

test("renderSessionsView: one session row contains harness, session, model, cost", () => {
  const a = new Aggregator();
  a.ingest(llm("5f3a-aaaa", "claude-opus-4-7", 0.40));
  const snap = a.snapshot(T0);
  const lines = renderSessionsView(snap, 100);
  assert.equal(lines.length, 2); // header + 1 row
  const row = lines[1];
  assert.match(row, /claude-cd/);
  assert.match(row, /5f3a-aaaa/);
  assert.match(row, /claude-opus-4-7/);
  assert.match(row, /\$0\.400/);
});

test("renderModelsView: aggregates across sessions, sorted by cost desc", () => {
  const a = new Aggregator();
  a.ingest(llm("s1", "claude-opus-4-7", 0.20));
  a.ingest(llm("s2", "claude-opus-4-7", 0.30));
  a.ingest(llm("s3", "claude-haiku-4-5", 0.01));
  const snap = a.snapshot(T0);
  const lines = renderModelsView(snap, 100);
  assert.equal(lines.length, 3); // header + 2 model rows
  assert.match(lines[1], /claude-opus-4-7/);
  assert.match(lines[1], /\$0\.500/);  // total
  assert.match(lines[2], /claude-haiku-4-5/);
});

test("renderToolsView: rows contain calls, ok, fail, bytes", () => {
  const a = new Aggregator();
  a.ingest(tool("s1", "Bash"));
  a.ingest(tool("s1", "Bash"));
  a.ingest(tool("s1", "Bash", false));
  const snap = a.snapshot(T0);
  const lines = renderToolsView(snap, 100);
  const row = lines[1];
  assert.match(row, /Bash/);
  assert.match(row, /\b3\b/); // 3 calls
});

test("renderHeader: contains the totals", () => {
  const a = new Aggregator();
  a.ingest(llm("s1", "claude-opus-4-7", 1.23));
  const snap = a.snapshot(T0);
  const h = renderHeader(snap, "sessions", 100);
  assert.match(h, /Total/);
  assert.match(h, /\$1\.23/);
  assert.match(h, /sessions/);
});

test("renderFooter: shows current view as active", () => {
  const f = renderFooter(120, "models", 0);
  assert.match(f, /\[m\] models/);
  assert.match(f, /quit/);
});

test("renderFooter: shows unknown-model warning when present", () => {
  const f = renderFooter(120, "sessions", 5);
  assert.match(f, /5 unknown-model events/);
});

test("renderFrame: composes header + sep + body + sep + footer", () => {
  const a = new Aggregator();
  a.ingest(llm("s1", "claude-opus-4-7", 0.10));
  const snap = a.snapshot(T0);
  const frame = renderFrame(snap, "sessions", 12, 100);
  const lines = frame.split("\n");
  // header(1) + sep(1) + body(rows-4 = 8) + sep(1) + footer(1) = 12
  assert.equal(lines.length, 12);
  // body section contains at least one separator line of dashes
  const seps = lines.filter(l => /^─+$/.test(l.trim()));
  assert.ok(seps.length >= 2);
});

test("renderSessionsView: long session ID gets truncated with ellipsis", () => {
  const a = new Aggregator();
  a.ingest(llm("9b2cabc-aaaaaaa-1234567890", "claude-sonnet-4-6", 0.05));
  const snap = a.snapshot(T0);
  const lines = renderSessionsView(snap, 100);
  const row = lines[1];
  assert.match(row, /9b2cabc.*\.\.\./);
});

test("renderSessionsView: multiple harnesses each get a labeled row", () => {
  const a = new Aggregator();
  a.ingest(llm("s1", "claude-opus-4-7", 0.10));
  const piEvent = { ...(llm("s2", "claude-opus-4-7", 0.20) as any), harness: "pi" };
  a.ingest(piEvent);
  const snap = a.snapshot(T0);
  const lines = renderSessionsView(snap, 100);
  assert.equal(lines.length, 3);
  const all = lines.join("\n");
  assert.match(all, /claude-cd/);
  assert.match(all, /\bpi\b/);
});
