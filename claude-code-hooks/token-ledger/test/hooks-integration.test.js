import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOK_DIR = join(__dirname, "..");
const LOG_TOOL = join(HOOK_DIR, "log-tool.js");
const LOG_LLM = join(HOOK_DIR, "log-llm.js");
const FIXTURE = join(__dirname, "fixtures", "sample-transcript.jsonl");

let tmp;

before(() => {
  tmp = mkdtempSync(join(tmpdir(), "tlt-"));
});

after(() => {
  if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

function runHook(scriptPath, payload) {
  const env = { ...process.env, HOME: tmp, USERPROFILE: tmp };
  return spawnSync(process.execPath, [scriptPath], {
    input: JSON.stringify(payload),
    env,
    encoding: "utf8",
  });
}

function readLedger() {
  const f = join(tmp, ".agent-ledger", "events.jsonl");
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
}

test("log-tool.js: emits a tool_call event for a Bash invocation", () => {
  const result = runHook(LOG_TOOL, {
    session_id: "test-sess-1",
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    tool_input: { command: "ls" },
    tool_response: { content: "file1\nfile2\n" },
  });
  assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
  const events = readLedger();
  assert.equal(events.length, 1);
  const e = events[0];
  assert.equal(e.event, "tool_call");
  assert.equal(e.harness, "claude-code");
  assert.equal(e.session, "test-sess-1");
  assert.equal(e.tool, "Bash");
  assert.equal(e.ok, true);
  assert.equal(e.bytes_out, Buffer.byteLength("file1\nfile2\n"));
  assert.ok(e.ts);
});

test("log-tool.js: ok=false when tool_response.is_error is true", () => {
  // wipe ledger between subtests by recreating tmp
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const result = runHook(LOG_TOOL, {
    session_id: "test-sess-2",
    tool_name: "Bash",
    tool_input: { command: "false" },
    tool_response: { is_error: true, content: "exit 1" },
  });
  assert.equal(result.status, 0);
  const events = readLedger();
  assert.equal(events.length, 1);
  assert.equal(events[0].ok, false);
});

test("log-tool.js: missing required fields exits 0 silently", () => {
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const result = runHook(LOG_TOOL, { session_id: "x" }); // no tool_name
  assert.equal(result.status, 0);
  assert.equal(readLedger().length, 0);
});

test("log-llm.js: extracts both assistant entries from sample transcript", () => {
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const result = runHook(LOG_LLM, {
    session_id: "sess-A",
    transcript_path: FIXTURE,
    hook_event_name: "Stop",
  });
  assert.equal(result.status, 0, `stderr=${result.stderr}`);
  const events = readLedger();
  assert.equal(events.length, 2);

  const opus = events[0];
  assert.equal(opus.event, "llm_call");
  assert.equal(opus.harness, "claude-code");
  assert.equal(opus.session, "sess-A");
  assert.equal(opus.model, "claude-opus-4-7"); // date suffix stripped
  assert.equal(opus.input_tokens, 1842);
  assert.equal(opus.output_tokens, 537);
  assert.equal(opus.cache_read_tokens, 12044);
  // 1842/1M*15 + 537/1M*75 + 12044/1M*1.5 = 0.02763 + 0.040275 + 0.018066 = 0.085971
  assert.ok(Math.abs(opus.cost_usd - 0.085971) < 1e-6, `cost was ${opus.cost_usd}`);

  const sonnet = events[1];
  assert.equal(sonnet.model, "claude-sonnet-4-6");
  assert.equal(sonnet.cache_creation_tokens, 3000);
});

test("log-llm.js: cursor advances so re-invocation does NOT double-emit", () => {
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const payload = { session_id: "sess-B", transcript_path: FIXTURE, hook_event_name: "Stop" };
  runHook(LOG_LLM, payload);
  const after_first = readLedger();
  assert.equal(after_first.length, 2);

  // Second invocation: nothing new in transcript -> no new events
  runHook(LOG_LLM, payload);
  const after_second = readLedger();
  assert.equal(after_second.length, 2);
});

test("log-llm.js: missing transcript file exits cleanly with no events", () => {
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const result = runHook(LOG_LLM, {
    session_id: "ghost",
    transcript_path: join(tmp, "does-not-exist.jsonl"),
  });
  assert.equal(result.status, 0);
  assert.equal(readLedger().length, 0);
});

test("log-llm.js: unknown model emits cost_usd: null with meta.unknown_model", () => {
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const transcript = join(tmp, "weird.jsonl");
  writeFileSync(transcript, JSON.stringify({
    type: "assistant",
    timestamp: "2026-04-30T15:00:00.000Z",
    message: { role: "assistant", model: "unknown-model-xyz", usage: { input_tokens: 1000, output_tokens: 500 } },
  }) + "\n");
  runHook(LOG_LLM, { session_id: "sess-C", transcript_path: transcript });
  const events = readLedger();
  assert.equal(events.length, 1);
  assert.equal(events[0].cost_usd, null);
  assert.equal(events[0].meta?.unknown_model, true);
});

test("log-llm.js: incremental tail picks up only new transcript lines", () => {
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const transcript = join(tmp, "growing.jsonl");
  const entry = (model, ts, in_tok) => JSON.stringify({
    type: "assistant",
    timestamp: ts,
    message: { role: "assistant", model, usage: { input_tokens: in_tok, output_tokens: 100 } },
  }) + "\n";

  writeFileSync(transcript, entry("claude-haiku-4-5", "2026-04-30T16:00:00.000Z", 100));
  runHook(LOG_LLM, { session_id: "sess-D", transcript_path: transcript });
  assert.equal(readLedger().length, 1);

  // append a new turn
  writeFileSync(transcript, entry("claude-haiku-4-5", "2026-04-30T16:00:00.000Z", 100) + entry("claude-haiku-4-5", "2026-04-30T16:00:10.000Z", 200));
  runHook(LOG_LLM, { session_id: "sess-D", transcript_path: transcript });
  assert.equal(readLedger().length, 2);
});
