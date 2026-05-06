// Channel-isolation smoke. Runs three queries side-by-side so you can
// see what each retrieval channel pulls before the RRF fusion.
//
// Usage:
//   bun scripts/test-channels.ts "your query"
//   bun scripts/test-channels.ts "前端组件库"      # pure semantic (no English tokens)
//   bun scripts/test-channels.ts "asfqwz123"        # pure noise (should be empty / random)
//   bun scripts/test-channels.ts "design"           # both channels match strongly

import { join } from "node:path";
import { homedir } from "node:os";
import * as lancedb from "@lancedb/lancedb";
import { rerankers } from "@lancedb/lancedb";
import type { VectorQuery } from "@lancedb/lancedb";
import { createRequire } from "node:module";

const r = createRequire(import.meta.url);
const native = r("../native-embed/loader.cjs") as {
  embedQuery: (t: string) => Promise<number[]>;
  warmup: () => Promise<number>;
  tokenize: (t: string) => string;
};

const dbDir = join(homedir(), ".claude", "cairn", "lancedb");
const query = process.argv[2] ?? "design";

await native.warmup();
const conn = await lancedb.connect(dbDir);
const table = await conn.openTable("sessions");

const vec = await native.embedQuery(query);
const tokens = native.tokenize(query);
console.log(`[t] jieba tokens: ${JSON.stringify(tokens)}`);

// 1) PURE VECTOR — no fullTextSearch chained.
const vOnly = await (table.search(vec) as VectorQuery).limit(5).toArray();

// 2) PURE BM25 on the jieba-pre-tokenized field.
const fOnly = await table
  .search(tokens, "fts" as never, ["textIndexed"])
  .limit(5)
  .toArray();

// 3) HYBRID — both channels + RRF fusion.
const reranker = await rerankers.RRFReranker.create(60);
const hybrid = await (table.search(vec) as VectorQuery)
  .fullTextSearch(tokens, { columns: ["textIndexed"] })
  .rerank(reranker)
  .limit(5)
  .toArray();

function show(label: string, rows: unknown[], scoreKey: string) {
  console.log(`\n── ${label} ──`);
  if (rows.length === 0) {
    console.log("  (no results)");
    return;
  }
  for (const row of rows as Array<Record<string, unknown>>) {
    const s = row[scoreKey];
    const sStr = typeof s === "number" ? s.toFixed(4) : "—";
    const text = (row.text as string | undefined)?.slice(0, 70) ?? "";
    console.log(`  ${sStr}  ${text}`);
  }
}

console.log(`Query: ${JSON.stringify(query)}`);
show("VECTOR ONLY (cosine distance, lower = closer)", vOnly, "_distance");
show("BM25 ONLY (relevance, higher = better)", fOnly, "_score");
show("HYBRID (RRF, higher = better)", hybrid, "_relevance_score");
