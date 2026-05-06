// Pure functions for parsing Claude Code jsonl session files (PRD §4.2).
// Verified against real ~/.claude/projects/<encoded>/*.jsonl on 2026-04-26.
//
// Two storage schemas coexist:
//   - "flat":   ~/.claude/projects/<encoded>/<uuid>.jsonl   (older single-file)
//   - "nested": ~/.claude/projects/<encoded>/<uuid>/subagents/agent-*.jsonl
//               + metadata in ~/.claude/usage-data/session-meta/<uuid>.json

export interface ParsedSession {
  title: string | null;
  startedAt: number;
  lastActive: number;
  messageCount: number;
  model: string | null;
  gitBranch: string | null;
  cwd: string | null;
  /**
   * If this session was created via `claude --resume <id> --fork-session`,
   * the first message carries `forkedFrom: { sessionId, messageUuid }`
   * pointing back at the parent + the message it diverged from. Null for
   * top-level sessions.
   */
  forkedFrom: { sessionId: string; messageUuid: string } | null;
}

/**
 * Enriched parse result. Adds `customTitle` (from `--name`, written as a
 * metadata line in the JSONL tail) and a dominant-cwd histogram so the UI
 * can detect Claude Code's mid-session `cd` drift: a session launched in
 * /Users/foo but doing all its work in /Users/foo/sub/proj will be filed
 * under the launch path on disk, but should be displayed under the dominant
 * cwd for the user.
 */
export interface EnrichedSession extends ParsedSession {
  customTitle: string | null;
  dominantCwd: string | null;
  /** All distinct cwds seen, with how many message lines mentioned each. */
  cwdHistogram: { cwd: string; count: number }[];
}

/**
 * Shape of the per-session metadata file at
 * ~/.claude/usage-data/session-meta/<uuid>.json. Only the fields we use are
 * declared — claude writes more, but we don't depend on them.
 */
export interface SessionMetaJson {
  session_id?: string;
  project_path?: string;
  start_time?: string;
  duration_minutes?: number;
  user_message_count?: number;
  assistant_message_count?: number;
  first_prompt?: string;
  user_message_timestamps?: string[];
}

/**
 * Parse a `~/.claude/usage-data/session-meta/<uuid>.json` blob into the same
 * Session shape we expose to the renderer. Returns null if the blob is
 * unrecognizable.
 *
 * `model` and `gitBranch` are not in the meta file — caller can backfill from
 * any agent jsonl in the matching session dir if it cares.
 */
export function parseSessionMeta(meta: unknown): ParsedSession | null {
  if (!meta || typeof meta !== "object") return null;
  const m = meta as SessionMetaJson;
  const startedAt = m.start_time ? Date.parse(m.start_time) : 0;
  if (Number.isNaN(startedAt) || startedAt === 0) return null;

  const stamps = Array.isArray(m.user_message_timestamps)
    ? m.user_message_timestamps
    : [];
  let lastActive = startedAt;
  // The last user_message_timestamp is a lower bound on lastActive. If
  // duration_minutes is bigger, prefer that since the assistant may have kept
  // working past the last user message.
  if (stamps.length > 0) {
    const t = Date.parse(stamps[stamps.length - 1]!);
    if (!Number.isNaN(t)) lastActive = Math.max(lastActive, t);
  }
  if (typeof m.duration_minutes === "number" && m.duration_minutes > 0) {
    lastActive = Math.max(lastActive, startedAt + m.duration_minutes * 60_000);
  }

  const userCount =
    typeof m.user_message_count === "number" ? m.user_message_count : 0;
  const assistantCount =
    typeof m.assistant_message_count === "number"
      ? m.assistant_message_count
      : 0;

  return {
    title:
      typeof m.first_prompt === "string"
        ? m.first_prompt.trim().slice(0, 60) || null
        : null,
    startedAt,
    lastActive,
    messageCount: userCount + assistantCount,
    model: null,
    gitBranch: null,
    cwd: typeof m.project_path === "string" ? m.project_path : null,
    // usage-data meta doesn't carry fork info; the only way to detect a
    // fork from meta alone would be to walk every other meta and look for
    // matching sessionIds — not worth it. Forks show up via parseSessionContent.
    forkedFrom: null,
  };
}

const MESSAGE_TYPES = new Set([
  "user",
  "assistant",
  "tool_use",
  "tool_result",
]);

