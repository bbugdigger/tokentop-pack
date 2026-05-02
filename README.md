# Agent Cost & Observability Pack

A small portfolio of AI-agent harness extensions, demonstrating fluency with two production agent harnesses — **Claude Code** and **Pi / oh-my-pi** — by building the same observability primitive on both, and a single TUI viewer that consumes the unified output.

> The strongest signal a portfolio of this size can send is "I understand the abstraction across harnesses, not just one API."

## Three artifacts

```
claude-code-hooks/token-ledger/   # Two Node hooks (Stop + PostToolUse) for Claude Code
pi-extensions/token-ledger/        # One TS extension for Pi / oh-my-pi
tokentop/                          # Live htop-style TUI viewer
```

The hooks/extension write to a shared JSONL ledger; tokentop tails it and aggregates. Adding a third harness later (Cursor, Copilot CLI, …) is one more producer — zero changes to the consumer.

```
   ┌─────────────────────────┐         ┌──────────────────────┐
   │  Claude Code session    │         │   Pi / oh-my-pi      │
   │  Stop + PostToolUse     │         │   message_end +      │
   │  hooks                  │         │   tool_result        │
   └────────────┬────────────┘         └──────────┬───────────┘
                │                                  │
                │  appends JSONL                   │  appends JSONL
                ▼                                  ▼
                  ┌──────────────────────────────┐
                  │ ~/.agent-ledger/events.jsonl │
                  │  (shared schema)             │
                  └──────────────┬───────────────┘
                                 │  fs.watchFile + tail
                                 ▼
                  ┌──────────────────────────────┐
                  │  tokentop                    │
                  │  pure aggregator + TUI       │
                  └──────────────────────────────┘
```

## The cross-harness story (at a glance)

Same data flowing through two very different APIs. The contrast is the point:

| Concern | Claude Code | Pi |
|---|---|---|
| Per-LLM token counts | Not in hook payload — must tail session transcript JSONL with a per-session byte cursor | Direct: `event.message.usage` on `message_end` |
| Cost computation | Vendored `prices.json`, computed by the hook | Pi already computes `usage.cost.total` |
| Tool duration | Not exposed cleanly — would need PreToolUse + PostToolUse pairing | Available on `tool_result` |
| Process model | One hook subprocess per event | In-process subscriber |
| Concurrency | File-append race-safe; per-session cursor file | None to manage |
| LOC (incl. tests) | ~330 | ~150 |

Both write the same line into the same file. The viewer doesn't care which.

## Shared JSONL schema

Path: `~/.agent-ledger/events.jsonl`. Append-only. One JSON object per line. Two event types.

### `llm_call`
```json
{
  "ts": "2026-04-30T14:23:11.482Z",
  "event": "llm_call",
  "harness": "claude-code",
  "session": "5f3a-...",
  "model": "claude-opus-4-7",
  "input_tokens": 1842,
  "output_tokens": 537,
  "cache_read_tokens": 12044,
  "cache_creation_tokens": 0,
  "cost_usd": 0.04127,
  "duration_ms": 4218
}
```

### `tool_call`
```json
{
  "ts": "2026-04-30T14:23:09.110Z",
  "event": "tool_call",
  "harness": "pi",
  "session": "5f3a-...",
  "tool": "Bash",
  "ok": true,
  "bytes_out": 2048,
  "duration_ms": 312
}
```

Rules:
- **Cost is computed at write time** by the producer. Old records keep their original cost (audit trail).
- **No tool inputs/outputs** are logged — only metadata. Avoids leaking secrets, keeps file small.
- **`cost_usd: null`** when the model is unknown to the producer's price table; consumer flags it in the footer.
- **`harness`** is one of `"claude-code"`, `"pi"`, `"oh-my-pi"` — used by the consumer for display labels and source attribution.
- **Optional `meta: object`** for harness-specific notes (e.g. `unknown_model: true`).
- **ISO 8601 UTC timestamps** so cross-machine merges work.

## Live demo

End-to-end smoke (no Claude Code session needed):

