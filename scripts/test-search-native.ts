// End-to-end smoke for the native embedder + LanceDB hybrid pipeline.
// Mirrors what the IPC handler does at search-time.

import { join } from "node:path";
import { homedir } from "node:os";
import * as lancedb from "@lancedb/lancedb";
import { rerankers } from "@lancedb/lancedb";
import type { VectorQuery } from "@lancedb/lancedb";

// Direct .node load — same way electron main does it.
import { createRequire } from "node:module";
const r = createRequire(import.meta.url);
const native = r(
  "../native-embed/loader.cjs",
) as {
  embedQuery: (t: string) => Promise<number[]>;
  warmup: () => Promise<number>;
};

const dbDir = join(homedir(), ".claude", "cairn", "lancedb");
const queries = process.argv.slice(2);
if (queries.length === 0) queries.push("design system component library");

console.log("[t] warming up model…");
const tw = Date.now();
await native.warmup();
console.log(`[t] warmup ${Date.now() - tw}ms`);

const conn = await lancedb.connect(dbDir);
const table = await conn.openTable("sessions");
const reranker = await rerankers.RRFReranker.create(60);

for (const q of queries) {
  const t0 = Date.now();
  const v = await native.embedQuery(q);
  const tEmbed = Date.now() - t0;
  const t1 = Date.now();
  const result = await (table.search(v) as VectorQuery)
    .fullTextSearch(q, { columns: ["text"] })
    .rerank(reranker)
    .limit(5)
    .toArray();
  const tSearch = Date.now() - t1;
  console.log(
    `\n[q] ${JSON.stringify(q)} — embed ${tEmbed}ms · search ${tSearch}ms`,
  );
  for (const row of result as Array<Record<string, unknown>>) {
    const score = (row._relevance_score as number)?.toFixed(4) ?? "—";
    console.log(`  ${score}  ${(row.text as string).slice(0, 70)}`);
  }
}
