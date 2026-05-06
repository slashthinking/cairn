// Workspace + project + session discovery (PRD §3.1, §4.2).

import { ipcMain, dialog, shell } from "electron";
import {
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  encodeProjectPath,
  extractText,
  parseSessionContent,
  parseSessionEnriched,
  parseSessionMeta,
  readJsonlSampled,
} from "../lib/sessionParser.js";
import { validateAbsolutePath } from "../lib/escape.js";

const SAFE_NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;

export function registerWorkspaceIpc() {
  ipcMain.handle("workspace:pick-folder", pickFolder);
  ipcMain.handle("workspace:scan", (_e, p: unknown) =>
    scanWorkspace(asString(p)),
  );
  ipcMain.handle("workspace:sessions", (_e, p: unknown) =>
    listSessions(asString(p)),
  );
  ipcMain.handle("workspace:all-sessions", () => listAllSessions());
  ipcMain.handle(
    "workspace:create-folder",
    (_e, workspace: unknown, name: unknown) =>
      createFolder(asString(workspace), asString(name)),
  );
  ipcMain.handle("workspace:delete-sessions", (_e, ids: unknown) => {
    if (!Array.isArray(ids)) throw new Error("ids must be an array");
    return deleteSessions(
      ids.filter((x): x is string => typeof x === "string"),
    );
  });
  ipcMain.handle(
    "workspace:session-preview",
    (_e, projectPath: unknown, sessionId: unknown) =>
      getSessionPreview(asString(projectPath), asString(sessionId)),
  );
  ipcMain.handle(
    "workspace:rename-project",
    (_e, oldPath: unknown, newName: unknown) =>
      renameProject(asString(oldPath), asString(newName)),
  );
  ipcMain.handle("workspace:project-context", (_e, p: unknown) =>
    buildProjectContext(asString(p)),
  );
  ipcMain.handle(
    "workspace:session-context",
    (_e, projectPath: unknown, sessionId: unknown) =>
      buildSessionContext(asString(projectPath), asString(sessionId)),
  );
  ipcMain.handle("shell:reveal", (_e, p: unknown) =>
    shell.showItemInFolder(asString(p)),
  );
}

function asString(v: unknown): string {
  if (typeof v !== "string") throw new Error("expected string");
  return v;
}

/**
 * Create a new sub-folder under a registered workspace without launching
 * claude. The folder appears in the next scanWorkspace as a 0-session
 * project — the user can start a session there later via Quick Start or
 * by clicking the row's "Start session" affordance.
 *
 * Returns the absolute path of the new folder. Throws if the workspace
 * isn't valid, the name is unsafe, or the target already exists.
 */
async function createFolder(
  workspace: string,
  name: string,
): Promise<string> {
  const ws = validateAbsolutePath(workspace);
  const trimmed = name.trim();
  if (!trimmed) throw new Error("name is required");
  if (!SAFE_NAME_RE.test(trimmed)) {
    throw new Error(
      "project name must be 1–64 chars, [A-Za-z0-9._-] only",
    );
  }
  const target = path.join(ws, trimmed);
  if (existsSync(target)) {
    throw new Error(`already exists: ${target}`);
  }
  // recursive:true is harmless here since we already checked existence —
  // it just makes the call resilient if the parent workspace path was
  // freshly created concurrently.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { mkdirSync } = require("node:fs") as typeof import("node:fs");
  mkdirSync(target, { recursive: true });
  return target;
}

async function pickFolder(): Promise<string | null> {
  const r = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    message: "Choose a folder to register as a workspace",
  });
  return r.canceled ? null : r.filePaths[0]!;
}

/**
 * Build a context blob the AI Rename modal can feed to claude when asking
 * for project name suggestions. Includes the folder name, top-level
 * file/dir listing, and the most recent session titles.
 */