```bash
TMP=/tmp/agent-ledger-demo.jsonl
NOW=$(node -e "console.log(new Date().toISOString())")
cat > $TMP <<EOF
{"ts":"$NOW","event":"llm_call","harness":"claude-code","session":"smoke-A","model":"claude-opus-4-7","input_tokens":1842,"output_tokens":537,"cache_read_tokens":12044,"cache_creation_tokens":0,"cost_usd":0.0860}
{"ts":"$NOW","event":"tool_call","harness":"claude-code","session":"smoke-A","tool":"Bash","ok":true,"bytes_out":1024,"duration_ms":312}
{"ts":"$NOW","event":"llm_call","harness":"pi","session":"smoke-B","model":"claude-sonnet-4-6","input_tokens":2400,"output_tokens":100,"cache_read_tokens":0,"cache_creation_tokens":3000,"cost_usd":0.02}
EOF

cd tokentop
npm start -- --ledger $TMP --no-ui   # one-shot summary
npm start -- --ledger $TMP            # interactive TUI; q to quit
```

## Real install

1. **Tokentop** (Node 22.6+, zero runtime deps):
   ```bash
   cd tokentop && npm test && npm start
   ```

2. **Claude Code hooks** — see [`claude-code-hooks/token-ledger/README.md`](claude-code-hooks/token-ledger/README.md).
   Tl;dr: merge `settings.json` into `~/.claude/settings.json`, replace the absolute paths.

3. **Pi extension** — see [`pi-extensions/token-ledger/README.md`](pi-extensions/token-ledger/README.md).
   - pi-mono: `cp -r pi-extensions/token-ledger ~/.pi/extensions/`
   - oh-my-pi: `cp -r pi-extensions/token-ledger ~/.omp/agent/extensions/` (note: **extensions**, not `hooks/` — `message_end` is extension-only on oh-my-pi).
   - Same file works on both: `index.ts` uses local minimal types, no import path swap.

After all three are in place: open three terminals — one for Claude Code, one for Pi, one for `tokentop`. Watch sessions appear and tokens climb in real time.

## Tests

86 tests across the three components, all green.

```bash
( cd claude-code-hooks/token-ledger && npm test )   # 28 tests
( cd pi-extensions/token-ledger     && npm test )   # 9 tests
( cd tokentop                        && npm test )   # 49 tests
```

The Claude Code suite includes 7 integration tests that spawn the actual hook scripts as subprocesses with sample transcript fixtures and assert ledger output. The Pi extension is tested with a mock `ExtensionAPI` (no Pi/Bun required at test time). The aggregator is tested as a pure function over event arrays — no mocks, no fake clocks.

## Engineering choices worth flagging

- **Zero runtime dependencies** for tokentop. Raw ANSI for the TUI; built-in `node:test` + `node:assert`. Total external deps for the whole repo: zero. Reviewers can audit it in one sitting.
- **Pure-function aggregator.** All state changes go through `ingest(event)`; everything else is `snapshot(now_ms)`. Testable without timers or filesystem.
- **Hard separation of I/O from logic.** `ledger.ts` knows about file watching but not aggregation. `aggregator.ts` knows about events but not files. `views.ts` knows about layout but not events. `ui.ts` knows about terminals.
- **Honest about the harness contrast.** The Claude Code hook is bigger and uglier on purpose — it works around a real limitation in CC's hook API. The Pi extension is small because Pi's API is better. Both ship.

## What's not here (deliberately)

- **Auto-updating prices.** `prices.json` is a frozen snapshot per the README in `claude-code-hooks/token-ledger/`. Documented; don't pretend otherwise.
- **Tool inputs/outputs in the ledger.** Privacy + size + scope.
- **Web dashboard.** The TUI is the point.
- **Cursor / Copilot CLI / Aider producers.** The architecture supports them; building them is a follow-up.

## File map

```
README.md                                  # this file
claude-code-hooks/
  token-ledger/
    log-tool.js, log-llm.js, transcript.js, cost.js, ledger.js
    prices.json, settings.json, package.json, README.md
    test/{cost,transcript,hooks-integration}.test.js
pi-extensions/
  token-ledger/
    index.ts, package.json, README.md
    test/extension.test.ts
tokentop/
  src/{main,ui,views,ledger,aggregator,format,ansi,types}.ts
  test/{format,aggregator,ledger,views}.test.ts
  package.json, README.md
```
