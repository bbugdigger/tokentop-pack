// Pi / oh-my-pi extension: emits llm_call and tool_call events to ~/.agent-ledger/events.jsonl.
// Counterpart to claude-code-hooks/token-ledger/. Consumed by tokentop.
//
// Pi already computes per-call cost (m.usage.cost.total), so this extension does NOT
// need a prices.json — it just maps the field names and writes one line per event.
//
// Portability note: this file uses LOCAL minimal type aliases instead of importing
// `ExtensionAPI` / `AssistantMessage` from a Pi package, so the same file loads on
// pi-mono (`@mariozechner/pi-coding-agent`) and oh-my-pi (`@oh-my-pi/pi-coding-agent`)
// without touching imports. Runtime relies on duck-typing the message shape.

import { mkdirSync, appendFileSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, basename } from "node:path";
import { spawn } from "node:child_process";

// --- Local minimal types (structural — match both pi-mono and oh-my-pi) ---

interface MinimalUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: { total?: number };
}

interface MinimalAssistantMessage {
  role: "assistant";
  model: string;
  timestamp?: number;
  usage: MinimalUsage;
}

interface MinimalCtx {
  cwd: string;
  sessionManager: { getSessionFile(): string | undefined };
}

interface MinimalCommandCtx extends MinimalCtx {
  ui: { notify(message: string, type?: "info" | "warning" | "error"): void };
}

interface MinimalToolResultEvent {
  type: "tool_result";
  toolName: string;
  isError: boolean;
  content: unknown;
}

interface MinimalMessageEndEvent {
  type: "message_end";
  message: unknown;
}

interface MinimalApi {
  on(event: "message_end", handler: (e: MinimalMessageEndEvent, ctx: MinimalCtx) => void): void;
  on(event: "tool_result", handler: (e: MinimalToolResultEvent, ctx: MinimalCtx) => void): void;
  registerCommand(
    name: string,
    options: {
      description?: string;
      handler: (args: string, ctx: MinimalCommandCtx) => Promise<void> | void;
    },
  ): void;
}

// --- Tokentop launcher config ---
//
// TOKENTOP_DIR points at the cloned tokentop folder containing src/main.ts.
// Override with environment variable if your repo is elsewhere.
const TOKENTOP_DIR =
  process.env.TOKENTOP_DIR ?? "C:\\TheFactory\\AgentHarness\\tokentop";

// --- Implementation ---

function ledgerFile(): string {
  return join(homedir(), ".agent-ledger", "events.jsonl");
}

function append(event: Record<string, unknown>): void {
  const f = ledgerFile();
  mkdirSync(dirname(f), { recursive: true });
  appendFileSync(f, JSON.stringify(event) + "\n");
}

// Pi session file paths look like:
//   ~/.pi/sessions/projects/<project>/2026-04-30T14-23-11_<uuid>.jsonl
// Strip the directory and trailing extension, keep the UUID after the timestamp.
function extractSessionId(filePath: string | undefined): string {
  if (!filePath) return "unknown";
  const name = basename(filePath, ".jsonl");
  const m = name.match(/_(.+)$/);
  return m ? m[1] : name;
}

function bytesOfContent(content: unknown): number {
  if (content == null) return 0;
  if (typeof content === "string") return Buffer.byteLength(content);
  try {
    return Buffer.byteLength(JSON.stringify(content));
  } catch {
    return 0;
  }
}

function isAssistant(msg: unknown): msg is MinimalAssistantMessage {
  return !!msg && typeof msg === "object" && (msg as any).role === "assistant" && !!(msg as any).usage;
}

export default function (pi: MinimalApi): void {
  pi.on("message_end", (event, ctx) => {
    const msg = event.message;
    if (!isAssistant(msg)) return;
    const m = msg;
    append({
      ts: new Date(m.timestamp ?? Date.now()).toISOString(),
      event: "llm_call",
      harness: "pi",
      session: extractSessionId(ctx.sessionManager.getSessionFile()),
      project: ctx.cwd,
      model: m.model,
      input_tokens: m.usage.input ?? 0,
      output_tokens: m.usage.output ?? 0,
      cache_read_tokens: m.usage.cacheRead ?? 0,
      cache_creation_tokens: m.usage.cacheWrite ?? 0,
      cost_usd: m.usage.cost?.total ?? null,
    });
  });

  pi.on("tool_result", (event, ctx) => {
    append({
      ts: new Date().toISOString(),
      event: "tool_call",
      harness: "pi",
      session: extractSessionId(ctx.sessionManager.getSessionFile()),
      tool: event.toolName,
      ok: !event.isError,
      bytes_out: bytesOfContent(event.content),
    });
  });

  // /tokentop — open the live TUI viewer in a new terminal window.
  // /tokentop status — print a one-line summary inline (no window spawn).
  pi.registerCommand("tokentop", {
    description: "Open tokentop live viewer (or print 'status' for one-line summary)",
    handler: async (args, ctx) => {
      const sub = (args ?? "").trim().toLowerCase();
      if (sub === "status") {
        ctx.ui.notify(buildStatusLine(), "info");
        return;
      }
      const result = launchTokentopWindow();
      ctx.ui.notify(result.message, result.ok ? "info" : "warning");
    },
  });
}

// --- Tokentop launcher + inline status ---

function launchTokentopWindow(): { ok: boolean; message: string } {
  const mainTs = join(TOKENTOP_DIR, "src", "main.ts");
  if (!existsSync(mainTs)) {
    return {
      ok: false,
      message: `tokentop not found at ${mainTs}. Set TOKENTOP_DIR env var to override.`,
    };
  }
  if (process.platform === "win32") {
    // Windows `start "title" PROGRAM ARGS` requires the title to be quoted —
    // an unquoted first positional arg is interpreted as the program name (which
    // is why `start tokentop cmd ...` triggers "Windows cannot find tokentop").
    // We use windowsVerbatimArguments to pass the raw cmd string through
    // unmangled by Node's argument escaping, with cmd's own `""` to literalize
    // double-quotes inside the outer quoted /k argument.
    const verbatim = `/c start "tokentop" cmd /k "node --experimental-strip-types ""${mainTs}"""`;
    try {
      const child = spawn("cmd.exe", [verbatim], {
        windowsVerbatimArguments: true,
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      return { ok: true, message: "tokentop opened in a new terminal window" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        message: `Failed to launch tokentop window: ${msg}. Run manually: cd "${TOKENTOP_DIR}" && npm start`,
      };
    }
  }
  // POSIX: no portable terminal-spawner. Tell the user what to run.
  return {
    ok: false,
    message: `Run in another terminal: cd "${TOKENTOP_DIR}" && npm start`,
  };
}

function buildStatusLine(): string {
  const f = ledgerFile();
  if (!existsSync(f)) return "tokentop: no events yet (ledger is empty)";
  let totalCost = 0;
  let llmCount = 0;
  let toolCount = 0;
  const sessions = new Set<string>();
  try {
    const text = readFileSync(f, "utf8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        if (ev.event === "llm_call") {
          llmCount++;
          if (typeof ev.cost_usd === "number") totalCost += ev.cost_usd;
        } else if (ev.event === "tool_call") {
          toolCount++;
        }
        if (ev.session) sessions.add(`${ev.harness}/${ev.session}`);
      } catch {
        /* skip bad line */
      }
    }
  } catch {
    return "tokentop: failed to read ledger";
  }
  const cost = totalCost < 0.01 ? totalCost.toFixed(4) : totalCost.toFixed(2);
  return `tokentop: $${cost} across ${sessions.size} session(s), ${llmCount} turn(s), ${toolCount} tool call(s)`;
}
