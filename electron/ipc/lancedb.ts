// Hybrid search — fully Rust under the hood:
//   - LanceDB (Rust core via NAPI): BM25 (Tantivy) + dense vectors + RRF
//   - cairn-embed (Rust core via NAPI, in native-embed/): fastembed-rs
//     with the candle backend running Qwen/Qwen3-Embedding-0.6B
//
// Both NAPI modules link directly into the Electron main process. No
// Python, no daemon, no subprocesses. Model weights live in
// ~/.cache/huggingface/ after first launch (resolved through HF_ENDPOINT
// if set — defaults to huggingface.co).
//
// Storage:
//   ~/.claude/cairn/lancedb/                — Lance database root
//                          /sessions.lance  — single table with FTS + vec
//                          /_meta.json      — model + dim + builtAt
//
// IPC handles:
//   lancedb:rebuild  — embeds every session in one batch, rewrites table,
//                      builds FTS (tantivy) + ANN (when ≥256 rows)
//   lancedb:search   — embeds the query string, hybrid via RRF (k=60)
//   lancedb:status   — last rebuild timestamp, row count, model
//   lancedb:clear    — drop the table

import { ipcMain, app } from "electron";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import * as lancedb from "@lancedb/lancedb";
import { Index, rerankers } from "@lancedb/lancedb";
import type { VectorQuery } from "@lancedb/lancedb";

const DEFAULT_MODEL = "Qwen/Qwen3-Embedding-0.6B";
const TABLE = "sessions";

// Native embedder — fastembed-rs (candle backend) compiled to a NAPI
// .node module in native-embed/. Loaded once on first call; the model
// stays resident in the Electron main process until the user quits.
interface NativeEmbed {
  embedQuery: (text: string) => Promise<number[]>;
  embedBatch: (texts: string[]) => Promise<number[]>;
  warmup: () => Promise<number>;
  /** Jieba CJK tokenization — returns space-joined tokens. */
  tokenize: (text: string) => string;
  tokenizeBatch: (texts: string[]) => string[];
}
const nativeRequire = createRequire(__filename);
let native: NativeEmbed | null = null;
function getNative(): NativeEmbed {
  if (!native) {
    const loaderPath = join(
      app.getAppPath(),
      "native-embed",
      "loader.cjs",
    );
    native = nativeRequire(loaderPath) as NativeEmbed;
  }
  return native;
}

function dbDir(): string {
  return join(app.getPath("home"), ".claude", "cairn", "lancedb");
}

function metaPath(): string {
  return join(dbDir(), "_meta.json");
}

interface Meta {
  model: string;
  dim: number;
  builtAt: number;
  count: number;
  /** sessionId → djb2 hash of indexed text. Used for incremental rebuild. */
  entries?: Record<string, string>;
}

/** Tiny stable hash so we can detect content changes between rebuilds. */
function djb2(s: string): string {
  let h = 5381 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  }
  return h.toString(16);
}

async function readMeta(): Promise<Meta | null> {
  try {
    const raw = await fs.readFile(metaPath(), "utf-8");
    return JSON.parse(raw) as Meta;
  } catch {
    return null;
  }
}

async function writeMeta(m: Meta): Promise<void> {
  await fs.mkdir(dbDir(), { recursive: true });
  await fs.writeFile(metaPath(), JSON.stringify(m, null, 2));
}

/**
 * Batch-embed all session texts via the in-process NAPI module.
 * Output is `[count, dim, ...flat_floats]` — we reshape into per-row
 * Float32Arrays.
 */
async function embedBatch(texts: string[]): Promise<Float32Array[] | null> {
  if (texts.length === 0) return [];
  try {
    const flat = await getNative().embedBatch(texts);
    if (flat.length < 2) return [];
    const count = Math.round(flat[0]!);
    const dim = Math.round(flat[1]!);
    const out: Float32Array[] = [];
    for (let i = 0; i < count; i++) {
      const base = 2 + i * dim;
      const arr = new Float32Array(dim);
      for (let j = 0; j < dim; j++) arr[j] = flat[base + j]!;
      out.push(arr);
    }
    return out;
  } catch (err) {
    console.error("[embedBatch] native call failed:", err);
    return null;
  }
}

/**
 * Embed a single query — single round-trip into NAPI. Warm latency on
 * M-series with candle Metal: ~100ms-1s.
 */
async function embedQuery(text: string): Promise<Float32Array | null> {
  try {
    const arr = await getNative().embedQuery(text);
    return Float32Array.from(arr);
  } catch (err) {
    console.error("[embedQuery] native call failed:", err);
    return null;
  }
}