function buildProjectContext(projectPath: string): string {
  const validated = validateAbsolutePath(projectPath);
  const name = path.basename(validated);
  const lines: string[] = [];
  lines.push(`Folder name: ${name}`);
  lines.push(`Absolute path: ${validated}`);

  // Top-level entries (skip dotfiles + node_modules + heavy dirs)
  try {
    const entries = readdirSync(validated, { withFileTypes: true })
      .filter(
        (e) =>
          !e.name.startsWith(".") &&
          e.name !== "node_modules" &&
          e.name !== "dist" &&
          e.name !== "build" &&
          e.name !== "target",
      )
      .slice(0, 30)
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
    if (entries.length > 0) {
      lines.push("", "Top-level entries:", ...entries.map((e) => `  ${e}`));
    }
  } catch {
    /* permission denied or weird path — skip the listing */
  }

  // Recent session titles (limit 8)
  try {
    const sessionDir = path.join(
      os.homedir(),
      ".claude/projects",
      encodeProjectPath(validated),
    );
    if (existsSync(sessionDir)) {
      const titles: { title: string; t: number }[] = [];
      for (const entry of readdirSync(sessionDir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          try {
            const j = readFileSync(path.join(sessionDir, entry.name), "utf8");
            const p = parseSessionContent(j);
            if (p.title) titles.push({ title: p.title, t: p.lastActive });
          } catch {
            /* skip */
          }
        }
      }
      titles.sort((a, b) => b.t - a.t);
      const top = titles.slice(0, 8);
      if (top.length > 0) {
        lines.push(
          "",
          "Recent session titles:",
          ...top.map((s) => `  - ${s.title}`),
        );
      }
    }
  } catch {
    /* skip */
  }

  return lines.join("\n");
}

/**
 * Build the AI-rename context blob. Uses the LAST ~25 natural-language
 * messages (user + assistant, tool plumbing skipped) so Claude can name
 * the session by what it actually did, not what the user asked first.
 *
 * Implementation: tail-sample 1 MiB of the jsonl, parse complete lines,
 * filter to message types with extractable text, take the last 25.
 */
function buildSessionContext(projectPath: string, sessionId: string): string {
  const validated = validateAbsolutePath(projectPath);
  if (!/^[a-f0-9-]{1,64}$/i.test(sessionId)) {
    throw new Error(`invalid session id: ${sessionId}`);
  }
  const filePath = path.join(
    os.homedir(),
    ".claude/projects",
    encodeProjectPath(validated),
    `${sessionId}.jsonl`,
  );

  if (existsSync(filePath)) {
    try {
      const fsize = statSync(filePath).size;
      const tail = readJsonlSampledSized(filePath, fsize, 0, 1 << 20);
      const messages: { role: string; text: string; ts: number }[] = [];
      for (const line of tail.split("\n")) {
        if (!line) continue;
        let v: any;
        try {
          v = JSON.parse(line);
        } catch {
          continue;
        }
        if (v.type !== "user" && v.type !== "assistant") continue;
        const text = extractText(v.message?.content);
        if (!text || !text.trim()) continue;
        let ts = 0;
        if (typeof v.timestamp === "string") {
          const t = Date.parse(v.timestamp);
          if (!Number.isNaN(t)) ts = t;
        }
        messages.push({
          role: v.type === "user" ? "User" : "Claude",
          text: text.slice(0, 500),
          ts,
        });
      }
      messages.sort((a, b) => a.ts - b.ts);
      const recent = messages.slice(-25);
      if (recent.length > 0) {
        return [
          `Project: ${path.basename(validated)}`,
          `Session: ${sessionId.slice(0, 8)}`,
          ``,
          `Last ${recent.length} messages:`,
          ...recent.map((m) => `${m.role}: ${m.text}`),
        ].join("\n");
      }
    } catch {
      /* fall through to meta */
    }
  }
  // Nested-only fallback: only first_prompt is available.
  const metaPath = path.join(
    os.homedir(),
    ".claude/usage-data/session-meta",
    `${sessionId}.json`,
  );
  if (existsSync(metaPath)) {
    try {
      const meta = JSON.parse(readFileSync(metaPath, "utf8"));
      const fp = typeof meta.first_prompt === "string" ? meta.first_prompt : "";
      return `Project: ${path.basename(validated)}\n\nFirst prompt (only summary available):\n${fp.slice(0, 1000)}`;
    } catch {
      /* fall through */
    }
  }
  return `Project: ${path.basename(validated)}\nSession: ${sessionId}`;
}

interface PreviewMessage {
  role: "user" | "assistant";
  text: string;
  timestamp: number;
}

interface SessionPreview {
  lastMessages: PreviewMessage[];
}

/**
 * Pull the last 10 chat messages from a session jsonl so the user can see
 * where the conversation left off. Skips tool_use / tool_result blocks —
 * only natural-language exchanges. Reads the tail of the file (1 MiB) which
 * is plenty for the recent window even on multi-MB transcripts.
 */
