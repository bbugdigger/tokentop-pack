import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatTokens,
  formatCost,
  formatRate,
  formatDuration,
  formatBytes,
  formatStatus,
  shortSession,
  truncate,
} from "../src/format.ts";

test("formatTokens: small numbers stay literal", () => {
  assert.equal(formatTokens(0), "0");
  assert.equal(formatTokens(42), "42");
  assert.equal(formatTokens(999), "999");
});

test("formatTokens: thousands as K with one decimal", () => {
  assert.equal(formatTokens(1_000), "1.0K");
  assert.equal(formatTokens(18_234), "18.2K");
  assert.equal(formatTokens(999_999), "1000.0K");
});

test("formatTokens: millions as M with two decimals", () => {
  assert.equal(formatTokens(1_000_000), "1.00M");
  assert.equal(formatTokens(2_500_000), "2.50M");
});

test("formatCost: null becomes ?", () => {
  assert.equal(formatCost(null), "?");
});

test("formatCost: tiered precision", () => {
  assert.equal(formatCost(0.0001), "$0.0001");
  assert.equal(formatCost(0.005), "$0.0050");
  assert.equal(formatCost(0.5), "$0.500");
  assert.equal(formatCost(4.23), "$4.23");
  assert.equal(formatCost(1234.56), "$1234.56");
});

test("formatRate: zero is zero", () => {
  assert.equal(formatRate(0), "$0.00/min");
});

test("formatRate: cents per minute", () => {
  assert.equal(formatRate(0.12), "$0.12/min");
  assert.equal(formatRate(2.5), "$2.50/min");
});

test("formatDuration: ms / s / m+s", () => {
  assert.equal(formatDuration(0), "0ms");
  assert.equal(formatDuration(412), "412ms");
  assert.equal(formatDuration(2_500), "2.5s");
  assert.equal(formatDuration(125_000), "2m05s");
});

test("formatBytes: B / KB / MB", () => {
  assert.equal(formatBytes(0), "0B");
  assert.equal(formatBytes(512), "512B");
  assert.equal(formatBytes(2_048), "2.0KB");
  assert.equal(formatBytes(5_242_880), "5.0MB");
});

test("formatStatus: active under 30s", () => {
  const now = 1_000_000;
  assert.equal(formatStatus(now, now - 5_000), "active");
  assert.equal(formatStatus(now, now - 29_999), "active");
});

test("formatStatus: idle Xm between 30s and 10m", () => {
  const now = 1_000_000;
  assert.equal(formatStatus(now, now - 30_000), "idle 0m");
  assert.equal(formatStatus(now, now - 120_000), "idle 2m");
  assert.equal(formatStatus(now, now - 599_999), "idle 9m");
});

test("formatStatus: done past 10m", () => {
  const now = 1_000_000;
  assert.equal(formatStatus(now, now - 600_000), "done");
  assert.equal(formatStatus(now, now - 3_600_000), "done");
});

test("shortSession: pads or truncates to width", () => {
  assert.equal(shortSession("abc", 8), "abc");
  assert.equal(shortSession("5f3a-1b2c-9d4e", 8), "5f3a-...");
});

test("truncate: pads short strings, ellipsizes long ones", () => {
  assert.equal(truncate("hi", 5), "hi   ");
  assert.equal(truncate("abcdefgh", 5), "ab...");
  assert.equal(truncate("abc", 2), "ab");
});
