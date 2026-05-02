# tokentop

`htop`-style live viewer for AI agent token spend. Reads a JSONL ledger written by the [Claude Code hook](../claude-code-hooks/token-ledger/) and the [Pi/oh-my-pi extension](../pi-extensions/token-ledger/) and shows three live-updating views over the data.

```
Total $6.33 | Rate $0.40/min | Active 1 | Turns 47 | View sessions
────────────────────────────────────────────────────────────────────
HARNESS    SESSION      MODEL                   IN    OUT   COST   ...
pi         5f3a-aaaa    claude-opus-4-7      18.2K   5.4K  $0.40   ...
claude-cd  9b2c-bbbb    claude-sonnet-4-6    42.1K   8.9K  $0.28   ...
claude-cd  3e1a-cccc    claude-haiku-4-5     12.0K   3.2K  $0.05   ...
────────────────────────────────────────────────────────────────────
q quit  [s] sessions  m models  t tools  r reset
```

## Why

Modern coding agents burn tokens. There is no good cross-harness, real-time view of *who is spending what*. tokentop fills that gap, treating the ledger as a contract so any harness can plug in by writing the same JSONL.

## Architecture

```
ledger.ts   → fs.watchFile + tail JSONL,  emit onEvent(e)
aggregator  → pure: events → snapshot, no I/O, fully testable
ui.ts       → re-render every 1s, key handling, view switching
main.ts     → arg parsing, wire it together
views.ts    → pure string-rendering for each view
ansi.ts     → minimal color + cursor escapes (no deps)
format.ts   → tokens/cost/duration/bytes formatters
```

The aggregator is the testable core: events in → snapshot out, pure functions, no clocks or I/O. Most of the test surface lives there. Zero external runtime dependencies.

## Install & run

```bash
npm start                                    # runs against ~/.agent-ledger/events.jsonl
npm start -- --ledger /path/to/events.jsonl  # custom ledger location
npm start -- --no-ui                         # one-shot summary, useful for scripts/CI
```

Requires Node ≥ 22.6 (uses `--experimental-strip-types`).

## Keys (in UI)

| Key | Action |
|-----|--------|
| `q` / `Ctrl-C` | Quit |
| `s` | Sessions view (default) |
| `m` | Models view |
| `t` | Tools view |
| `r` | Reset aggregator (re-read full ledger) |

## Views

**Sessions** (default) — per-session: harness, ID, current model, in/out tokens, cumulative cost, $/min rate, status (`active`/`idle Xm`/`done`).
**Models** — per-model: calls, in/out tokens, cache reads, total cost, average cost per call.
**Tools** — per-tool: calls, ok/fail, average duration, total bytes returned.

## Recording a demo

The demo-feeder script under `scripts/demo-feeder.mjs` streams ~35 seconds of realistic events (two simulated sessions, three models, several tool kinds) to whatever ledger you point it at. Use it with any screen recorder.

**Universal recipe (works with any screen recorder):**
```bash
# Terminal A — start tokentop on a temp ledger
LEDGER=$(mktemp -t tokentop-demo.XXXXXX.jsonl)
node --experimental-strip-types src/main.ts --ledger $LEDGER

# Terminal B — start the feeder, then start your screen recorder, then watch
node scripts/demo-feeder.mjs --ledger $LEDGER --reset
```

Press `s`/`m`/`t` in the tokentop window to cycle the views. `q` to quit.

**On Windows:** native options that work today:
- **Win+G** (Xbox Game Bar) — built into Windows 11, records to MP4
- **ScreenToGif** — open-source, MP4 → GIF directly: <https://www.screentogif.com>
- **OBS Studio** — overkill but reliable

**On Linux / macOS / WSL with vhs + ttyd + ffmpeg installed:**
```bash
vhs demo.tape           # produces demo.gif automatically
```
The `demo.tape` script in this directory drives the same flow as above, captures it, and writes `demo.gif`. Note: `ttyd` doesn't have a clean Windows install, which is why the universal recipe above is the recommended path on Windows.

## Tests

```bash
npm test
```

49 tests. Categories:
- `format.test.ts` (14) — number, cost, duration, bytes, status formatters.
- `aggregator.test.ts` (15) — pure event folding: per-session totals, model aggregation, tool aggregation, active count, sort order, unknown-model handling, rate window, invalid timestamps, reset.
- `ledger.test.ts` (10) — JSONL watcher: missing-file tolerance, initial load, incremental tail, partial-line handling, invalid-JSON skip, blank-line skip, truncation reset, ready event, multi-poll appends.
- `views.test.ts` (10) — pure render: empty states, table rows, column alignment, sort orders, header totals, footer state, frame composition.

## Schema

Reads only events of `event: "llm_call"` or `event: "tool_call"`. Full schema in the [project root README](../README.md). Cost is computed at write time by the producer, so tokentop just sums.

## Cost considerations

- Polling interval: 250ms (`fs.watchFile`). Cross-platform reliable; CPU-cheap for files this size.
- Render rate: 1 Hz. The frame is small enough that even slow terminals handle it.
- Memory: O(sessions + models + tools). For typical use (~10 sessions/day, ~3 models, ~10 tools), trivial.
- Per-session `recent_costs` ring is trimmed to the rate window (60s) at snapshot time.

## Known limits

- Hardcoded list of `harness` values for label translation in `views.ts`. Adding a new harness means adding a label entry.
- No filtering UI yet (`--since 1h` filtering would live in `ledger.ts` initial-load).
- No mouse support — keyboard only. By design (consistent with `htop`'s default mode).
- `prices.json` exists in the producer side, not here. tokentop never computes cost itself; if you want cost-recompute-on-rename-of-models, that's a producer-side concern.

## File layout

```
src/
  main.ts        # entry, CLI parsing
  ui.ts          # TUI loop (raw stdin, render timer)
  views.ts       # pure render functions for each view
  ledger.ts      # JSONL tail watcher
  aggregator.ts  # pure event folding
  format.ts      # number/cost/duration formatters
  ansi.ts        # color/cursor escapes
  types.ts       # shared types
test/
  *.test.ts
package.json     # zero runtime deps
README.md
```
