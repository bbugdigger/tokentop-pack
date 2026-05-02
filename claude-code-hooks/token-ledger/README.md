# token-ledger — Claude Code hooks

Two hooks for [Claude Code](https://claude.com/claude-code) that emit LLM and tool-call events to a shared JSONL ledger consumed by [tokentop](../../tokentop/).

- **`log-tool.js`** (`PostToolUse`) — emits one `tool_call` event per tool invocation.
- **`log-llm.js`** (`Stop`) — tails the session transcript and emits one `llm_call` event per assistant turn (with token counts and computed cost).

## How it works

Claude Code's hook payloads do **not** include per-LLM token counts. Token usage lives in the session transcript JSONL at `~/.claude/projects/<project>/<session-id>.jsonl`, in `entry.message.usage` on each `"type":"assistant"` line. The `Stop` hook reads from there.

So `log-llm.js`:
1. On every `Stop` event, opens the transcript at the session's stored byte cursor.
2. Reads new bytes, parses complete lines (anything past the last `\n` is left for next time).
3. For each new assistant entry with `usage`, computes cost from a vendored price table and appends an `llm_call` event.
4. Writes the new cursor.

Cursor state lives at `~/.agent-ledger/cursors/<session_id>.json`. External truncation (cursor > file size) → reset to 0.

## Install

1. Verify CC's transcript format matches our assumption (10-second sanity check):
   ```bash
   ls ~/.claude/projects/                         # find your project dir
   head -2 ~/.claude/projects/<your-project>/<session>.jsonl | node -e \
     "process.stdin.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => console.log(JSON.parse(l).type, JSON.parse(l).message?.usage ? '<usage>' : '')))"
   ```
   You should see at least one line tagged `assistant <usage>`. If not, CC's schema has drifted; open an issue.

2. Merge `settings.json` into your `~/.claude/settings.json`. Replace `/ABSOLUTE/PATH/TO/...` with the real path:
   ```json
   {
     "hooks": {
       "PostToolUse": [
         { "matcher": ".*", "hooks": [
           { "type": "command", "command": "node /abs/path/claude-code-hooks/token-ledger/log-tool.js" }
         ] }
       ],
       "Stop": [
         { "hooks": [
           { "type": "command", "command": "node /abs/path/claude-code-hooks/token-ledger/log-llm.js" }
         ] }
       ]
     }
   }
   ```

3. Start a new Claude Code session, run two short turns (e.g. ask it to list a directory).

4. Verify:
   ```bash
   tail -3 ~/.agent-ledger/events.jsonl | node -e \
     "process.stdin.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => console.log(JSON.stringify(JSON.parse(l), null, 2))))"
   ```
   You should see at least one `llm_call` and one `tool_call` event.

## Uninstall

Remove the two hook entries from `~/.claude/settings.json`. Optionally `rm -rf ~/.agent-ledger/`.

## File layout

```
log-tool.js        # PostToolUse entry point      (~50 LOC)
log-llm.js         # Stop entry point             (~80 LOC)
transcript.js      # Pure JSONL chunk parser      (~25 LOC, fully tested)
cost.js            # Pure cost math + model name normalization (~30 LOC, fully tested)
ledger.js          # Append + cursor I/O           (~30 LOC)
prices.json        # Frozen Anthropic price snapshot (per million tokens, USD)
settings.json      # Snippet to merge into ~/.claude/settings.json
test/
  cost.test.js                # cost math + name normalization
  transcript.test.js          # parser edge cases (partial lines, blank lines, bad JSON)
  hooks-integration.test.js   # spawns the actual hooks as subprocesses, verifies ledger output
  fixtures/sample-transcript.jsonl
```

## Tests

```bash
npm test
```

28 tests across the cost math (with model-name normalization), the JSONL chunk parser, and end-to-end subprocess integration covering: tool-call emission, error detection, missing-field tolerance, cursor-based incremental tail, unknown-model handling, and missing-transcript handling.

## Updating prices

`prices.json` is a frozen snapshot. Authoritative source: <https://www.anthropic.com/pricing>. After editing, run `npm test` — `cost.test.js` includes a realistic-mixed-usage assertion that will fail loudly if a price entry is mistyped.

## Schema

Events written to `~/.agent-ledger/events.jsonl` follow the shared schema documented in the [project root README](../../README.md). Both events share `ts`, `event`, `harness`, `session`; `llm_call` adds token counts and cost; `tool_call` adds `tool`, `ok`, `bytes_out`.
