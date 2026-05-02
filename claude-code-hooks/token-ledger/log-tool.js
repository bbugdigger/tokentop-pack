#!/usr/bin/env node
// PostToolUse hook for Claude Code: appends a tool_call event to the agent ledger.
//
// stdin payload (from Claude Code):
//   { session_id, transcript_path, hook_event_name, tool_name, tool_input, tool_response }
// Always exits 0 — never blocks the agent.

import { readFileSync } from "node:fs";
import { appendEvent } from "./ledger.js";

function readStdinSync() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function bytesOf(value) {
  if (value == null) return 0;
  if (typeof value === "string") return Buffer.byteLength(value);
  if (Buffer.isBuffer(value)) return value.length;
  try { return Buffer.byteLength(JSON.stringify(value)); } catch { return 0; }
}

function isOk(toolResponse) {
  if (!toolResponse) return true;
  if (typeof toolResponse !== "object") return true;
  if ("error" in toolResponse && toolResponse.error) return false;
  if (toolResponse.is_error === true) return false;
  return true;
}

function main() {
  const raw = readStdinSync().trim();
  if (!raw) process.exit(0);
  let payload;
  try { payload = JSON.parse(raw); } catch { process.exit(0); }

  const { session_id, tool_name, tool_response } = payload;
  if (!session_id || !tool_name) process.exit(0);

  appendEvent({
    ts: new Date().toISOString(),
    event: "tool_call",
    harness: "claude-code",
    session: session_id,
    tool: tool_name,
    ok: isOk(tool_response),
    bytes_out: bytesOf(tool_response?.content ?? tool_response),
  });
  process.exit(0);
}

main();
