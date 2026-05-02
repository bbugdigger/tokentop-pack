#!/usr/bin/env node
// Stop hook for Claude Code: tails the session transcript and emits llm_call events.
//
// Claude Code does NOT pass per-LLM token counts to hooks; they live in the session
// transcript JSONL at ~/.claude/projects/<project>/<session>.jsonl. This hook reads
// new transcript entries since the last invocation (cursor stored per session) and
// emits one llm_call event per assistant turn.
//
// stdin payload: { session_id, transcript_path, hook_event_name }
// Always exits 0 — never blocks the agent.

import { readFileSync, statSync, existsSync, openSync, readSync, closeSync } from "node:fs";
import { appendEvent, readCursor, writeCursor } from "./ledger.js";
import { costUsd, normalizeModelName } from "./cost.js";
import { parseTranscriptChunk } from "./transcript.js";

function readStdinSync() {
  try { return readFileSync(0, "utf8"); } catch { return ""; }
}

function readChunkFrom(path, offset) {
  const stat = statSync(path);
  if (offset >= stat.size) return { chunk: "", newSize: stat.size };
  const length = stat.size - offset;
  const buf = Buffer.alloc(length);
  const fd = openSync(path, "r");
  try { readSync(fd, buf, 0, length, offset); } finally { closeSync(fd); }
  return { chunk: buf.toString("utf8"), newSize: stat.size };
}

function main() {
  const raw = readStdinSync().trim();
  if (!raw) process.exit(0);
  let payload;
  try { payload = JSON.parse(raw); } catch { process.exit(0); }

  const { session_id, transcript_path } = payload;
  if (!session_id || !transcript_path) process.exit(0);
  if (!existsSync(transcript_path)) process.exit(0);

  let cursor = readCursor(session_id);

  // Detect external truncation: cursor past file end -> reset to 0.
  let stat;
  try { stat = statSync(transcript_path); } catch { process.exit(0); }
  if (cursor > stat.size) cursor = 0;

  const { chunk, newSize } = readChunkFrom(transcript_path, cursor);
  if (!chunk) process.exit(0);

  const { usages, consumedTo } = parseTranscriptChunk(chunk, cursor);

  for (const u of usages) {
    const cost = costUsd(u.model, u.usage);
    const meta = {};
    if (cost === null) meta.unknown_model = true;
    appendEvent({
      ts: u.ts,
      event: "llm_call",
      harness: "claude-code",
      session: session_id,
      model: normalizeModelName(u.model),
      input_tokens: u.usage.input_tokens ?? 0,
      output_tokens: u.usage.output_tokens ?? 0,
      cache_read_tokens: u.usage.cache_read_input_tokens ?? u.usage.cache_read_tokens ?? 0,
      cache_creation_tokens: u.usage.cache_creation_input_tokens ?? u.usage.cache_creation_tokens ?? 0,
      cost_usd: cost,
      ...(Object.keys(meta).length ? { meta } : {}),
    });
  }

  // Advance cursor only to end of last complete line; partial trailing line
  // (no \n yet) is read again next invocation.
  writeCursor(session_id, consumedTo === cursor ? newSize : consumedTo);
  process.exit(0);
}

main();