function getSessionPreview(
  projectPath: string,
  sessionId: string,
): SessionPreview {
  const validated = validateAbsolutePath(projectPath);
  if (!/^[a-f0-9-]{1,64}$/i.test(sessionId)) {
    throw new Error(`invalid session id: ${sessionId}`);
  }
  const filePath = path.join(
    os.homedir(),
    ".claude/projects",
    encodeProjectPath(validated),
    `${sessionId}.jsonl`,
  );
  if (!existsSync(filePath)) {
    return { lastMessages: [] };
  }
  const fsize = statSync(filePath).size;
  // 1 MiB tail is plenty: a verbose assistant turn is typically 10-50 KiB
  // even with code blocks, so 1 MiB easily covers the last 10+ exchanges.
  // Head budget is 0 — we don't need conversation start.
  const sampled = readJsonlSampledSized(filePath, fsize, 0, 1 << 20);
  const messages: PreviewMessage[] = [];
  for (const line of sampled.split("\n")) {
    if (!line) continue;
    let v: any;
    try {
      v = JSON.parse(line);
    } catch {
      continue;
    }
    if (v.type !== "user" && v.type !== "assistant") continue;
    const text = extractText(v.message?.content);
    if (!text || !text.trim()) continue;
    let ts = 0;
    if (typeof v.timestamp === "string") {
      const t = Date.parse(v.timestamp);
      if (!Number.isNaN(t)) ts = t;
    }
    messages.push({
      role: v.type,
      text: text.slice(0, 1200),
      timestamp: ts,
    });
  }
  messages.sort((a, b) => a.timestamp - b.timestamp);
  return { lastMessages: messages.slice(-10) };
}

/**
 * Re-export of readJsonlSampled with custom byte budgets — `getSessionPreview`
 * wants a different head/tail balance than the default for `listAllSessions`.
 */
function readJsonlSampledSized(
  filePath: string,
  fileSize: number,
  headBytes: number,
  tailBytes: number,
): string {
  // sessionParser.readJsonlSampled accepts byte sizes via positional args,
  // so we just delegate. Keeping a thin wrapper avoids leaking the signature
  // detail into multiple callsites in this file.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readJsonlSampled: r } = require("../lib/sessionParser.js");
  return r(filePath, fileSize, headBytes, tailBytes);
}

function extractFirstUserMessages(jsonl: string, n: number): string[] {
  const out: string[] = [];
  for (const line of jsonl.split("\n")) {
    if (out.length >= n) break;
    if (!line) continue;
    try {
      const v = JSON.parse(line);
      if (v.type !== "user") continue;
      const c = v.message?.content;
      let text: string | null = null;
      if (typeof c === "string") text = c;
      else if (Array.isArray(c)) {
        const parts: string[] = [];
        for (const block of c) {
          if (block && block.type === "text" && typeof block.text === "string") {
            parts.push(block.text);
          }
        }
        text = parts.length > 0 ? parts.join(" ") : null;
      }
      if (text) out.push(text.slice(0, 500));
    } catch {
      /* skip malformed line */
    }
  }
  return out;
}

interface Project {
  path: string;
  name: string;
  sessionCount: number;
}

async function scanWorkspace(workspaceRoot: string): Promise<Project[]> {
  const validated = validateAbsolutePath(workspaceRoot);
  const entries = readdirSync(validated, { withFileTypes: true });
  const projects: Project[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    const full = path.join(validated, entry.name);
    projects.push({
      path: full,
      name: entry.name,
      sessionCount: countSessions(full),
    });
  }
  return projects;
}

// Top-level entries that look like a session UUID directory name.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function countSessions(projectPath: string): number {
  const sessionDir = path.join(
    os.homedir(),
    ".claude/projects",
    encodeProjectPath(projectPath),
  );
  if (!existsSync(sessionDir)) return 0;
  // Dedupe by uuid — a project can have BOTH `<uuid>.jsonl` (flat schema)
  // AND `<uuid>/` (nested schema) for the same session. Counting both
  // double-counts and breaks selection (same id appears twice in the list).
  const uuids = new Set<string>();
  for (const entry of readdirSync(sessionDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      const id = entry.name.replace(/\.jsonl$/, "");
      if (UUID_RE.test(id)) uuids.add(id);
    } else if (entry.isDirectory() && UUID_RE.test(entry.name)) {
      uuids.add(entry.name);
    }
  }
  return uuids.size;
}

interface Session {
  id: string;
  projectPath: string;
  title: string | null;
  startedAt: number;
  lastActive: number;
  messageCount: number;
  model: string | null;
  gitBranch: string | null;
  forkedFrom: { sessionId: string; messageUuid: string } | null;
}

