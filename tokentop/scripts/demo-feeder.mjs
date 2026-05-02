#!/usr/bin/env node
// demo-feeder: produce realistic ledger events for a tokentop demo recording.
// Writes to a TARGET ledger over ~30 seconds, simulating two concurrent agent
// sessions (one Claude Code, one Pi) doing realistic work.
//
// Usage:
//   node scripts/demo-feeder.mjs [--ledger PATH]
// Defaults to ~/.agent-ledger/events.jsonl. Use a tmp file if you don't want
// to mix demo data with your real ledger.

import { mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

function parseArgs(argv) {
  const out = { ledger: join(homedir(), ".agent-ledger", "events.jsonl"), reset: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--ledger" && i + 1 < argv.length) out.ledger = argv[++i];
    else if (argv[i] === "--reset") out.reset = true;
  }
  return out;
}

function append(file, event) {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(event) + "\n");
}

function nowIso() { return new Date().toISOString(); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

const TOOLS_CC = ["Bash", "Edit", "Read", "Grep", "Glob"];
const TOOLS_PI = ["bash", "edit", "read", "grep"];

const args = parseArgs(process.argv.slice(2));
if (args.reset) writeFileSync(args.ledger, "");
mkdirSync(dirname(args.ledger), { recursive: true });

console.error(`feeding events to: ${args.ledger}`);
console.error(`(run \`node src/main.ts --ledger ${args.ledger}\` in another terminal)`);
console.error(`demo runs ~35 seconds, Ctrl-C to stop early`);

// Two simulated sessions. CC session opens first, Pi session joins ~5s later.
const ccSession = "5f3a-aaaa-1234";
const piSession = "9b2c-bbbb-5678";

async function ccTurn(model, in_tok, out_tok, cost, tools) {
  for (const t of tools) {
    append(args.ledger, {
      ts: nowIso(),
      event: "tool_call",
      harness: "claude-code",
      session: ccSession,
      tool: t,
      ok: Math.random() > 0.05,
      bytes_out: Math.floor(Math.random() * 4096) + 200,
      duration_ms: Math.floor(Math.random() * 400) + 50,
    });
    await sleep(150 + Math.random() * 200);
  }
  append(args.ledger, {
    ts: nowIso(),
    event: "llm_call",
    harness: "claude-code",
    session: ccSession,
    model,
    input_tokens: in_tok,
    output_tokens: out_tok,
    cache_read_tokens: Math.floor(in_tok * 0.6),
    cache_creation_tokens: 0,
    cost_usd: cost,
    duration_ms: Math.floor(Math.random() * 3000) + 1000,
  });
}

async function piTurn(model, in_tok, out_tok, cost, tools) {
  for (const t of tools) {
    append(args.ledger, {
      ts: nowIso(),
      event: "tool_call",
      harness: "pi",
      session: piSession,
      tool: t,
      ok: true,
      bytes_out: Math.floor(Math.random() * 8192) + 500,
      duration_ms: Math.floor(Math.random() * 200) + 30,
    });
    await sleep(100 + Math.random() * 150);
  }
  append(args.ledger, {
    ts: nowIso(),
    event: "llm_call",
    harness: "pi",
    session: piSession,
    model,
    input_tokens: in_tok,
    output_tokens: out_tok,
    cache_read_tokens: Math.floor(in_tok * 0.4),
    cache_creation_tokens: 0,
    cost_usd: cost,
    duration_ms: Math.floor(Math.random() * 2000) + 800,
  });
}

async function main() {
  // Phase 1 (0-5s): CC starts, does a quick read+grep
  await ccTurn("claude-sonnet-4-6", 1842, 537, 0.018, ["Read", "Grep"]);
  await sleep(2000);
  await ccTurn("claude-sonnet-4-6", 2400, 800, 0.024, ["Bash"]);
  await sleep(1000);

  // Phase 2 (5-15s): Pi joins on opus, does heavy work
  await piTurn("claude-opus-4-7", 8000, 2400, 0.30, ["read", "grep", "edit"]);
  await sleep(800);
  await piTurn("claude-opus-4-7", 5000, 1500, 0.18, ["bash", "edit"]);
  await sleep(800);
  await piTurn("claude-opus-4-7", 6000, 1800, 0.21, ["bash"]);
  await sleep(1000);

  // Phase 3 (15-25s): both running concurrently, tokens accumulate visibly
  await Promise.all([
    ccTurn("claude-haiku-4-5", 800, 200, 0.002, [pick(TOOLS_CC)]),
    piTurn("claude-opus-4-7", 4000, 1200, 0.14, [pick(TOOLS_PI)]),
  ]);
  await sleep(1500);
  await Promise.all([
    ccTurn("claude-haiku-4-5", 1200, 300, 0.003, [pick(TOOLS_CC), pick(TOOLS_CC)]),
    piTurn("claude-opus-4-7", 3500, 900, 0.11, [pick(TOOLS_PI)]),
  ]);
  await sleep(1500);

  // Phase 4 (25-35s): CC stops; Pi keeps going briefly, then ends
  await piTurn("claude-opus-4-7", 2500, 600, 0.08, ["read"]);
  await sleep(2000);
  await piTurn("claude-opus-4-7", 1800, 400, 0.06, ["bash"]);

  console.error("demo done. Sessions will go idle, then 'done' after 10 minutes.");
}

main().catch(err => {
  console.error("feeder failed:", err);
  process.exit(1);
});
