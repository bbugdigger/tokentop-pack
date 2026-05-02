import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTranscriptChunk } from "../transcript.js";

const ASSISTANT_ENTRY = {
  type: "assistant",
  timestamp: "2026-04-30T14:23:11.482Z",
  message: {
    role: "assistant",
    model: "claude-opus-4-7",
    content: [{ type: "text", text: "hi" }],
    usage: {
      input_tokens: 1842,
      output_tokens: 537,
      cache_read_input_tokens: 12044,
      cache_creation_input_tokens: 0,
    },
  },
};

const USER_ENTRY = {
  type: "user",
  timestamp: "2026-04-30T14:23:00.000Z",
  message: { role: "user", content: "hello" },
};

test("parseTranscriptChunk: extracts assistant usage records", () => {
  const chunk = JSON.stringify(ASSISTANT_ENTRY) + "\n";
  const { usages, consumedTo } = parseTranscriptChunk(chunk, 0);
  assert.equal(usages.length, 1);
  assert.equal(usages[0].model, "claude-opus-4-7");
  assert.equal(usages[0].usage.input_tokens, 1842);
  assert.equal(consumedTo, chunk.length);
});

test("parseTranscriptChunk: skips non-assistant entries", () => {
  const chunk = JSON.stringify(USER_ENTRY) + "\n" + JSON.stringify(ASSISTANT_ENTRY) + "\n";
  const { usages } = parseTranscriptChunk(chunk, 0);
  assert.equal(usages.length, 1);
});

test("parseTranscriptChunk: skips assistant entries without usage", () => {
  const without = { ...ASSISTANT_ENTRY, message: { ...ASSISTANT_ENTRY.message, usage: undefined } };
  const chunk = JSON.stringify(without) + "\n";
  const { usages } = parseTranscriptChunk(chunk, 0);
  assert.equal(usages.length, 0);
});

test("parseTranscriptChunk: leaves trailing partial line uncomsumed", () => {
  const complete = JSON.stringify(ASSISTANT_ENTRY) + "\n";
  const partial = `{"type":"assistant","message":{`;  // no \n, half-written
  const chunk = complete + partial;
  const { usages, consumedTo } = parseTranscriptChunk(chunk, 0);
  assert.equal(usages.length, 1);
  assert.equal(consumedTo, complete.length); // partial line not consumed
});

test("parseTranscriptChunk: ignores invalid JSON lines (no crash)", () => {
  const chunk = "not json\n" + JSON.stringify(ASSISTANT_ENTRY) + "\n" + "{ broken\n";
  const { usages, consumedTo } = parseTranscriptChunk(chunk, 0);
  assert.equal(usages.length, 1);
  // All three lines have \n so all three were consumed (just with two parse failures swallowed)
  assert.equal(consumedTo, chunk.length);
});

test("parseTranscriptChunk: respects startOffset in returned consumedTo", () => {
  const chunk = JSON.stringify(ASSISTANT_ENTRY) + "\n";
  const { consumedTo } = parseTranscriptChunk(chunk, 1000);
  assert.equal(consumedTo, 1000 + chunk.length);
});

test("parseTranscriptChunk: empty chunk returns no usages, no advance", () => {
  const { usages, consumedTo } = parseTranscriptChunk("", 500);
  assert.deepEqual(usages, []);
  assert.equal(consumedTo, 500);
});

test("parseTranscriptChunk: skips blank lines", () => {
  const chunk = "\n\n" + JSON.stringify(ASSISTANT_ENTRY) + "\n\n";
  const { usages } = parseTranscriptChunk(chunk, 0);
  assert.equal(usages.length, 1);
});
