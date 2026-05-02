export type Harness = "claude-code" | "pi" | "oh-my-pi";

export interface LlmCallEvent {
  ts: string;
  event: "llm_call";
  harness: Harness;
  session: string;
  project?: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost_usd: number | null;
  duration_ms?: number;
  meta?: Record<string, unknown>;
}

export interface ToolCallEvent {
  ts: string;
  event: "tool_call";
  harness: Harness;
  session: string;
  tool: string;
  ok: boolean;
  bytes_out?: number;
  duration_ms?: number;
  meta?: Record<string, unknown>;
}

export type LedgerEvent = LlmCallEvent | ToolCallEvent;

export interface SessionStats {
  harness: Harness;
  session: string;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost_usd: number;
  llm_calls: number;
  tool_calls: number;
  first_seen_ms: number;
  last_seen_ms: number;
  recent_costs: Array<{ ts_ms: number; cost: number }>;
  unknown_model_calls: number;
}

export interface ModelStats {
  model: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost_usd: number;
}

export interface ToolStats {
  tool: string;
  calls: number;
  ok: number;
  fail: number;
  total_duration_ms: number;
  total_bytes_out: number;
}

export interface Snapshot {
  generated_at_ms: number;
  total_cost_today_usd: number;
  total_turns: number;
  active_sessions: number;
  sessions: SessionStats[];
  models: ModelStats[];
  tools: ToolStats[];
  unknown_model_event_count: number;
}
