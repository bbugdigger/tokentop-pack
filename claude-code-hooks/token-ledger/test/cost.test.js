import { test } from "node:test";
import assert from "node:assert/strict";
import { costUsd, normalizeModelName, knownModels } from "../cost.js";

test("normalizeModelName: strips Anthropic date suffix", () => {
  assert.equal(normalizeModelName("claude-opus-4-7-20251201"), "claude-opus-4-7");
  assert.equal(normalizeModelName("claude-sonnet-4-6-20250115"), "claude-sonnet-4-6");
});

test("normalizeModelName: leaves bare names alone", () => {
  assert.equal(normalizeModelName("claude-haiku-4-5"), "claude-haiku-4-5");
});

test("normalizeModelName: strips bracketed suffix like [1m]", () => {
  assert.equal(normalizeModelName("claude-opus-4-7[1m]"), "claude-opus-4-7");
});

test("costUsd: opus 4.7 with input + output", () => {
  const c = costUsd("claude-opus-4-7", { input_tokens: 1_000_000, output_tokens: 1_000_000 });
  // 1M input * $15 + 1M output * $75 = $90.00
  assert.ok(Math.abs(c - 90) < 1e-9);
});

test("costUsd: handles cache_read_input_tokens (Anthropic name)", () => {
  const c = costUsd("claude-sonnet-4-6", { cache_read_input_tokens: 1_000_000 });
  // 1M cache read * $0.30 = $0.30
  assert.ok(Math.abs(c - 0.30) < 1e-9);
});

test("costUsd: handles cache_read_tokens (our schema name)", () => {
  const c = costUsd("claude-sonnet-4-6", { cache_read_tokens: 1_000_000 });
  assert.ok(Math.abs(c - 0.30) < 1e-9);
});

test("costUsd: handles cache_creation_input_tokens", () => {
  const c = costUsd("claude-haiku-4-5", { cache_creation_input_tokens: 1_000_000 });
  // 1M cache create * $1.25 = $1.25
  assert.ok(Math.abs(c - 1.25) < 1e-9);
});

test("costUsd: missing usage fields default to 0", () => {
  const c = costUsd("claude-haiku-4-5", {});
  assert.equal(c, 0);
});

test("costUsd: unknown model returns null", () => {
  assert.equal(costUsd("gpt-7-ultra", { input_tokens: 100 }), null);
  assert.equal(costUsd("", { input_tokens: 100 }), null);
});

test("costUsd: dated model name normalizes and looks up correctly", () => {
  const c = costUsd("claude-opus-4-7-20251201", { input_tokens: 1_000_000 });
  // 1M input * $15 = $15
  assert.ok(Math.abs(c - 15) < 1e-9);
});

test("costUsd: realistic mixed usage", () => {
  // A typical Sonnet turn: small input, small output, big cache read
  const c = costUsd("claude-sonnet-4-6", {
    input_tokens: 1_842,
    output_tokens: 537,
    cache_read_input_tokens: 12_044,
    cache_creation_input_tokens: 0,
  });
  // 1842/1M * 3 + 537/1M * 15 + 12044/1M * 0.30
  // = 0.005526 + 0.008055 + 0.0036132 = 0.0171942
  assert.ok(Math.abs(c - 0.0171942) < 1e-6);
});

test("knownModels: returns all model keys, no _comment entries", () => {
  const ms = knownModels();
  assert.ok(ms.includes("claude-opus-4-7"));
  assert.ok(ms.includes("claude-sonnet-4-6"));
  assert.ok(ms.includes("claude-haiku-4-5"));
  assert.ok(!ms.some(m => m.startsWith("_")));
});
