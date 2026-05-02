export function formatTokens(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  return `${(n / 1_000_000_000).toFixed(2)}B`;
}

export function formatCost(usd: number | null): string {
  if (usd === null) return "?";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatRate(usd_per_min: number): string {
  if (usd_per_min === 0) return "$0.00/min";
  if (usd_per_min < 0.01) return `$${usd_per_min.toFixed(4)}/min`;
  return `$${usd_per_min.toFixed(2)}/min`;
}

export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  return `${m}m${String(s).padStart(2, "0")}s`;
}

export function formatBytes(b: number): string {
  if (b < 1_024) return `${b}B`;
  if (b < 1_024 * 1_024) return `${(b / 1_024).toFixed(1)}KB`;
  if (b < 1_024 * 1_024 * 1_024) return `${(b / (1_024 * 1_024)).toFixed(1)}MB`;
  return `${(b / (1_024 * 1_024 * 1_024)).toFixed(2)}GB`;
}

export function formatStatus(now_ms: number, last_seen_ms: number): string {
  const idle_ms = now_ms - last_seen_ms;
  if (idle_ms < 30_000) return "active";
  if (idle_ms < 600_000) return `idle ${Math.floor(idle_ms / 60_000)}m`;
  return "done";
}

export function shortSession(id: string, width = 8): string {
  if (id.length <= width) return id;
  return id.slice(0, width - 3) + "...";
}

export function truncate(s: string, width: number): string {
  if (s.length <= width) return s.padEnd(width, " ");
  if (width <= 3) return s.slice(0, width);
  return s.slice(0, width - 3) + "...";
}