/**
 * Parse jsonl content into derived session metadata.
 * - Skips non-message envelope types (permission-mode, file-history-snapshot, etc.)
 * - Tolerates malformed lines (skips them)
 * - Uses `cwd` from any message line as authoritative project path
 */
export function parseSessionContent(jsonl: string): ParsedSession {
  let startedAt = 0;
  let lastActive = 0;
  let title: string | null = null;
  let model: string | null = null;
  let gitBranch: string | null = null;
  let cwd: string | null = null;
  let messageCount = 0;
  let forkedFrom: ParsedSession["forkedFrom"] = null;

  for (const line of jsonl.split("\n")) {
    if (!line) continue;
    let v: any;
    try {
      v = JSON.parse(line);
    } catch {
      continue;
    }

    // Capture cwd from any line
    if (!cwd && typeof v.cwd === "string") cwd = v.cwd;
    if (!gitBranch && typeof v.gitBranch === "string") gitBranch = v.gitBranch;
    // forkedFrom is stamped on the very first record of a forked session.
    // Capture once — we only care about the first occurrence.
    if (!forkedFrom && v.forkedFrom &&
      typeof v.forkedFrom.sessionId === "string" &&
      typeof v.forkedFrom.messageUuid === "string") {
      forkedFrom = {
        sessionId: v.forkedFrom.sessionId,
        messageUuid: v.forkedFrom.messageUuid,
      };
    }

    // Skip non-message envelope rows for the message stats
    if (!MESSAGE_TYPES.has(v.type)) continue;
    messageCount++;

    if (typeof v.timestamp === "string") {
      const t = Date.parse(v.timestamp);
      if (!Number.isNaN(t)) {
        if (startedAt === 0) startedAt = t;
        lastActive = t;
      }
    }

    if (!title && v.type === "user") {
      title = stripToolResultPreamble(extractText(v.message?.content))?.slice(0, 60) ?? null;
    }
    if (!model && typeof v.message?.model === "string") {
      model = v.message.model;
    }
  }

  return {
    title,
    startedAt,
    lastActive,
    messageCount,
    model,
    gitBranch,
    cwd,
    forkedFrom,
  };
}

/**
 * Read up to `headBytes` from the start and `tailBytes` from the end of a
 * file, joined with a newline so split-based parsers still see line breaks.
 * For files smaller than `headBytes + tailBytes`, returns the whole file.
 *
 * Why: Claude session JSONLs can be 50-80MB. Loading them whole into V8 to
 * scan for customTitle/startedAt/cwd locks the main process for seconds and
 * pegs RSS. Claude CLI's own `readSessionLite` does the same head+tail trick
 * (LITE_READ_BUF_SIZE=65536 on each side) — we use generous bounds since the
 * caller wants enough content to compute a cwd histogram, not just metadata.
 */
export function readJsonlSampled(
  filePath: string,
  fileSize: number,
  headBytes = 1 << 20, // 1 MiB
  tailBytes = 1 << 18, // 256 KiB
): string {
  // Lazy require — only the IPC layer should reach this fn, never tests.
  const { openSync, readSync, closeSync, readFileSync } =
    require("node:fs") as typeof import("node:fs");
  if (fileSize <= headBytes + tailBytes) {
    return readFileSync(filePath, "utf8");
  }
  const fd = openSync(filePath, "r");
  try {
    let headStr = "";
    if (headBytes > 0) {
      const head = Buffer.alloc(headBytes);
      readSync(fd, head, 0, headBytes, 0);
      headStr = head.toString("utf8");
    }
    let tailStr = "";
    if (tailBytes > 0) {
      const tail = Buffer.alloc(tailBytes);
      readSync(fd, tail, 0, tailBytes, fileSize - tailBytes);
      tailStr = tail.toString("utf8");
    }
    if (headStr && tailStr) return headStr + "\n" + tailStr;
    return headStr || tailStr;
  } finally {
    closeSync(fd);
  }
}

/**
 * Same as parseSessionContent, plus tracks every cwd seen and extracts
 * `customTitle` (from `--name` metadata lines that Claude appends in the
 * tail). Use this when you need drift detection / friendly-name display.
 *
 * customTitle wins over the auto-derived first-prompt title — matches
 * Claude CLI's own read precedence (sessionStorage.ts: `??=` so --name
 * beats resumed firstPrompt).
 */