/**
 * Rename a project folder on disk AND update the matching ~/.claude/projects/<encoded>
 * directory so claude can still find prior sessions after the move.
 */
async function renameProject(
  oldPath: string,
  newName: string,
): Promise<string> {
  const validated = validateAbsolutePath(oldPath);
  if (!SAFE_NAME_RE.test(newName)) {
    throw new Error("project name must be 1–64 chars, [A-Za-z0-9._-] only");
  }
  if (!existsSync(validated) || !statSync(validated).isDirectory()) {
    throw new Error(`not a directory: ${validated}`);
  }

  const parent = path.dirname(validated);
  const newPath = path.join(parent, newName);
  if (existsSync(newPath)) {
    throw new Error(`target path already exists: ${newPath}`);
  }

  // 1. Rename the project folder itself
  renameSync(validated, newPath);

  // 2. Rename the encoded session directory under ~/.claude/projects (best-effort)
  const oldEncoded = path.join(
    os.homedir(),
    ".claude/projects",
    encodeProjectPath(validated),
  );
  const newEncoded = path.join(
    os.homedir(),
    ".claude/projects",
    encodeProjectPath(newPath),
  );
  if (existsSync(oldEncoded) && !existsSync(newEncoded)) {
    try {
      renameSync(oldEncoded, newEncoded);
    } catch (err) {
      console.error(
        `Failed to rename session dir ${oldEncoded} → ${newEncoded}:`,
        err,
      );
      // not fatal — user's sessions still exist at old encoded path
    }
  }

  return newPath;
}

async function listSessions(projectPath: string): Promise<Session[]> {
  const validated = validateAbsolutePath(projectPath);
  const sessionDir = path.join(
    os.homedir(),
    ".claude/projects",
    encodeProjectPath(validated),
  );
  if (!existsSync(sessionDir)) return [];
  const metaDir = path.join(os.homedir(), ".claude/usage-data/session-meta");

  // First pass — collect every uuid seen in the dir, mark which schemas
  // produced it. We then resolve each uuid to a single Session so that
  // duplicates (flat .jsonl + nested dir for the same session) collapse.
  const seen = new Map<
    string,
    { flatFile?: string; nestedDir?: string }
  >();
  for (const entry of readdirSync(sessionDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      const id = entry.name.replace(/\.jsonl$/, "");
      if (!UUID_RE.test(id)) continue;
      const slot = seen.get(id) ?? {};
      slot.flatFile = path.join(sessionDir, entry.name);
      seen.set(id, slot);
    } else if (entry.isDirectory() && UUID_RE.test(entry.name)) {
      const slot = seen.get(entry.name) ?? {};
      slot.nestedDir = path.join(sessionDir, entry.name);
      seen.set(entry.name, slot);
    }
  }

  const sessions: Session[] = [];
  for (const [id, slot] of seen) {
    try {
      // Prefer the flat jsonl when present — it has the full message stream
      // and richer metadata (model, gitBranch, real cwd).
      if (slot.flatFile) {
        const fsize = statSync(slot.flatFile).size;
        const jsonl = readJsonlSampled(slot.flatFile, fsize);
        const parsed = parseSessionContent(jsonl);
        sessions.push({ id, projectPath: validated, ...parsed });
        continue;
      }
      // Else nested-only — look up the meta file
      if (slot.nestedDir) {
        const metaPath = path.join(metaDir, `${id}.json`);
        if (existsSync(metaPath)) {
          let meta: unknown = null;
          try {
            meta = JSON.parse(readFileSync(metaPath, "utf8"));
          } catch {
            // Malformed meta — fall through to nested-dir derivation. Don't
            // log: a chunk of historical meta files have control-char escape
            // issues and noisy logs scared the user.
          }
          const parsed = meta ? parseSessionMeta(meta) : null;
          if (parsed) {
            sessions.push({ id, projectPath: validated, ...parsed });
            continue;
          }
        }
        const fallback = deriveFromNestedDir(slot.nestedDir);
        if (fallback) {
          sessions.push({ id, projectPath: validated, ...fallback });
        }
      }
    } catch (err) {
      console.warn(`[listSessions] skipping ${id}:`, err);
    }
  }
  return sessions.sort((a, b) => b.lastActive - a.lastActive);
}

/**
 * Best-effort metadata for a nested session that has no usage-data meta file.
 * Different schemas put different things inside (`subagents/`, `tool-results/`,
 * `memory/` etc) — we just count any *.jsonl found anywhere under the dir
 * and use the dir's mtime/birthtime for timestamps.
 */
