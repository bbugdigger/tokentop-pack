import type {
  Harness,
  LedgerEvent,
  LlmCallEvent,
  ModelStats,
  SessionStats,
  Snapshot,
  ToolCallEvent,
  ToolStats,
} from "./types.ts";

const RATE_WINDOW_MS = 60_000;
const ACTIVE_WINDOW_MS = 30_000;

function sessionKey(harness: Harness, session: string): string {
  return `${harness}/${session}`;
}

function newSession(harness: Harness, session: string, ts_ms: number): SessionStats {
  return {
    harness,
    session,
    model: null,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    cost_usd: 0,
    llm_calls: 0,
    tool_calls: 0,
    first_seen_ms: ts_ms,
    last_seen_ms: ts_ms,
    recent_costs: [],
    unknown_model_calls: 0,
  };
}

function newModel(model: string): ModelStats {
  return {
    model,
    calls: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    cost_usd: 0,
  };
}

function newTool(tool: string): ToolStats {
  return { tool, calls: 0, ok: 0, fail: 0, total_duration_ms: 0, total_bytes_out: 0 };
}

export class Aggregator {
  private sessions = new Map<string, SessionStats>();
  private models = new Map<string, ModelStats>();
  private tools = new Map<string, ToolStats>();
  private unknown_model_event_count = 0;

  ingest(event: LedgerEvent): void {
    if (event.event === "llm_call") this.ingestLlmCall(event);
    else if (event.event === "tool_call") this.ingestToolCall(event);
  }

  ingestAll(events: Iterable<LedgerEvent>): void {
    for (const e of events) this.ingest(e);
  }

  private ingestLlmCall(e: LlmCallEvent): void {
    const ts_ms = Date.parse(e.ts);
    if (Number.isNaN(ts_ms)) return;

    const key = sessionKey(e.harness, e.session);
    let s = this.sessions.get(key);
    if (!s) {
      s = newSession(e.harness, e.session, ts_ms);
      this.sessions.set(key, s);
    }
    s.model = e.model;
    s.input_tokens += e.input_tokens;
    s.output_tokens += e.output_tokens;
    s.cache_read_tokens += e.cache_read_tokens;
    s.cache_creation_tokens += e.cache_creation_tokens;
    s.llm_calls += 1;
    s.last_seen_ms = Math.max(s.last_seen_ms, ts_ms);

    if (e.cost_usd === null) {
      s.unknown_model_calls += 1;
      this.unknown_model_event_count += 1;
    } else {
      s.cost_usd += e.cost_usd;
      s.recent_costs.push({ ts_ms, cost: e.cost_usd });
    }

    let m = this.models.get(e.model);
    if (!m) {
      m = newModel(e.model);
      this.models.set(e.model, m);
    }
    m.calls += 1;
    m.input_tokens += e.input_tokens;
    m.output_tokens += e.output_tokens;
    m.cache_read_tokens += e.cache_read_tokens;
    m.cache_creation_tokens += e.cache_creation_tokens;
    if (e.cost_usd !== null) m.cost_usd += e.cost_usd;
  }

  private ingestToolCall(e: ToolCallEvent): void {
    const ts_ms = Date.parse(e.ts);
    if (Number.isNaN(ts_ms)) return;

    const key = sessionKey(e.harness, e.session);
    let s = this.sessions.get(key);
    if (!s) {
      s = newSession(e.harness, e.session, ts_ms);
      this.sessions.set(key, s);
    }
    s.tool_calls += 1;
    s.last_seen_ms = Math.max(s.last_seen_ms, ts_ms);

    let t = this.tools.get(e.tool);
    if (!t) {
      t = newTool(e.tool);
      this.tools.set(e.tool, t);
    }
    t.calls += 1;
    if (e.ok) t.ok += 1;
    else t.fail += 1;
    t.total_duration_ms += e.duration_ms ?? 0;
    t.total_bytes_out += e.bytes_out ?? 0;
  }

  reset(): void {
    this.sessions.clear();
    this.models.clear();
    this.tools.clear();
    this.unknown_model_event_count = 0;
  }

  snapshot(now_ms: number): Snapshot {
    let total_cost = 0;
    let total_turns = 0;
    let active = 0;
    const sessions: SessionStats[] = [];

    for (const s of this.sessions.values()) {
      total_cost += s.cost_usd;
      total_turns += s.llm_calls;
      if (now_ms - s.last_seen_ms < ACTIVE_WINDOW_MS) active += 1;
      const trimmed_recent = s.recent_costs.filter(rc => now_ms - rc.ts_ms < RATE_WINDOW_MS);
      sessions.push({ ...s, recent_costs: trimmed_recent });
    }

    sessions.sort((a, b) => b.last_seen_ms - a.last_seen_ms);

    const models = [...this.models.values()].sort((a, b) => b.cost_usd - a.cost_usd);
    const tools = [...this.tools.values()].sort((a, b) => b.calls - a.calls);

    return {
      generated_at_ms: now_ms,
      total_cost_today_usd: total_cost,
      total_turns,
      active_sessions: active,
      sessions,
      models,
      tools,
      unknown_model_event_count: this.unknown_model_event_count,
    };
  }
}

export function ratePerMinute(s: SessionStats, now_ms: number): number {
  let sum = 0;
  for (const rc of s.recent_costs) {
    if (now_ms - rc.ts_ms < RATE_WINDOW_MS) sum += rc.cost;
  }
  return sum * (60_000 / RATE_WINDOW_MS);
}
