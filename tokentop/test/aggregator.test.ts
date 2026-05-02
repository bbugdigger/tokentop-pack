import { test } from "node:test";
import assert from "node:assert/strict";
import { Aggregator, ratePerMinute } from "../src/aggregator.ts";
import type { LedgerEvent } from "../src/types.ts";

const T0 = Date.parse("2026-04-30T14:00:00.000Z");
const T0_MS = T0;

function llm(opts: Partial<LedgerEvent> & { ts: string; session: string }): LedgerEvent {
  return {
    ts: opts.ts,
    event: "llm_call",
    harness: (opts as any).harness ?? "claude-code",
    session: opts.session,
    model: (opts as any).model ?? "claude-opus-4-7",
    input_tokens: (opts as any).input_tokens ?? 1000,
    output_tokens: (opts as any).output_tokens ?? 500,
    cache_read_tokens: (opts as any).cache_read_tokens ?? 0,
    cache_creation_tokens: (opts as any).cache_creation_tokens ?? 0,
    cost_usd: (opts as any).cost_usd ?? 0.05,
    duration_ms: (opts as any).duration_ms ?? 2000,
  } as LedgerEvent;
}

function tool(opts: { ts: string; session: string; tool: string; ok?: boolean; duration_ms?: number; bytes_out?: number; harness?: any }): LedgerEvent {
  return {
    ts: opts.ts,
    event: "tool_call",
    harness: opts.harness ?? "claude-code",
    session: opts.session,
    tool: opts.tool,
    ok: opts.ok ?? true,
    duration_ms: opts.duration_ms ?? 100,
    bytes_out: opts.bytes_out ?? 256,
  } as LedgerEvent;
}

test("empty aggregator: snapshot has zero totals", () => {
  const a = new Aggregator();
  const snap = a.snapshot(T0_MS);
  assert.equal(snap.total_cost_today_usd, 0);
  assert.equal(snap.total_turns, 0);
  assert.equal(snap.active_sessions, 0);
  assert.deepEqual(snap.sessions, []);
  assert.deepEqual(snap.models, []);
  assert.deepEqual(snap.tools, []);
});

test("single llm_call creates a session row", () => {
  const a = new Aggregator();
  a.ingest(llm({ ts: "2026-04-30T14:00:00.000Z", session: "s1" }));
  const snap = a.snapshot(T0_MS);
  assert.equal(snap.sessions.length, 1);
  assert.equal(snap.sessions[0].session, "s1");
  assert.equal(snap.sessions[0].llm_calls, 1);
  assert.equal(snap.sessions[0].cost_usd, 0.05);
  assert.equal(snap.total_turns, 1);
  assert.equal(snap.total_cost_today_usd, 0.05);
});

test("multiple llm_calls accumulate per session", () => {
  const a = new Aggregator();
  a.ingest(llm({ ts: "2026-04-30T14:00:00.000Z", session: "s1", input_tokens: 100, output_tokens: 200, cost_usd: 0.01 }));
  a.ingest(llm({ ts: "2026-04-30T14:00:05.000Z", session: "s1", input_tokens: 300, output_tokens: 400, cost_usd: 0.04 }));
  const snap = a.snapshot(T0_MS + 5000);
  const s = snap.sessions[0];
  assert.equal(s.llm_calls, 2);
  assert.equal(s.input_tokens, 400);
  assert.equal(s.output_tokens, 600);
  assert.equal(s.cost_usd, 0.05);
});

test("two harnesses with same session id stay separate", () => {
  const a = new Aggregator();
  a.ingest(llm({ ts: "2026-04-30T14:00:00.000Z", session: "abc", harness: "claude-code" } as any));
  a.ingest(llm({ ts: "2026-04-30T14:00:01.000Z", session: "abc", harness: "pi" } as any));
  const snap = a.snapshot(T0_MS + 1000);
  assert.equal(snap.sessions.length, 2);
  const harnesses = snap.sessions.map(s => s.harness).sort();
  assert.deepEqual(harnesses, ["claude-code", "pi"]);
});

test("model attribution: last model wins per session", () => {
  const a = new Aggregator();
  a.ingest(llm({ ts: "2026-04-30T14:00:00.000Z", session: "s1", model: "claude-haiku-4-5" } as any));
  a.ingest(llm({ ts: "2026-04-30T14:00:01.000Z", session: "s1", model: "claude-opus-4-7" } as any));
  const snap = a.snapshot(T0_MS + 1000);
  assert.equal(snap.sessions[0].model, "claude-opus-4-7");
});

test("model breakdown aggregates across sessions", () => {
  const a = new Aggregator();
  a.ingest(llm({ ts: "2026-04-30T14:00:00.000Z", session: "s1", model: "claude-opus-4-7", cost_usd: 0.20 } as any));
  a.ingest(llm({ ts: "2026-04-30T14:00:01.000Z", session: "s2", model: "claude-opus-4-7", cost_usd: 0.30 } as any));
  a.ingest(llm({ ts: "2026-04-30T14:00:02.000Z", session: "s3", model: "claude-haiku-4-5", cost_usd: 0.01 } as any));
  const snap = a.snapshot(T0_MS + 2000);
  assert.equal(snap.models.length, 2);
  // sorted by cost desc
  assert.equal(snap.models[0].model, "claude-opus-4-7");
  assert.equal(snap.models[0].calls, 2);
  assert.equal(snap.models[0].cost_usd, 0.5);
  assert.equal(snap.models[1].model, "claude-haiku-4-5");
});

