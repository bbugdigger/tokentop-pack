# token-ledger — Pi / oh-my-pi extension

A single-file TypeScript extension that subscribes to Pi's lifecycle events and emits LLM and tool call events to the same `~/.agent-ledger/events.jsonl` consumed by [tokentop](../../tokentop/) and produced by the [Claude Code hooks](../../claude-code-hooks/token-ledger/).

## Why this is small

Pi already computes per-call cost into `m.usage.cost.total` (see `pi-mono/packages/ai/src/types.ts` `Usage` interface). The extension just maps Pi's normalized field names to the ledger schema and writes one line per event. No `prices.json`, no transcript tailing, no cursors.

This is the cross-harness story: Claude Code **needed** a transcript-tailing workaround because hook payloads don't carry usage; Pi exposes everything in the event stream and we get a ~50-LOC extension. Same ledger comes out the other end.

## Events used

| Pi event | Maps to ledger event |
|---|---|
| `message_end` (when `message.role === "assistant"` and `message.usage` present) | `llm_call` |
| `tool_result` | `tool_call` |

Field mapping for `llm_call`:
- `m.usage.input → input_tokens`
- `m.usage.output → output_tokens`
- `m.usage.cacheRead → cache_read_tokens`
- `m.usage.cacheWrite → cache_creation_tokens`
- `m.usage.cost.total → cost_usd`
- `m.model → model`
- `m.timestamp → ts` (ISO 8601)
- `ctx.sessionManager.getSessionFile()` → `session` (UUID extracted from filename)
- `ctx.cwd → project`

Field mapping for `tool_call`:
- `event.toolName → tool`
- `!event.isError → ok`
- `Buffer.byteLength(JSON.stringify(event.content)) → bytes_out`

## Install on pi-mono

```bash
mkdir -p ~/.pi/extensions/token-ledger
cp index.ts package.json ~/.pi/extensions/token-ledger/
```

Or, point at this directory directly via `~/.pi/settings.json`:

```json
{
  "extensions": ["/abs/path/pi-extensions/token-ledger"]
}
```

Then start `pi`. Verify with one short turn, then:

```bash
tail -1 ~/.agent-ledger/events.jsonl | node -e \
  "process.stdin.on('data', d => console.log(JSON.stringify(JSON.parse(d), null, 2)))"
```

You should see an `llm_call` event with `harness: "pi"`.

## Install on oh-my-pi

**Important:** install as an **extension**, not a hook. `message_end` is on the
ExtensionAPI surface only — it is **not** in oh-my-pi's legacy HookAPI event
catalog (per `oh-my-pi/docs/skills/authoring-hooks.md`). If you drop this into
`~/.omp/agent/hooks/`, the `message_end` subscription will silently never fire
and you'll see only `tool_call` events in the ledger.

```bash
mkdir -p ~/.omp/agent/extensions/token-ledger
cp index.ts package.json ~/.omp/agent/extensions/token-ledger/
```

Then start `omp` and verify with one short turn:

```bash
tail -2 ~/.agent-ledger/events.jsonl | node -e \
  "process.stdin.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => console.log(JSON.stringify(JSON.parse(l), null, 2))))"
```

You should see both an `llm_call` event and a `tool_call` event with `harness: "pi"`.

### One-shot test before installing globally

Use the `--extension` flag (extensions) to load it just for one omp session, no install needed:

```bash
omp --extension /abs/path/pi-extensions/token-ledger
```

### No import changes required

The `index.ts` uses **local minimal types** (a small structural interface) instead of
importing from `@mariozechner/pi-coding-agent` or `@oh-my-pi/pi-coding-agent`. That means
the same file loads as-is on both — no sed, no swap. The event shapes the extension
relies on (`message.role`, `message.usage.input/output/cacheRead/cacheWrite/cost.total`,
`event.toolName`, `event.isError`, `ctx.sessionManager.getSessionFile()`, `ctx.cwd`) are
identical between pi-mono and oh-my-pi.

## Tests

```bash
npm test
```

9 tests covering: handler registration, assistant-message detection, user-message ignore, missing-cost null fallback, tool result success/error, undefined session-file fallback, event ordering. The tests mock `ExtensionAPI` so they run without Pi or Bun installed — only Node 22.6+.

## File layout

```
index.ts             # The extension (~70 LOC)
package.json
README.md
test/
  extension.test.ts  # Mock-API tests
```

## Schema

Events follow the shared schema in the [project root README](../../README.md). The same `~/.agent-ledger/events.jsonl` file is appended to by the [Claude Code hooks](../../claude-code-hooks/token-ledger/).