function deriveFromNestedDir(sessionPath: string): {
  title: string | null;
  startedAt: number;
  lastActive: number;
  messageCount: number;
  model: string | null;
  gitBranch: string | null;
  forkedFrom: null;
} | null {
  if (!existsSync(sessionPath) || !statSync(sessionPath).isDirectory()) {
    return null;
  }
  let jsonlCount = 0;
  for (const sub of readdirSync(sessionPath, { withFileTypes: true })) {
    if (!sub.isDirectory()) continue;
    const subPath = path.join(sessionPath, sub.name);
    try {
      jsonlCount += readdirSync(subPath).filter((f) =>
        f.endsWith(".jsonl"),
      ).length;
    } catch {
      // permissions / race — skip
    }
  }
  const stat = statSync(sessionPath);
  return {
    title: null,
    startedAt: stat.birthtimeMs || stat.mtimeMs,
    lastActive: stat.mtimeMs,
    messageCount: jsonlCount,
    model: null,
    gitBranch: null,
    forkedFrom: null,
  };
}

interface AllSession {
  id: string;
  /**
   * "primary" = a top-level Claude Code session the user drove themselves
   *   (has the flat .jsonl, OR a usage-data meta file).
   * "subagent" = orphaned Task() research subagent — the parent session's
   *   flat .jsonl was deleted/never wrote, but `<uuid>/subagents/agent-*.jsonl`
   *   files survived. We surface them so users can still see the work, but
   *   they shouldn't be confused with their own conversations.
   */
  kind: "primary" | "subagent";
  /**
   * True when no transcript file exists on disk (no flat .jsonl, no nested
   * subagent dir) — only the usage-data meta survives. Cleanup, version
   * migrations, or SDK-only sessions leave hundreds of these. Surfaced so
   * users can audit history, but `--resume` won't work for them.
   */
  archive: boolean;
  /**
   * True when we know the session's dominant cwd directory has been deleted
   * from disk — the project that hosted this conversation no longer exists.
   * False when the dir exists OR we can't tell (no cwd recorded). Used to
   * power the "folder gone" filter + bulk cleanup button.
   */
  folderDeleted: boolean;
  /**
   * Fork pointer. Non-null when this session was created via
   * `claude --resume <id> --fork-session`. Cairn shows a `fork` badge and
   * a "forked from <id|name>" link in the preview pane.
   */
  forkedFrom: { sessionId: string; messageUuid: string } | null;
  title: string | null;
  customTitle: string | null;
  /** Encoded project dir name (e.g. -Users-mac-Coding) — what claude used to file the .jsonl */
  launchedFrom: string | null;
  /** Most-frequent cwd in the message stream — where work actually happened */
  dominantCwd: string | null;
  /** True when launchedFrom and dominantCwd point at different directories. */
  drifted: boolean;
  startedAt: number;
  lastActive: number;
  messageCount: number;
  model: string | null;
  gitBranch: string | null;
  /** True if a live PID file in ~/.claude/sessions/ references this sessionId. */
  active: boolean;
  /** activeName from `~/.claude/sessions/<pid>.json` `name` field (--name) */
  activeName: string | null;
}

const UUID_RE_FULL =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Tertiary fallback for nested-only sessions whose `usage-data/session-meta`
 * file is also missing — read the FIRST line of any subagent jsonl to recover
 * cwd, sessionId-stamped origin, and the first user message (which is the
 * Task() prompt, not a true user message). These are typically orphaned
 * research subagents whose parent .jsonl was cleaned up.
 *
 * Returns null when the dir has no readable subagent jsonls. Empty cwd in
 * the line is treated as "unknown" (not synthesized).
 */