interface RebuildItem {
  sessionId: string;
  text: string;
  projectPath: string | null;
  lastActive: number;
}

interface RebuildInput {
  items: RebuildItem[];
  model?: string;
}

interface RebuildResult {
  embedded: number;
  reused: number;
  removed: number;
  errors: number;
  ok: boolean;
  message?: string;
}

async function rebuild(input: RebuildInput): Promise<RebuildResult> {
  const model = input.model ?? DEFAULT_MODEL;
  await fs.mkdir(dbDir(), { recursive: true });

  const items = input.items.filter((it) => it.text.trim().length > 0);
  if (items.length === 0) {
    return { embedded: 0, reused: 0, removed: 0, errors: 0, ok: true };
  }

  // ── Incremental diff against the previous build ────────────────────────
  // Only sessions whose `text` (title + content + meta) hashed-changes
  // since last rebuild need re-embedding. Unchanged rows stay put;
  // missing rows get deleted.
  const prevMeta = await readMeta();
  const prevEntries = prevMeta?.entries ?? {};
  const prevModelChanged =
    !prevMeta || prevMeta.model !== model || !prevMeta.entries;

  const newEntries: Record<string, string> = {};
  const toEmbed: RebuildItem[] = [];
  for (const it of items) {
    const h = djb2(it.text);
    newEntries[it.sessionId] = h;
    if (prevModelChanged || prevEntries[it.sessionId] !== h) {
      toEmbed.push(it);
    }
  }
  const liveIds = new Set(items.map((i) => i.sessionId));
  const removedIds = Object.keys(prevEntries).filter((id) => !liveIds.has(id));

  // ── Embed only the changed/new ones ────────────────────────────────────
  let vectors: Float32Array[] = [];
  if (toEmbed.length > 0) {
    const v = await embedBatch(toEmbed.map((i) => i.text));
    if (!v) {
      return {
        embedded: 0,
        reused: 0,
        removed: 0,
        errors: 0,
        ok: false,
        message: "Native embedder failed — is native-embed built?",
      };
    }
    vectors = v;
  }
  const dim = vectors[0]?.length ?? prevMeta?.dim ?? 0;
  if (toEmbed.length > 0 && dim === 0) {
    return {
      embedded: 0,
      reused: 0,
      removed: 0,
      errors: 0,
      ok: false,
      message: "Empty vectors",
    };
  }

  const tokenized =
    toEmbed.length > 0
      ? getNative().tokenizeBatch(toEmbed.map((i) => i.text))
      : [];
  const rowsToUpsert = toEmbed.map((it, idx) => ({
    sessionId: it.sessionId,
    text: it.text,
    textIndexed: tokenized[idx] ?? it.text,
    projectPath: it.projectPath ?? "",
    lastActive: it.lastActive,
    vector: Array.from(vectors[idx]!),
  }));

  const conn = await lancedb.connect(dbDir());
  const existed = (await conn.tableNames()).includes(TABLE);

  // ── First-time / model change: drop and recreate ───────────────────────
  if (!existed || prevModelChanged) {
    if (existed) await conn.dropTable(TABLE);
    if (rowsToUpsert.length === 0) {
      // Should not happen, but guard.
      await writeMeta({
        model,
        dim,
        builtAt: Date.now(),
        count: 0,
        entries: newEntries,
      });
      return { embedded: 0, reused: 0, removed: 0, errors: 0, ok: true };
    }
    const t = await conn.createTable(TABLE, rowsToUpsert);
    await t.createIndex("textIndexed", {
      config: Index.fts({
        baseTokenizer: "simple",
        lowercase: true,
        asciiFolding: true,
      }),
    });
    if (rowsToUpsert.length >= 256) {
      await t.createIndex("vector");
    }
    await writeMeta({
      model,
      dim,
      builtAt: Date.now(),
      count: rowsToUpsert.length,
      entries: newEntries,
    });
    return {
      embedded: rowsToUpsert.length,
      reused: 0,
      removed: 0,
      errors: 0,
      ok: true,
    };
  }

  // ── Incremental: upsert changed, delete removed ────────────────────────
  const table = await conn.openTable(TABLE);
  if (rowsToUpsert.length > 0) {
    await table
      .mergeInsert("sessionId")
      .whenMatchedUpdateAll()
      .whenNotMatchedInsertAll()
      .execute(rowsToUpsert);
  }
  if (removedIds.length > 0) {
    // Build a SQL IN list. Lance accepts string predicates over columns.
    const quoted = removedIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(",");
    await table.delete(`sessionId IN (${quoted})`);
  }
  // FTS/vector indexes don't need rebuilding for delta updates — Lance
  // handles row-level inserts/deletes against existing indexes.

  await writeMeta({
    model,
    dim,
    builtAt: Date.now(),
    count: items.length,
    entries: newEntries,
  });

  return {
    embedded: rowsToUpsert.length,
    reused: items.length - rowsToUpsert.length,
    removed: removedIds.length,
    errors: 0,
    ok: true,
  };
}

