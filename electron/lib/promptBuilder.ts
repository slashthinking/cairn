// Prompt + JSON-schema construction for the local `claude` CLI.
//
// We use `claude -p --output-format json --json-schema <schema>` which:
//   1. Runs claude non-interactively with our prompt as the user message
//   2. Forces the model to emit JSON conforming to the schema
//   3. Returns a wrapper object with `result` (string) and `structured_output` (parsed)

export interface RenamePayload {
  kind: "project" | "session";
  context: string;
}

export interface ClusterPayload {
  workspace: string;
  projects: { id: string; name: string; firstPrompts: string[] }[];
}

export interface Suggestion {
  name: string;
  reasoning: string;
}

export interface SuggestionsResponse {
  suggestions: Suggestion[];
}

export interface ClusterResponse {
  clusters: { name: string; projectIds: string[] }[];
}

/* ─────────────────────────────────────────────
 * Wrappers around `claude -p`
 * ───────────────────────────────────────────── */

/**
 * The shape of `claude -p --output-format json` stdout.
 * `result` is the raw model text. `structured_output` exists when --json-schema was set.
 */
export interface ClaudeWrapper {
  type: "result";
  subtype: string;
  is_error: boolean;
  result: string;
  session_id: string;
  total_cost_usd?: number;
  structured_output?: unknown;
  duration_ms?: number;
}

/**
 * Extract structured payload from a claude -p wrapper.
 * Prefer `structured_output` (set when --json-schema was used).
 * Fall back to JSON-parsing `.result` (when prompt asked for JSON inline).
 * Final fallback: regex-extract the first {…} block from `.result`.
 */
export function extractStructured<T = unknown>(wrapper: unknown): T {
  if (!wrapper || typeof wrapper !== "object") {
    throw new Error("claude wrapper is not an object");
  }
  const w = wrapper as ClaudeWrapper;
  if (w.is_error) {
    throw new Error(`claude reported error: ${w.result}`);
  }
  if (w.structured_output !== undefined) {
    return w.structured_output as T;
  }
  if (typeof w.result === "string") {
    return parseLooseJson<T>(w.result);
  }
  throw new Error("claude wrapper has neither structured_output nor result");
}

/** Parse JSON from a string that may contain prose around the JSON block. */
export function parseLooseJson<T>(s: string): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    /* fall through */
  }
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`claude output is not valid JSON: ${s.slice(0, 200)}…`);
  }
  return JSON.parse(s.slice(start, end + 1)) as T;
}

/* ─────────────────────────────────────────────
 * Schemas
 * ───────────────────────────────────────────── */

export const SCHEMA_RENAME = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      minItems: 4,
      maxItems: 4,
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          reasoning: { type: "string" },
        },
        required: ["name", "reasoning"],
      },
    },
  },
  required: ["suggestions"],
} as const;

export const SCHEMA_CLUSTERS = {
  type: "object",
  properties: {
    clusters: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          projectIds: { type: "array", items: { type: "string" } },
        },
        required: ["name", "projectIds"],
      },
    },
  },
  required: ["clusters"],
} as const;

/* ─────────────────────────────────────────────
 * Prompt builders
 * ───────────────────────────────────────────── */

export function buildRenamePrompt(p: RenamePayload): string {
  const constraints =
    p.kind === "project"
      ? "Folder names: ≤32 chars, [a-z0-9_-] only, expresses domain/purpose not implementation. At least one keeps original style, one re-conceptualizes."
      : "Session titles: ≤60 chars, natural phrase, captures the goal. At least one keeps original wording, one re-conceptualizes.";
  return `Suggest exactly 4 ${p.kind === "project" ? "folder names" : "session titles"}.

${constraints}

Context:
${p.context}`;
}

export function buildClusterPrompt(p: ClusterPayload): string {
  const projectsList = p.projects
    .map((proj, i) => {
      const prompts = proj.firstPrompts.slice(0, 3).join(" | ");
      return `${i + 1}. id=${proj.id} name=${proj.name}\n   prompts: ${prompts}`;
    })
    .join("\n");
  return `Group these projects in workspace \`${p.workspace}\` into 3-6 semantic clusters by what each project does (billing, auth, tooling, experiments, etc.).

Each project belongs to exactly one cluster. Use only these project IDs in your output (preserve casing). Do NOT include emoji or other decorative characters in the cluster name — short plain text labels only.

Projects:
${projectsList}`;
}

/* ─────────────────────────────────────────────
 * IPC payload validators
 * ───────────────────────────────────────────── */

export function validateRename(p: unknown): RenamePayload {
  if (!p || typeof p !== "object") throw new Error("invalid payload");
  const o = p as Record<string, unknown>;
  if (o.kind !== "project" && o.kind !== "session") {
    throw new Error('kind must be "project" or "session"');
  }
  if (typeof o.context !== "string" || o.context.length === 0) {
    throw new Error("context must be non-empty string");
  }
  if (o.context.length > 50_000) {
    throw new Error("context too large (>50KB)");
  }
  return { kind: o.kind, context: o.context };
}

export function validateCluster(p: unknown): ClusterPayload {
  if (!p || typeof p !== "object") throw new Error("invalid payload");
  const o = p as Record<string, unknown>;
  if (typeof o.workspace !== "string" || o.workspace.length === 0) {
    throw new Error("workspace required");
  }
  if (!Array.isArray(o.projects) || o.projects.length === 0) {
    throw new Error("projects must be non-empty array");
  }
  for (const proj of o.projects) {
    if (
      !proj ||
      typeof (proj as any).id !== "string" ||
      typeof (proj as any).name !== "string" ||
      !Array.isArray((proj as any).firstPrompts)
    ) {
      throw new Error("invalid project shape");
    }
  }
  return o as unknown as ClusterPayload;
}
