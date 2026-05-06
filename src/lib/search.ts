// Pure-JS hybrid search — no persistent process, no external service.
//
// "Hybrid" here means: lexical scoring (multi-field, prefix/substring,
// token-aware) blended with recency. It runs entirely in the renderer on
// the same data structures the dashboard already holds in memory.
//
// Why this shape:
//   - User explicitly said no continuously-running vector DB and to keep it
//     low-resource. So embeddings + ANN index are out.
//   - Multi-field scoring + recency gives semantic-feeling results for the
//     scale of data Cairn handles (hundreds to low thousands of sessions).
//   - For deeper semantic recall, a future opt-in step can compute MiniLM
//     embeddings on disk and merge cosine sim into the score blow — see
//     `mergeWithVector()` for the integration point.

import type { AllSession } from "../types/cairn-api";

export type SearchHit =
  | {
      kind: "session";
      score: number;
      session: AllSession;
      /** Indexed text from the vector backend — used as snippet when the
          session title doesn't already contain the query. */
      snippet?: string;
    }
  | {
      kind: "project";
      score: number;
      path: string;
      name: string;
      sessionCount: number;
      workspacePath: string;
    }
  | { kind: "workspace"; score: number; path: string; name: string };

interface Inputs {
  query: string;
  sessions: AllSession[];
  workspaces: string[];
  projectsByWorkspace: Record<
    string,
    { path: string; name: string; sessionCount: number }[]
  >;
  /** Optional precomputed semantic scores (sessionId → 0..1). Empty ok. */
  vector?: Map<string, number>;
  /** Optional snippet text from the vector backend (sessionId → text). */
  vectorText?: Map<string, string>;
}

export function searchAll({
  query,
  sessions,
  workspaces,
  projectsByWorkspace,
  vector,
  vectorText,
}: Inputs): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const tokens = q.split(/\s+/).filter((t) => t.length > 0);

  const hits: SearchHit[] = [];

  // ── Sessions ────────────────────────────────────────────────────────────
  for (const s of sessions) {
    if (s.kind === "subagent" && !shouldIncludeSubagents(q)) continue;
    const fields: ScoredField[] = [
      { val: s.customTitle, weight: 4.0 },
      { val: s.activeName, weight: 3.5 },
      { val: s.title, weight: 2.8 },
      { val: lastSegment(s.dominantCwd), weight: 1.8 },
      { val: lastSegment(s.launchedFrom), weight: 1.2 },
      { val: s.gitBranch, weight: 2.0 },
      { val: s.model, weight: 0.6 },
    ];
    let score = scoreFields(fields, tokens);
    // Vector merge BEFORE the zero-cutoff: a session that only matches
    // via embedding (e.g. Chinese query against English fields) must
    // still surface. Only drop when both channels say nothing.
    const vec = vector?.get(s.id);
    if (vec !== undefined) score += vec * 2.0;
    if (score === 0) continue;
    score += recencyBoost(s.lastActive);
    hits.push({
      kind: "session",
      session: s,
      score,
      snippet: vectorText?.get(s.id),
    });
  }

  // ── Projects ────────────────────────────────────────────────────────────
  for (const ws of workspaces) {
    const projects = projectsByWorkspace[ws] ?? [];
    for (const p of projects) {
      const fields: ScoredField[] = [
        { val: p.name, weight: 3.5 },
        { val: lastSegment(p.path), weight: 2.0 },
      ];
      const score = scoreFields(fields, tokens);
      if (score === 0) continue;
      hits.push({
        kind: "project",
        score,
        path: p.path,
        name: p.name,
        sessionCount: p.sessionCount,
        workspacePath: ws,
      });
    }
  }

  // ── Workspaces ──────────────────────────────────────────────────────────
  for (const ws of workspaces) {
    const name = lastSegment(ws);
    const score = scoreFields(
      [
        { val: name, weight: 3.0 },
        { val: ws, weight: 1.5 },
      ],
      tokens,
    );
    if (score === 0) continue;
    hits.push({ kind: "workspace", score, path: ws, name: name ?? ws });
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, 25);
}

interface ScoredField {
  val: string | null;
  weight: number;
}

function scoreFields(fields: ScoredField[], tokens: string[]): number {
  let total = 0;
  for (const f of fields) {
    if (!f.val) continue;
    const v = f.val.toLowerCase();
    for (const t of tokens) {
      if (v === t) total += f.weight * 4; // exact field match
      else if (v.startsWith(t)) total += f.weight * 2.5; // prefix
      else if (containsWord(v, t)) total += f.weight * 1.6; // word boundary
      else if (v.includes(t)) total += f.weight; // substring
    }
  }
  return total;
}

function containsWord(haystack: string, needle: string): boolean {
  // Word boundary on letter/digit ↔ non-letter/digit transitions.
  const idx = haystack.indexOf(needle);
  if (idx < 0) return false;
  const before = idx === 0 ? "" : haystack[idx - 1]!;
  const after =
    idx + needle.length >= haystack.length ? "" : haystack[idx + needle.length]!;
  return !isWordChar(before) && !isWordChar(after);
}

function isWordChar(c: string): boolean {
  return /[a-z0-9]/i.test(c);
}

function recencyBoost(lastActive: number): number {
  if (!lastActive) return 0;
  const ageDays = (Date.now() - lastActive) / (1000 * 60 * 60 * 24);
  // Log decay: 0d → ~3, 1d → ~2, 7d → ~1, 30d → ~0.4, 365d → ~0.05
  return Math.max(0, 3 - Math.log2(ageDays + 1) * 0.6);
}

function lastSegment(p: string | null): string | null {
  if (!p) return null;
  const trimmed = p.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

function shouldIncludeSubagents(q: string): boolean {
  // Only include subagent ghosts when the user explicitly searches for them
  // — they pollute results for normal queries.
  return q.includes("subagent") || q.includes("agent-");
}

/**
 * Future hook: merge a semantic similarity map into the scoring above.
 *
 * Implementation plan when added (so this stays low-resource):
 *   1. On idle (after dashboard renders), compute TF-IDF or MiniLM
 *      embeddings for each session's customTitle + title + first prompt.
 *   2. Persist the embeddings to ~/.cairn/embeddings.bin (one float32
 *      array per session, keyed by id) so we don't recompute on relaunch.
 *   3. On query, embed the query string, compute cosine similarity vs the
 *      cached vectors in a single pass (no kNN index needed at this scale).
 *   4. Pass the resulting `Map<sessionId, similarity>` as the `vector`
 *      parameter to searchAll() — the existing scoring already blends it.
 *
 * Until then this is a no-op so the call site stays stable.
 */
export function emptyVectorMap(): Map<string, number> {
  return new Map();
}