interface SearchInput {
  query: string;
  topK?: number;
  model?: string;
}

interface SearchHit {
  sessionId: string;
  score: number;
}

async function search(input: SearchInput): Promise<SearchHit[]> {
  const meta = await readMeta();
  if (!meta) return [];

  const topK = input.topK ?? 50;
  const queryVec = await embedQuery(input.query);
  if (!queryVec) return [];

  const conn = await lancedb.connect(dbDir());
  if (!(await conn.tableNames()).includes(TABLE)) return [];
  const table = await conn.openTable(TABLE);

  // Hybrid: vector-first query with full-text-search overlay, fused with
  // RRF (k=60). LanceDB runs both retrievers natively and returns one
  // ranked stream. `table.search(vec)` returns VectorQuery — we narrow
  // the type so .rerank is accessible.
  // Pre-tokenize the query the same way as indexed text so jieba splits
  // align: "前端组件库" → "前端 组件 库" → tantivy matches each word.
  const queryTokenized = getNative().tokenize(input.query);

  const reranker = await rerankers.RRFReranker.create(60);
  const result = await (table.search(Array.from(queryVec)) as VectorQuery)
    .fullTextSearch(queryTokenized, { columns: ["textIndexed"] })
    .rerank(reranker)
    .limit(topK)
    .toArray();

  return (result as Array<Record<string, unknown>>).map((row) => ({
    sessionId: String(row.sessionId),
    // Lance exposes `_relevance_score` after rerank.
    score: typeof row._relevance_score === "number" ? row._relevance_score : 0,
    // Send the original (un-tokenized) text so the renderer can show a
    // matched snippet in the result row — otherwise users see only the
    // session title and can't tell why a result surfaced.
    text: typeof row.text === "string" ? row.text : "",
  }));
}

interface StatusResult {
  ready: boolean;
  model: string;
  count: number;
  builtAt: number | null;
  ageMs: number | null;
  dim: number | null;
}

async function status(): Promise<StatusResult> {
  const meta = await readMeta();
  if (!meta) {
    return {
      ready: false,
      model: DEFAULT_MODEL,
      count: 0,
      builtAt: null,
      ageMs: null,
      dim: null,
    };
  }
  return {
    ready: true,
    model: meta.model,
    count: meta.count,
    builtAt: meta.builtAt,
    ageMs: Date.now() - meta.builtAt,
    dim: meta.dim,
  };
}

async function clearAll(): Promise<void> {
  try {
    await fs.rm(dbDir(), { recursive: true, force: true });
  } catch {
    // Ignore.
  }
}

// SAFETY KILL-SWITCH: when true, the native embedder is never touched.
// Search falls back to lexical only. Set CAIRN_VECTOR=1 in the env to
// re-enable. Reason: cairn-embed currently SIGTRAP-aborts the Electron
// main process on some setups (likely model init / Metal device race),
// and a panic in any tokio worker takes the whole app down before JS
// can catch.
const VECTOR_DISABLED = process.env.CAIRN_VECTOR !== "1";

export function registerLancedbIpc(): void {
  ipcMain.handle("lancedb:rebuild", (_e, p: RebuildInput) => {
    if (VECTOR_DISABLED) {
      return {
        embedded: 0,
        reused: 0,
        removed: 0,
        errors: 0,
        ok: false,
        message:
          "Vector index disabled in this build (set CAIRN_VECTOR=1 to enable).",
      } satisfies RebuildResult;
    }
    return rebuild(p);
  });
  ipcMain.handle("lancedb:search", (_e, p: SearchInput) => {
    if (VECTOR_DISABLED) return [] as SearchHit[];
    return search(p);
  });
  ipcMain.handle("lancedb:status", () => {
    if (VECTOR_DISABLED) {
      return {
        ready: false,
        model: DEFAULT_MODEL,
        count: 0,
        builtAt: null,
        ageMs: null,
        dim: null,
      } satisfies StatusResult;
    }
    return status();
  });
  ipcMain.handle("lancedb:clear", () => clearAll());
}
