# Agent Cost & Observability Pack

A small toolkit for tracking what your AI coding agents are actually doing: how many tokens they consume, what they cost, which models you're spending the most on, and which tools each session leans on. Works with **Claude Code** and **Pi / oh-my-pi** today; designed so other harnesses can be added by writing a single producer.

Three pieces, one shared file:

```
claude-code-hooks/token-ledger/   # Stop + PostToolUse hooks for Claude Code
pi-extensions/token-ledger/        # Extension for Pi / oh-my-pi
tokentop/                          # htop-style live TUI viewer
```

The hooks/extension write to `~/.agent-ledger/events.jsonl`; tokentop tails it and renders three live views (sessions / models / tools).

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
                  └──────────────┬───────────────┘
                                 │  fs.watchFile + tail
                                 ▼
                  ┌──────────────────────────────┐
                  │  tokentop                    │
                  │  (live TUI)                  │
                  └──────────────────────────────┘
```

## Quick start

You don't need both producers installed. Try the consumer first against synthetic data:

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

Then install the producer for whichever harness you use.

## Install

### Claude Code

See [`claude-code-hooks/token-ledger/README.md`](claude-code-hooks/token-ledger/README.md). Short version: merge the snippet from `settings.json` into your `~/.claude/settings.json`, replacing the absolute paths with where you cloned this repo.

### Pi / oh-my-pi

See [`pi-extensions/token-ledger/README.md`](pi-extensions/token-ledger/README.md). Short version:

- **pi-mono:** `cp -r pi-extensions/token-ledger ~/.pi/extensions/`
- **oh-my-pi:** `cp -r pi-extensions/token-ledger ~/.omp/agent/extensions/` — install as an extension, **not** under `hooks/`. The `message_end` event we subscribe to is on the ExtensionAPI surface only; the legacy HookAPI doesn't expose it, so a hook-style install would silently drop all `llm_call` events.

The same `index.ts` works on both pi-mono and oh-my-pi without any import changes — it uses local minimal type aliases instead of importing from the host package.

The Pi extension also registers a `/tokentop` slash command:

- `/tokentop` — opens the live tokentop TUI in a new terminal window (Windows only — POSIX falls back to printing the manual command)
- `/tokentop status` — prints a one-line summary inline, e.g. `tokentop: $0.12 across 1 session(s), 2 turn(s), 1 tool call(s)`

### tokentop

```bash
cd tokentop
npm test
npm start
```

Requires Node 22.6 or newer (uses `--experimental-strip-types` for native TypeScript). Zero runtime dependencies.

## Shared JSONL schema

Path: `~/.agent-ledger/events.jsonl`. Append-only, one JSON object per line, two event types.

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

### Schema rules

- **Cost is computed at write time** by the producer. Old records keep their original cost (so historical totals don't shift if pricing changes).
- **No tool inputs or outputs** are logged — only metadata (`tool`, `ok`, `bytes_out`, `duration_ms`). Keeps the file small and avoids leaking secrets that may appear in tool I/O.
- **`cost_usd: null`** when the model is unknown to the producer's price table. The viewer surfaces these as a warning so they're not silently zero.
- **`harness`** is one of `"claude-code"`, `"pi"`, `"oh-my-pi"`. The viewer uses it for display labels and source attribution.
- **Optional `meta`** object for harness-specific notes (e.g. `unknown_model: true`, `apiErrorMessage: "..."`).
- **ISO 8601 UTC timestamps** so files merged across machines stay sortable.

## How each producer works

The two producers solve the same problem differently because their host APIs expose different things:

| Concern | Claude Code | Pi |
|---|---|---|
| Per-LLM token counts | Not in hook payload — the hook tails the session transcript JSONL with a per-session byte cursor | Direct: `event.message.usage` on `message_end` |
| Cost computation | Vendored `prices.json`, computed by the hook | Pi already provides `usage.cost.total` |
| Tool duration | Not exposed cleanly without pairing PreToolUse + PostToolUse | Available on `tool_result` |
| Process model | One hook subprocess per event | In-process subscriber |
| Concurrency | File-append race-safe; per-session cursor file | None to manage |

Both write the same line into the same file; the viewer doesn't care which produced it.

## Adding a new harness

1. Write a producer that subscribes to the harness's "LLM call finished" and "tool call finished" hooks.
2. Map the harness's field names to the schema above.
3. Compute `cost_usd` from your own price table, or set it to `null` if pricing isn't known.
4. Append one JSON line per event to `~/.agent-ledger/events.jsonl`.

The viewer needs no changes — add an entry for your `harness` value to its display-label map if you want a friendlier name in the table.

## Tests

```bash
( cd claude-code-hooks/token-ledger && npm test )   # 28 tests
( cd pi-extensions/token-ledger     && npm test )   # 13 tests
( cd tokentop                        && npm test )   # 49 tests
```

Highlights:

- The Claude Code suite includes integration tests that spawn the actual hook scripts as subprocesses with sample transcript fixtures and assert the resulting ledger output.
- The Pi extension is covered by mock-API tests — no Pi or Bun runtime required to run them.
- The aggregator is tested as a pure function over event arrays: no mocks, no fake clocks, no filesystem.

## Limitations / not supported

- **Auto-updating prices.** `prices.json` (Claude Code side) is a frozen snapshot. Pi/oh-my-pi computes cost itself, so its events are unaffected.
- **Tool inputs and outputs are not stored.** This is by design — the ledger is for cost/usage, not audit replay.
- **No web UI.** The TUI is the only viewer.
- **Producers shipped:** Claude Code, Pi, oh-my-pi. Cursor / Copilot CLI / Aider / others would need their own producer (small — see "Adding a new harness" above).
- **Window-spawning of `/tokentop` is Windows-only** in the current Pi extension. POSIX shells get a fallback message with the manual command.

## File map

```
README.md
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
  scripts/demo-feeder.mjs
  demo.tape, package.json, README.md
```
