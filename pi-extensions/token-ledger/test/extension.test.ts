// Tests run without Pi installed: we mock ExtensionAPI as a handler-collecting
// object, fire fake events, and assert the ledger file contents.
//
// The HOME env var is set BEFORE importing the extension (which builds the
// ledger path lazily from os.homedir()), so writes land in a tmpdir.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmp: string;

before(() => {
  tmp = mkdtempSync(join(tmpdir(), "pi-tlt-"));
  process.env.HOME = tmp;
  process.env.USERPROFILE = tmp; // homedir() reads this on Windows
});

after(() => {
  if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

function freshTmp() {
  if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
}

function readLedger(): any[] {
  const f = join(tmp, ".agent-ledger", "events.jsonl");
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
}

type Handler = (event: any, ctx: any) => void | Promise<void>;
type CommandHandler = (args: string, ctx: any) => void | Promise<void>;

function makeMockApi() {
  const handlers = new Map<string, Handler[]>();
  const commands = new Map<string, { description?: string; handler: CommandHandler }>();
  const api = {
    on(event: string, handler: Handler) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)!.push(handler);
    },
    registerCommand(name: string, options: { description?: string; handler: CommandHandler }) {
      commands.set(name, options);
    },
  } as any;
  return { api, handlers, commands };
}

function makeCtx(sessionFile: string | undefined, cwd = "/proj") {
  return {
    cwd,
    sessionManager: { getSessionFile: () => sessionFile },
  } as any;
}

function makeCommandCtx(notifications: Array<{ msg: string; type?: string }>) {
  return {
    cwd: "/proj",
    sessionManager: { getSessionFile: () => undefined },
    ui: { notify: (msg: string, type?: string) => notifications.push({ msg, type }) },
  } as any;
}

test("registers exactly two handlers (message_end and tool_result)", async () => {
  freshTmp();
  const { default: setup } = await import("../index.ts");
  const { api, handlers } = makeMockApi();
  setup(api);
  assert.deepEqual([...handlers.keys()].sort(), ["message_end", "tool_result"]);
  assert.equal(handlers.get("message_end")!.length, 1);
  assert.equal(handlers.get("tool_result")!.length, 1);
});

test("registers /tokentop slash command with a description", async () => {
  freshTmp();
  const { default: setup } = await import("../index.ts");
  const { api, commands } = makeMockApi();
  setup(api);
  assert.ok(commands.has("tokentop"));
  const cmd = commands.get("tokentop")!;
  assert.equal(typeof cmd.description, "string");
  assert.equal(typeof cmd.handler, "function");
});

test("/tokentop status: empty ledger -> notifies 'no events yet'", async () => {
  freshTmp();
  const { default: setup } = await import("../index.ts");
  const { api, commands } = makeMockApi();
  setup(api);
  const notes: Array<{ msg: string; type?: string }> = [];
  await commands.get("tokentop")!.handler("status", makeCommandCtx(notes));
  assert.equal(notes.length, 1);
  assert.match(notes[0].msg, /no events yet/);
});

test("/tokentop status: with events -> notifies summary including total + counts", async () => {
  freshTmp();
  const { default: setup } = await import("../index.ts");
  const { api, handlers, commands } = makeMockApi();
  setup(api);

  const ctx = makeCtx("/x/sess-A.jsonl");
  const mkAssistant = (cost_total: number) => ({
    role: "assistant",
    model: "claude-haiku-4-5",
    timestamp: Date.now(),
    usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost_total } },
  });
  await handlers.get("message_end")![0]({ type: "message_end", message: mkAssistant(0.05) }, ctx);
  await handlers.get("message_end")![0]({ type: "message_end", message: mkAssistant(0.07) }, ctx);
  await handlers.get("tool_result")![0]({ type: "tool_result", toolCallId: "t", toolName: "bash", input: {}, isError: false, content: [] }, ctx);

  const notes: Array<{ msg: string; type?: string }> = [];
  await commands.get("tokentop")!.handler("status", makeCommandCtx(notes));
  assert.equal(notes.length, 1);
  assert.match(notes[0].msg, /\$0\.12/); // total cost
  assert.match(notes[0].msg, /1 session/);
  assert.match(notes[0].msg, /2 turn/);
  assert.match(notes[0].msg, /1 tool call/);
});

test("/tokentop (no subcommand): on non-Windows, returns POSIX hint without spawning", async (t) => {
  // Override platform to simulate POSIX environment
  const origPlat = process.platform;
  Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
  try {
    freshTmp();
    const { default: setup } = await import("../index.ts");
    const { api, commands } = makeMockApi();
    setup(api);
    const notes: Array<{ msg: string; type?: string }> = [];
    await commands.get("tokentop")!.handler("", makeCommandCtx(notes));
    assert.equal(notes.length, 1);
    // On non-Windows we either get the "tokentop not found" message (if path invalid)
    // or the "Run in another terminal" hint. Both are 'warning' since we didn't spawn.
    assert.equal(notes[0].type, "warning");
  } finally {
    Object.defineProperty(process, "platform", { value: origPlat, configurable: true });
  }
});