export function parseSessionEnriched(jsonl: string): EnrichedSession {
  const base = parseSessionContent(jsonl);
  const counts = new Map<string, number>();
  let customTitle: string | null = null;

  for (const line of jsonl.split("\n")) {
    if (!line) continue;
    let v: any;
    try {
      v = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof v.cwd === "string" && MESSAGE_TYPES.has(v.type)) {
      counts.set(v.cwd, (counts.get(v.cwd) ?? 0) + 1);
    }
    // Claude Code writes one or more `{type:"summary", customTitle:"…"}`-shape
    // lines as session metadata. The LAST one wins (later --name overrides
    // earlier). Field is also written via `customTitle` key on summary rows.
    if (typeof v.customTitle === "string" && v.customTitle.length > 0) {
      customTitle = v.customTitle;
    }
  }

  const histogram = [...counts.entries()]
    .map(([cwd, count]) => ({ cwd, count }))
    .sort((a, b) => b.count - a.count);

  return {
    ...base,
    customTitle,
    dominantCwd: histogram[0]?.cwd ?? base.cwd,
    cwdHistogram: histogram,
  };
}

/** Extract a flat text string from a message.content that may be string OR array of blocks. */
/**
 * Pencil MCP (and similar agent integrations) prefix the user's actual
 * prompt with a verbatim tool-result echo of the form:
 *
 *   Tool result of `<fn>`. Calling `<fn>` is not necessary anymore.
 *   {…json blob…}
 *   <real user task here>
 *
 * That preamble + payload eats the first ~500-2000 chars, so when we
 * truncate to 60 for the title we end up with "Tool result of get_…" —
 * useless. This strips the preamble + JSON blob so the title falls on
 * the real human-written task underneath.
 *
 * No-op when the input doesn't match the pattern.
 */
export function stripToolResultPreamble(text: string | null): string | null {
  if (!text) return text;
  const m = text.match(
    /^Tool result of\s+`[^`]+`\.\s*Calling\s+`[^`]+`\s+is\s+not\s+necessary\s+anymore\.\s*/,
  );
  if (!m) return text;
  let rest = text.slice(m[0].length);
  // Strip the JSON blob that usually follows. Match a balanced {…} chunk
  // at the head; fall back to anything up to the first blank line if the
  // payload isn't JSON.
  rest = rest.trimStart();
  if (rest.startsWith("{")) {
    let depth = 0;
    let i = 0;
    let inStr = false;
    let esc = false;
    for (; i < rest.length; i++) {
      const ch = rest[i]!;
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
    }
    rest = rest.slice(i).trimStart();
  } else {
    // Skip up to first blank line (separates payload from real task).
    const idx = rest.search(/\n\s*\n/);
    if (idx >= 0) rest = rest.slice(idx).trimStart();
  }
  return rest.length > 0 ? rest : text;
}

export function extractText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === "string") parts.push(block);
    else if (block && typeof block === "object") {
      const b = block as { type?: string; text?: unknown };
      if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
    }
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * Encode a project path the way Claude Code stores it under
 * `~/.claude/projects/<encoded>/`.
 *
 * Empirical rule (verified against real ~/.claude/projects/ dirs):
 *   any character that is not [A-Za-z0-9-] is replaced with "-".
 *   Each char becomes a single "-" (no collapsing of consecutive chars).
 *
 * Examples:
 *   /Users/alice/Code/myapp             → -Users-alice-Code-myapp
 *   /Users/alice/Code/my_app            → -Users-alice-Code-my-app           (underscore → dash)
 *   /Users/alice/Code/My App            → -Users-alice-Code-My-App           (space → dash)
 *   /Users/alice/Code/foo.bar           → -Users-alice-Code-foo-bar          (dot → dash)
 *   /Users/alice/Code/中文项目          → -Users-alice-Code----              (each non-ASCII char → 1 dash)
 */
export function encodeProjectPath(absPath: string): string {
  return absPath.replace(/[^A-Za-z0-9-]/g, "-");
}

/** Lifecycle classifier (PRD §1) — temp vs persistent. */
export function classifyLifecycle(p: {
  messageCount: number;
  startedAt: number;
  lastActive: number;
}): "temp" | "persistent" {
  const FIVE_MIN_MS = 5 * 60 * 1000;
  const duration = p.lastActive - p.startedAt;
  if (p.messageCount <= 5 && duration <= FIVE_MIN_MS) return "temp";
  return "persistent";
}
