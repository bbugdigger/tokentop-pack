// Pure parser for Claude Code transcript JSONL.
// Given a chunk of bytes (from a known offset onwards), returns:
//   - usage records found (one per assistant entry)
//   - byte offset of the last complete line consumed
// "Complete line" = ends with \n. Trailing partial line is left for next call.

export function parseTranscriptChunk(chunk, startOffset = 0) {
  const usages = [];
  let consumed = 0;
  let i = 0;
  while (i < chunk.length) {
    const nl = chunk.indexOf("\n", i);
    if (nl === -1) break;
    const line = chunk.slice(i, nl);
    consumed = nl + 1;
    i = nl + 1;
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry?.type !== "assistant") continue;
    const msg = entry.message;
    if (!msg || !msg.usage) continue;
    usages.push({
      ts: entry.timestamp ?? new Date().toISOString(),
      model: msg.model ?? "unknown",
      usage: msg.usage,
    });
  }
  return { usages, consumedTo: startOffset + consumed };
}