test("message_end on assistant message: writes llm_call event with mapped fields", async () => {
  freshTmp();
  const { default: setup } = await import("../index.ts");
  const { api, handlers } = makeMockApi();
  setup(api);

  const msg = {
    role: "assistant",
    model: "claude-opus-4-7",
    timestamp: Date.parse("2026-04-30T14:23:11.482Z"),
    usage: {
      input: 1842,
      output: 537,
      cacheRead: 12044,
      cacheWrite: 0,
      totalTokens: 14423,
      cost: { input: 0.0276, output: 0.0403, cacheRead: 0.0181, cacheWrite: 0, total: 0.0860 },
    },
  };
  await handlers.get("message_end")![0]({ type: "message_end", message: msg }, makeCtx("/x/2026-04-30T14-23-11_5f3a-aaaa.jsonl"));

  const events = readLedger();
  assert.equal(events.length, 1);
  const e = events[0];
  assert.equal(e.event, "llm_call");
  assert.equal(e.harness, "pi");
  assert.equal(e.session, "5f3a-aaaa");
  assert.equal(e.model, "claude-opus-4-7");
  assert.equal(e.input_tokens, 1842);
  assert.equal(e.output_tokens, 537);
  assert.equal(e.cache_read_tokens, 12044);
  assert.equal(e.cache_creation_tokens, 0);
  assert.equal(e.cost_usd, 0.086);
  assert.equal(e.ts, "2026-04-30T14:23:11.482Z");
  assert.equal(e.project, "/proj");
});

test("message_end on user message is ignored", async () => {
  freshTmp();
  const { default: setup } = await import("../index.ts");
  const { api, handlers } = makeMockApi();
  setup(api);

  await handlers.get("message_end")![0](
    { type: "message_end", message: { role: "user", content: "hello", timestamp: Date.now() } },
    makeCtx("/x/sess.jsonl"),
  );
  assert.equal(readLedger().length, 0);
});

test("message_end on assistant without usage is ignored", async () => {
  freshTmp();
  const { default: setup } = await import("../index.ts");
  const { api, handlers } = makeMockApi();
  setup(api);

  await handlers.get("message_end")![0](
    { type: "message_end", message: { role: "assistant", model: "x", timestamp: Date.now() } },
    makeCtx("/x/sess.jsonl"),
  );
  assert.equal(readLedger().length, 0);
});

test("missing cost (cost field absent): cost_usd becomes null", async () => {
  freshTmp();
  const { default: setup } = await import("../index.ts");
  const { api, handlers } = makeMockApi();
  setup(api);

  const msg = {
    role: "assistant",
    model: "weird-model",
    timestamp: Date.parse("2026-04-30T14:00:00.000Z"),
    usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 150 },
  };
  await handlers.get("message_end")![0]({ type: "message_end", message: msg }, makeCtx("/x/sess.jsonl"));

  const events = readLedger();
  assert.equal(events.length, 1);
  assert.equal(events[0].cost_usd, null);
});

test("tool_result: writes tool_call event with ok flag and bytes_out", async () => {
  freshTmp();
  const { default: setup } = await import("../index.ts");
  const { api, handlers } = makeMockApi();
  setup(api);

  const event = {
    type: "tool_result",
    toolCallId: "t1",
    toolName: "bash",
    input: { command: "ls" },
    isError: false,
    content: [{ type: "text", text: "file1\nfile2\n" }],
  };
  await handlers.get("tool_result")![0](event, makeCtx("/x/sess.jsonl"));

  const events = readLedger();
  assert.equal(events.length, 1);
  const e = events[0];
  assert.equal(e.event, "tool_call");
  assert.equal(e.harness, "pi");
  assert.equal(e.tool, "bash");
  assert.equal(e.ok, true);
  assert.ok(e.bytes_out > 0);
});

test("tool_result with isError=true: ok=false", async () => {
  freshTmp();
  const { default: setup } = await import("../index.ts");
  const { api, handlers } = makeMockApi();
  setup(api);

  await handlers.get("tool_result")![0](
    { type: "tool_result", toolCallId: "t1", toolName: "bash", input: {}, isError: true, content: [] },
    makeCtx("/x/sess.jsonl"),
  );
  const events = readLedger();
  assert.equal(events.length, 1);
  assert.equal(events[0].ok, false);
});

test("session id falls back to 'unknown' when sessionFile is undefined", async () => {
  freshTmp();
  const { default: setup } = await import("../index.ts");
  const { api, handlers } = makeMockApi();
  setup(api);

  const msg = {
    role: "assistant",
    model: "claude-opus-4-7",
    timestamp: Date.now(),
    usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 20, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.001 } },
  };
  await handlers.get("message_end")![0]({ type: "message_end", message: msg }, makeCtx(undefined));
  assert.equal(readLedger()[0].session, "unknown");
});

test("multiple events are appended in order", async () => {
  freshTmp();
  const { default: setup } = await import("../index.ts");
  const { api, handlers } = makeMockApi();
  setup(api);

  const ctx = makeCtx("/x/sess-A.jsonl");
  const mkAssistant = (cost_total: number) => ({
    role: "assistant",
    model: "claude-haiku-4-5",
    timestamp: Date.now(),
    usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost_total } },
  });

  await handlers.get("message_end")![0]({ type: "message_end", message: mkAssistant(0.001) }, ctx);
  await handlers.get("tool_result")![0]({ type: "tool_result", toolCallId: "t", toolName: "edit", input: {}, isError: false, content: [{ type: "text", text: "x" }] }, ctx);
  await handlers.get("message_end")![0]({ type: "message_end", message: mkAssistant(0.002) }, ctx);

  const events = readLedger();
  assert.equal(events.length, 3);
  assert.equal(events[0].event, "llm_call");
  assert.equal(events[1].event, "tool_call");
  assert.equal(events[2].event, "llm_call");
});