function deriveFromSubagent(nestedDir: string): {
  title: string | null;
  startedAt: number;
  lastActive: number;
  messageCount: number;
  model: string | null;
  gitBranch: string | null;
  cwd: string | null;
} | null {
  const subagentDir = path.join(nestedDir, "subagents");
  if (!existsSync(subagentDir)) return null;
  let files: string[];
  try {
    files = readdirSync(subagentDir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return null;
  }
  if (files.length === 0) return null;

  let cwd: string | null = null;
  let gitBranch: string | null = null;
  let title: string | null = null;
  let startedAt = 0;
  let lastActive = 0;

  for (const f of files) {
    const fp = path.join(subagentDir, f);
    try {
      const stat = statSync(fp);
      if (stat.mtimeMs > lastActive) lastActive = stat.mtimeMs;
      if (cwd && title) continue; // already have what we need from earlier file
      const head = readFileSync(fp, "utf8").split("\n", 1)[0] ?? "";
      const v = JSON.parse(head);
      if (!cwd && typeof v.cwd === "string") cwd = v.cwd;
      if (!gitBranch && typeof v.gitBranch === "string") {
        gitBranch = v.gitBranch;
      }
      if (!title && v.type === "user") {
        title = extractText(v.message?.content)?.slice(0, 60) ?? null;
      }
      if (!startedAt && typeof v.timestamp === "string") {
        const t = Date.parse(v.timestamp);
        if (!Number.isNaN(t)) startedAt = t;
      }
    } catch {
      /* malformed first line or unreadable file — try next subagent */
    }
  }

  return {
    title,
    startedAt: startedAt || lastActive,
    lastActive,
    messageCount: files.length,
    model: null,
    gitBranch,
    cwd,
  };
}

/**
 * Read `~/.claude/sessions/<pid>.json` registry to discover live sessions.
 * Maps sessionId → {name, status, cwd}. Stale PID files (pid not running)
 * are tolerated — we just trust whatever is there since we're read-only.
 *
 * Caller takes the data as best-effort. PID files lag a few seconds vs
 * `claude --resume` reality but that's good enough for an "active" badge.
 */
function readActiveRegistry(): Map<
  string,
  { name: string | null; status: string | null; launchCwd: string | null }
> {
  const dir = path.join(os.homedir(), ".claude", "sessions");
  const out = new Map<
    string,
    { name: string | null; status: string | null; launchCwd: string | null }
  >();
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try {
      const j = JSON.parse(readFileSync(path.join(dir, entry.name), "utf8"));
      if (typeof j.sessionId === "string") {
        out.set(j.sessionId, {
          name: typeof j.name === "string" ? j.name : null,
          status: typeof j.status === "string" ? j.status : null,
          launchCwd: typeof j.cwd === "string" ? j.cwd : null,
        });
      }
    } catch {
      /* skip malformed pid registry file */
    }
  }
  return out;
}

/**
 * Walk every encoded project dir under ~/.claude/projects/ and return the
 * union of every session ever stored on disk — regardless of whether the
 * launching cwd is in any registered Cairn workspace.
 *
 * Why a separate IPC instead of fanning workspace:sessions: the launch cwd
 * may not match any project the user registered (claude was started from a
 * scratch dir, or from a parent of registered projects, or from a worktree
 * that's since been removed). The All Sessions view exists to surface those
 * orphans.
 *
 * For each session we compute:
 *   - dominantCwd from the message-line cwd histogram (the cwd Claude
 *     spent most time in — survives mid-session `cd`)
 *   - drifted = launchedFrom !== dominantCwd
 *   - customTitle from the JSONL's metadata lines (--name)
 *   - active flag + active name from ~/.claude/sessions/<pid>.json
 */
interface DeleteSessionsResult {
  deleted: number;
  bytesFreed: number;
  errors: { id: string; error: string }[];
}

/**
 * Delete every on-disk artifact for the given session UUIDs:
 *   - flat ~/.claude/projects/<encoded>/<uuid>.jsonl (any encoded dir)
 *   - nested ~/.claude/projects/<encoded>/<uuid>/ (recursive)
 *   - ~/.claude/usage-data/session-meta/<uuid>.json
 *
 * Caller is expected to have shown a confirmation modal — this just executes.
 * Errors are collected per-id, not thrown, so a single broken file doesn't
 * abort the whole sweep.
 */
