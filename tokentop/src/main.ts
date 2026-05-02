#!/usr/bin/env node
// tokentop entry point. Run via `npm start` or directly:
//   node --experimental-strip-types src/main.ts [--ledger PATH] [--no-ui]

import { homedir } from "node:os";
import { join } from "node:path";
import { Aggregator } from "./aggregator.ts";
import { LedgerWatcher } from "./ledger.ts";
import { UI } from "./ui.ts";

interface Args {
  ledger: string;
  noUi: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    ledger: join(homedir(), ".agent-ledger", "events.jsonl"),
    noUi: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ledger" && i + 1 < argv.length) {
      out.ledger = argv[++i];
    } else if (a === "--no-ui") {
      out.noUi = true;
    } else if (a === "-h" || a === "--help") {
      printHelpAndExit();
    }
  }
  return out;
}

function printHelpAndExit(): never {
  process.stdout.write(`tokentop — htop-style live viewer for AI agent token spend

Usage:
  tokentop [--ledger PATH] [--no-ui]

Options:
  --ledger PATH   Path to events.jsonl (default: ~/.agent-ledger/events.jsonl)
  --no-ui         Print event count and exit (smoke-test mode)
  -h, --help      Show this help

Keys (in UI):
  q  quit
  s  sessions view (default)
  m  models view
  t  tools view
  r  reset aggregator (re-read full ledger)
`);
  process.exit(0);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const aggregator = new Aggregator();
  const watcher = new LedgerWatcher(args.ledger);

  watcher.on("event", (e) => aggregator.ingest(e));
  watcher.on("truncated", () => aggregator.reset());

  await watcher.start();

  if (args.noUi) {
    const snap = aggregator.snapshot(Date.now());
    process.stdout.write(`ledger: ${args.ledger}\n`);
    process.stdout.write(`sessions: ${snap.sessions.length}\n`);
    process.stdout.write(`models:   ${snap.models.length}\n`);
    process.stdout.write(`tools:    ${snap.tools.length}\n`);
    process.stdout.write(`turns:    ${snap.total_turns}\n`);
    process.stdout.write(`total:    $${snap.total_cost_today_usd.toFixed(4)}\n`);
    watcher.stop();
    return;
  }

  const ui = new UI({ aggregator });
  ui.start(() => {
    watcher.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  process.stderr.write(`tokentop: ${err?.message ?? err}\n`);
  process.exit(1);
});
