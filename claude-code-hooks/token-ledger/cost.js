import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const prices = JSON.parse(readFileSync(join(__dirname, "prices.json"), "utf8"));

export function normalizeModelName(name) {
  if (!name) return name;
  // Anthropic returns names like "claude-opus-4-7-20251201"; strip date suffix.
  return name.replace(/-\d{8}$/, "").replace(/\[.*\]$/, "");
}

export function costUsd(model, usage) {
  const key = normalizeModelName(model);
  const p = prices[key];
  if (!p) return null;
  const t = usage ?? {};
  const inp = t.input_tokens ?? 0;
  const out = t.output_tokens ?? 0;
  // Anthropic's API uses these names; our schema renames them.
  const cr  = t.cache_read_input_tokens     ?? t.cache_read_tokens     ?? 0;
  const cc  = t.cache_creation_input_tokens ?? t.cache_creation_tokens ?? 0;
  return (inp * p.in + out * p.out + cr * p.cache_read + cc * p.cache_create) / 1_000_000;
}

export function knownModels() {
  return Object.keys(prices).filter(k => !k.startsWith("_"));
}