function deleteSessions(ids: string[]): DeleteSessionsResult {
  const result: DeleteSessionsResult = {
    deleted: 0,
    bytesFreed: 0,
    errors: [],
  };
  const targetSet = new Set<string>();
  for (const id of ids) {
    if (UUID_RE_FULL.test(id)) targetSet.add(id);
  }
  if (targetSet.size === 0) return result;

  const projectsDir = path.join(os.homedir(), ".claude", "projects");
  const metaDir = path.join(os.homedir(), ".claude/usage-data/session-meta");

  for (const id of targetSet) {
    let touched = false;
    let errored = false;
    // Walk every project dir looking for this UUID — a session id is unique
    // across the whole projects/ tree, but we don't know its parent dir.
    if (existsSync(projectsDir)) {
      let projDirs: import("node:fs").Dirent[];
      try {
        projDirs = readdirSync(projectsDir, { withFileTypes: true });
      } catch {
        projDirs = [];
      }
      for (const proj of projDirs) {
        if (!proj.isDirectory()) continue;
        const projPath = path.join(projectsDir, proj.name);
        const flat = path.join(projPath, `${id}.jsonl`);
        const nested = path.join(projPath, id);
        try {
          if (existsSync(flat)) {
            const sz = statSync(flat).size;
            unlinkSync(flat);
            result.bytesFreed += sz;
            touched = true;
          }
        } catch (err) {
          result.errors.push({ id, error: `flat unlink: ${err instanceof Error ? err.message : String(err)}` });
          errored = true;
        }
        try {
          if (existsSync(nested) && statSync(nested).isDirectory()) {
            // Sum size before rm — recursive walk of typically-small subagent jsonls.
            let sz = 0;
            try {
              for (const sub of readdirSync(nested, { withFileTypes: true })) {
                if (sub.isDirectory()) {
                  for (const f of readdirSync(path.join(nested, sub.name))) {
                    try {
                      sz += statSync(path.join(nested, sub.name, f)).size;
                    } catch {
                      /* skip */
                    }
                  }
                } else if (sub.isFile()) {
                  try {
                    sz += statSync(path.join(nested, sub.name)).size;
                  } catch {
                    /* skip */
                  }
                }
              }
            } catch {
              /* couldn't size — proceed with delete anyway */
            }
            rmSync(nested, { recursive: true, force: true });
            result.bytesFreed += sz;
            touched = true;
          }
        } catch (err) {
          result.errors.push({ id, error: `nested rm: ${err instanceof Error ? err.message : String(err)}` });
          errored = true;
        }
      }
    }
    // Meta tombstone
    try {
      const metaPath = path.join(metaDir, `${id}.json`);
      if (existsSync(metaPath)) {
        const sz = statSync(metaPath).size;
        unlinkSync(metaPath);
        result.bytesFreed += sz;
        touched = true;
      }
    } catch (err) {
      result.errors.push({ id, error: `meta unlink: ${err instanceof Error ? err.message : String(err)}` });
      errored = true;
    }
    if (touched && !errored) result.deleted += 1;
  }
  return result;
}