test("tool_call updates tool stats and session.tool_calls", () => {
  const a = new Aggregator();
  a.ingest(tool({ ts: "2026-04-30T14:00:00.000Z", session: "s1", tool: "Bash", duration_ms: 200, bytes_out: 1024 }));
  a.ingest(tool({ ts: "2026-04-30T14:00:01.000Z", session: "s1", tool: "Bash", ok: false, duration_ms: 50 }));
  a.ingest(tool({ ts: "2026-04-30T14:00:02.000Z", session: "s1", tool: "Edit", duration_ms: 30 }));
  const snap = a.snapshot(T0_MS + 2000);
  assert.equal(snap.sessions[0].tool_calls, 3);
  assert.equal(snap.tools.length, 2);
  // sorted by calls desc
  const bash = snap.tools.find(t => t.tool === "Bash")!;
  assert.equal(bash.calls, 2);
  assert.equal(bash.ok, 1);
  assert.equal(bash.fail, 1);
  assert.equal(bash.total_duration_ms, 250);
  // 1024 (first event) + 256 (helper default for second) = 1280
  assert.equal(bash.total_bytes_out, 1280);
});

test("active sessions count: only those with last_seen within 30s", () => {
  const a = new Aggregator();
  a.ingest(llm({ ts: "2026-04-30T14:00:00.000Z", session: "old" }));
  a.ingest(llm({ ts: "2026-04-30T14:00:50.000Z", session: "fresh" }));
  // now is 60s after T0 -> "fresh" was 10s ago (active), "old" was 60s ago (idle)
  const snap = a.snapshot(T0_MS + 60_000);
  assert.equal(snap.active_sessions, 1);
});

test("sessions sorted by last_seen desc", () => {
  const a = new Aggregator();
  a.ingest(llm({ ts: "2026-04-30T14:00:00.000Z", session: "first" }));
  a.ingest(llm({ ts: "2026-04-30T14:00:10.000Z", session: "second" }));
  a.ingest(llm({ ts: "2026-04-30T14:00:05.000Z", session: "middle" }));
  const snap = a.snapshot(T0_MS + 10_000);
  assert.deepEqual(snap.sessions.map(s => s.session), ["second", "middle", "first"]);
});

test("unknown model: cost_usd null does not crash, increments warnings", () => {
  const a = new Aggregator();
  a.ingest({ ...(llm({ ts: "2026-04-30T14:00:00.000Z", session: "s1" }) as any), cost_usd: null, model: "weird-model-xyz" });
  const snap = a.snapshot(T0_MS);
  assert.equal(snap.unknown_model_event_count, 1);
  assert.equal(snap.sessions[0].cost_usd, 0);
  assert.equal(snap.sessions[0].unknown_model_calls, 1);
  // model row still created (so user can see what the unknown model was)
  assert.equal(snap.models.length, 1);
  assert.equal(snap.models[0].model, "weird-model-xyz");
  assert.equal(snap.models[0].cost_usd, 0);
});

test("rate computation: only events in last 60s count", () => {
  const a = new Aggregator();
  // Two old events outside window, two recent events inside
  a.ingest(llm({ ts: "2026-04-30T14:00:00.000Z", session: "s1", cost_usd: 1.00 })); // 120s ago
  a.ingest(llm({ ts: "2026-04-30T14:00:30.000Z", session: "s1", cost_usd: 1.00 })); // 90s ago
  a.ingest(llm({ ts: "2026-04-30T14:01:30.000Z", session: "s1", cost_usd: 0.10 })); // 30s ago
  a.ingest(llm({ ts: "2026-04-30T14:01:50.000Z", session: "s1", cost_usd: 0.20 })); // 10s ago
  const now = T0_MS + 120_000;
  const snap = a.snapshot(now);
  const s = snap.sessions[0];
  // recent_costs trimmed to last 60s
  assert.equal(s.recent_costs.length, 2);
  // rate = $0.30 in last 60s = $0.30/min (FP slack)
  assert.ok(Math.abs(ratePerMinute(s, now) - 0.3) < 1e-9);
  // cumulative cost still includes all events
  assert.ok(Math.abs(s.cost_usd - 2.30) < 1e-9);
});

test("invalid timestamp is silently ignored", () => {
  const a = new Aggregator();
  a.ingest(llm({ ts: "not a date", session: "s1" }));
  const snap = a.snapshot(T0_MS);
  assert.equal(snap.sessions.length, 0);
});

test("reset clears all state", () => {
  const a = new Aggregator();
  a.ingest(llm({ ts: "2026-04-30T14:00:00.000Z", session: "s1" }));
  a.reset();
  const snap = a.snapshot(T0_MS);
  assert.equal(snap.sessions.length, 0);
  assert.equal(snap.models.length, 0);
  assert.equal(snap.unknown_model_event_count, 0);
});

test("ingestAll iterates over events", () => {
  const a = new Aggregator();
  const events: LedgerEvent[] = [
    llm({ ts: "2026-04-30T14:00:00.000Z", session: "s1" }),
    llm({ ts: "2026-04-30T14:00:01.000Z", session: "s2" }),
    tool({ ts: "2026-04-30T14:00:02.000Z", session: "s1", tool: "Bash" }),
  ];
  a.ingestAll(events);
  const snap = a.snapshot(T0_MS + 2000);
  assert.equal(snap.sessions.length, 2);
  assert.equal(snap.tools.length, 1);
});

test("first_seen_ms preserved across multiple events", () => {
  const a = new Aggregator();
  a.ingest(llm({ ts: "2026-04-30T14:00:00.000Z", session: "s1" }));
  a.ingest(llm({ ts: "2026-04-30T14:00:30.000Z", session: "s1" }));
  const snap = a.snapshot(T0_MS + 30_000);
  assert.equal(snap.sessions[0].first_seen_ms, T0_MS);
  assert.equal(snap.sessions[0].last_seen_ms, T0_MS + 30_000);
});
