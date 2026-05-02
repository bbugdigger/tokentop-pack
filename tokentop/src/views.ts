// Pure string-rendering for the three views. No I/O, no terminal control.
// Each function takes a Snapshot + width and returns an array of lines.

import type { Snapshot, SessionStats } from "./types.ts";
import { ratePerMinute } from "./aggregator.ts";
import {
  formatTokens,
  formatCost,
  formatRate,
  formatStatus,
  formatBytes,
  formatDuration,
  shortSession,
  truncate,
} from "./format.ts";
import { bold, dim, fg, visibleLength } from "./ansi.ts";

export type View = "sessions" | "models" | "tools";

const HARNESS_LABEL: Record<string, string> = {
  "claude-code": "claude-cd",
  "pi": "pi",
  "oh-my-pi": "oh-my-pi",
};

export function renderHeader(snap: Snapshot, view: View, width: number): string {
  const totalRate = snap.sessions.reduce((acc, s) => acc + ratePerMinute(s, snap.generated_at_ms), 0);
  const parts = [
    `${dim("Total")} ${bold(formatCost(snap.total_cost_today_usd))}`,
    `${dim("Rate")} ${bold(formatRate(totalRate))}`,
    `${dim("Active")} ${bold(String(snap.active_sessions))}`,
    `${dim("Turns")} ${bold(String(snap.total_turns))}`,
    `${dim("View")} ${bold(view)}`,
  ];
  const joined = " | ".split("|").join(dim("|")).length === 3 ? parts.join(" | ") : parts.join(" | ");
  return padOrTruncate(joined, width);
}

export function renderFooter(width: number, view: View, unknownCount: number): string {
  const keys = [
    `${bold("q")} quit`,
    activeKey("s", "sessions", view === "sessions"),
    activeKey("m", "models",   view === "models"),
    activeKey("t", "tools",    view === "tools"),
    `${bold("r")} reset`,
  ];
  const left = keys.join("  ");
  const right = unknownCount > 0 ? fg.yellow(`${unknownCount} unknown-model events`) : "";
  return padBetween(left, right, width);
}

function activeKey(key: string, label: string, active: boolean): string {
  return active ? bold(`[${key}] ${label}`) : `${bold(key)} ${label}`;
}

export function renderSessionsView(snap: Snapshot, width: number): string[] {
  if (snap.sessions.length === 0) {
    return [dim("(no events yet — start a Claude Code or Pi session and they'll appear here)")];
  }
  const cols = [
    { name: "HARNESS",  width: 10 },
    { name: "SESSION",  width: 12 },
    { name: "MODEL",    width: 22 },
    { name: "IN",       width:  8, right: true },
    { name: "OUT",      width:  8, right: true },
    { name: "COST",     width:  9, right: true },
    { name: "RATE",     width: 11, right: true },
    { name: "STATUS",   width: 10 },
  ];
  const lines: string[] = [renderTableHeader(cols, width)];
  for (const s of snap.sessions) {
    const rate = ratePerMinute(s, snap.generated_at_ms);
    const cells = [
      HARNESS_LABEL[s.harness] ?? s.harness,
      shortSession(s.session, 12),
      s.model ?? "?",
      formatTokens(s.input_tokens),
      formatTokens(s.output_tokens),
      formatCost(s.cost_usd),
      rate > 0 ? formatRate(rate) : dim("$0.00/min"),
      formatStatus(snap.generated_at_ms, s.last_seen_ms),
    ];
    lines.push(renderRow(cols, cells, width));
  }
  return lines;
}

export function renderModelsView(snap: Snapshot, width: number): string[] {
  if (snap.models.length === 0) {
    return [dim("(no model usage yet)")];
  }
  const cols = [
    { name: "MODEL",       width: 26 },
    { name: "CALLS",       width:  7, right: true },
    { name: "IN",          width:  9, right: true },
    { name: "OUT",         width:  9, right: true },
    { name: "CACHE_RD",    width: 10, right: true },
    { name: "COST",        width: 10, right: true },
    { name: "AVG/CALL",    width: 11, right: true },
  ];
  const lines: string[] = [renderTableHeader(cols, width)];
  for (const m of snap.models) {
    const avg = m.calls > 0 ? m.cost_usd / m.calls : 0;
    const cells = [
      m.model,
      String(m.calls),
      formatTokens(m.input_tokens),
      formatTokens(m.output_tokens),
      formatTokens(m.cache_read_tokens),
      formatCost(m.cost_usd),
      formatCost(avg),
    ];
    lines.push(renderRow(cols, cells, width));
  }
  return lines;
}

export function renderToolsView(snap: Snapshot, width: number): string[] {
  if (snap.tools.length === 0) {
    return [dim("(no tool calls yet)")];
  }
  const cols = [
    { name: "TOOL",        width: 18 },
    { name: "CALLS",       width:  7, right: true },
    { name: "OK",          width:  6, right: true },
    { name: "FAIL",        width:  6, right: true },
    { name: "AVG_MS",      width:  9, right: true },
    { name: "BYTES_OUT",   width: 12, right: true },
  ];
  const lines: string[] = [renderTableHeader(cols, width)];
  for (const t of snap.tools) {
    const avgMs = t.calls > 0 ? Math.round(t.total_duration_ms / t.calls) : 0;
    const cells = [
      t.tool,
      String(t.calls),
      String(t.ok),
      t.fail > 0 ? fg.red(String(t.fail)) : String(t.fail),
      formatDuration(avgMs),
      formatBytes(t.total_bytes_out),
    ];
    lines.push(renderRow(cols, cells, width));
  }
  return lines;
}

interface Col { name: string; width: number; right?: boolean; }

function renderTableHeader(cols: Col[], width: number): string {
  const cells = cols.map(c => alignCell(c.name, c.width, c.right ?? false));
  return dim(padOrTruncate(cells.join(" "), width));
}

function renderRow(cols: Col[], cells: string[], width: number): string {
  const aligned = cols.map((c, i) => alignCell(cells[i] ?? "", c.width, c.right ?? false));
  return padOrTruncate(aligned.join(" "), width);
}

function alignCell(s: string, width: number, right: boolean): string {
  const v = visibleLength(s);
  if (v === width) return s;
  if (v > width) return truncate(s, width);
  const pad = " ".repeat(width - v);
  return right ? pad + s : s + pad;
}

function padOrTruncate(s: string, width: number): string {
  const v = visibleLength(s);
  if (v === width) return s;
  if (v > width) return truncate(s, width);
  return s + " ".repeat(width - v);
}

function padBetween(left: string, right: string, width: number): string {
  const lv = visibleLength(left);
  const rv = visibleLength(right);
  const space = Math.max(1, width - lv - rv);
  return left + " ".repeat(space) + right;
}

/** Top-level frame composer: header + view body + footer. Returns full screen. */
export function renderFrame(snap: Snapshot, view: View, rows: number, cols: number): string {
  const header = renderHeader(snap, view, cols);
  const footer = renderFooter(cols, view, snap.unknown_model_event_count);
  let body: string[];
  if (view === "sessions") body = renderSessionsView(snap, cols);
  else if (view === "models") body = renderModelsView(snap, cols);
  else body = renderToolsView(snap, cols);

  // Lay out: header (1 line) + blank + body + (filler) + footer (1 line)
  const bodyMaxRows = Math.max(1, rows - 4);
  const bodyShown = body.slice(0, bodyMaxRows);
  while (bodyShown.length < bodyMaxRows) bodyShown.push("");

  const sep = dim("─".repeat(cols));
  return [header, sep, ...bodyShown, sep, footer].join("\n");
}