async function listAllSessions(): Promise<AllSession[]> {
  const projectsDir = path.join(os.homedir(), ".claude", "projects");
  if (!existsSync(projectsDir)) return [];
  const metaDir = path.join(os.homedir(), ".claude/usage-data/session-meta");
  const active = readActiveRegistry();

  const out: AllSession[] = [];
  /**
   * Track every UUID we've already emitted via the projects/ walk so the
   * meta-only sweep at the bottom doesn't re-emit duplicates.
   */
  const emittedIds = new Set<string>();
  for (const projDir of readdirSync(projectsDir, { withFileTypes: true })) {
    if (!projDir.isDirectory()) continue;
    const projPath = path.join(projectsDir, projDir.name);

    // Track which uuids we've seen via flat files vs nested-dir-only so we
    // don't double-emit when both schemas exist for the same session.
    const seen = new Map<
      string,
      { flatFile?: string; nestedDir?: string }
    >();
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(projPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith(".jsonl")) {
        const id = e.name.replace(/\.jsonl$/, "");
        if (!UUID_RE_FULL.test(id)) continue;
        const slot = seen.get(id) ?? {};
        slot.flatFile = path.join(projPath, e.name);
        seen.set(id, slot);
      } else if (e.isDirectory() && UUID_RE_FULL.test(e.name)) {
        const slot = seen.get(e.name) ?? {};
        slot.nestedDir = path.join(projPath, e.name);
        seen.set(e.name, slot);
      }
    }

    for (const [id, slot] of seen) {
      try {
        const live = active.get(id);
        let enriched: ReturnType<typeof parseSessionEnriched> | null = null;
        if (slot.flatFile) {
          // Files can be 50-80MB; sample head+tail to keep the main thread
          // alive. This loses some interior cwd-record fidelity but the
          // dominant cwd is overwhelmingly stable across a session, and
          // the head+tail covers startedAt/lastActive/customTitle exactly.
          const fsize = statSync(slot.flatFile).size;
          enriched = parseSessionEnriched(readJsonlSampled(slot.flatFile, fsize));
        }

        // Tier 1 nested fallback: usage-data meta JSON
        let metaFallback: ReturnType<typeof parseSessionMeta> | null = null;
        // Tier 2 nested fallback: subagent jsonl first line
        let subagentFallback: ReturnType<typeof deriveFromSubagent> = null;
        if (!enriched && slot.nestedDir) {
          const metaPath = path.join(metaDir, `${id}.json`);
          if (existsSync(metaPath)) {
            try {
              metaFallback = parseSessionMeta(
                JSON.parse(readFileSync(metaPath, "utf8")),
              );
            } catch {
              /* malformed meta, fall through to subagent */
            }
          }
          if (!metaFallback) {
            subagentFallback = deriveFromSubagent(slot.nestedDir);
          }
        }

        // A session is a "subagent" entry only when ALL we have to identify
        // it is the subagent jsonls — i.e. no flat .jsonl, no usage-data meta.
        // Sessions that have a meta file are still primary (just with a tail
        // pruned) and resume normally.
        const kind: "primary" | "subagent" =
          !enriched && !metaFallback && subagentFallback ? "subagent" : "primary";

        const launchedFrom =
          enriched?.cwd ??
          subagentFallback?.cwd ??
          live?.launchCwd ??
          null;
        const dominantCwd =
          enriched?.dominantCwd ??
          metaFallback?.cwd ??
          subagentFallback?.cwd ??
          launchedFrom;
        const drifted =
          kind === "primary" &&
          !!launchedFrom &&
          !!dominantCwd &&
          launchedFrom !== dominantCwd;

        emittedIds.add(id);
        const folderDeleted =
          !!dominantCwd && !existsSync(dominantCwd);
        out.push({
          id,
          kind,
          archive: false,
          folderDeleted,
          title:
            enriched?.title ??
            metaFallback?.title ??
            subagentFallback?.title ??
            null,
          customTitle: enriched?.customTitle ?? null,
          launchedFrom,
          dominantCwd,
          drifted,
          startedAt:
            enriched?.startedAt ??
            metaFallback?.startedAt ??
            subagentFallback?.startedAt ??
            0,
          lastActive:
            enriched?.lastActive ??
            metaFallback?.lastActive ??
            subagentFallback?.lastActive ??
            0,
          messageCount:
            enriched?.messageCount ??
            metaFallback?.messageCount ??
            subagentFallback?.messageCount ??
            0,
          model: enriched?.model ?? null,
          gitBranch: enriched?.gitBranch ?? subagentFallback?.gitBranch ?? null,
          active: !!live,
          activeName: live?.name ?? null,
          forkedFrom: enriched?.forkedFrom ?? null,
        });
      } catch (err) {
        console.warn(`[listAllSessions] skipping ${id}:`, err);
      }
    }
  }

  // Meta-only sweep: ~/.claude/usage-data/session-meta/<uuid>.json may
  // contain hundreds of sessions whose transcripts no longer exist on disk
  // (cleanup, version migration, SDK-only sessions). Surface them with
  // `archive: true` so the user can still see history and project_path.
  if (existsSync(metaDir)) {
    let metaEntries: import("node:fs").Dirent[];
    try {
      metaEntries = readdirSync(metaDir, { withFileTypes: true });
    } catch {
      metaEntries = [];
    }
    for (const entry of metaEntries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const id = entry.name.slice(0, -5);
      if (!UUID_RE_FULL.test(id)) continue;
      if (emittedIds.has(id)) continue;
      try {
        const raw = readFileSync(path.join(metaDir, entry.name), "utf8");
        const parsed = parseSessionMeta(JSON.parse(raw));
        if (!parsed) continue;
        const live = active.get(id);
        const archCwd = parsed.cwd ?? live?.launchCwd ?? null;
        const folderDeleted = !!archCwd && !existsSync(archCwd);
        out.push({
          id,
          kind: "primary",
          archive: true,
          folderDeleted,
          title: parsed.title,
          customTitle: null,
          launchedFrom: parsed.cwd ?? live?.launchCwd ?? null,
          dominantCwd: parsed.cwd ?? live?.launchCwd ?? null,
          drifted: false,
          startedAt: parsed.startedAt,
          lastActive: parsed.lastActive,
          messageCount: parsed.messageCount,
          model: null,
          gitBranch: null,
          active: !!live,
          activeName: live?.name ?? null,
          forkedFrom: null,
        });
      } catch {
        // Malformed or unreadable meta — silently skip; we already accept
        // that this archive is best-effort.
      }
    }
  }

  return out.sort((a, b) => b.lastActive - a.lastActive);
}
