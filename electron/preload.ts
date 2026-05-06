// Bridge between renderer (React) and main process.
// Renderer calls window.cairn.<method>() — no direct Node access.

import { contextBridge, ipcRenderer } from "electron";

export interface CairnApi {
  // Workspace
  pickFolder: () => Promise<string | null>;
  scanWorkspace: (path: string) => Promise<Project[]>;
  createFolder: (workspace: string, name: string) => Promise<string>;
  listSessions: (projectPath: string) => Promise<Session[]>;
  listAllSessions: () => Promise<AllSession[]>;
  deleteSessions: (ids: string[]) => Promise<{
    deleted: number;
    bytesFreed: number;
    errors: { id: string; error: string }[];
  }>;
  renameProject: (oldPath: string, newName: string) => Promise<string>;
  revealInFinder: (path: string) => Promise<void>;
  getProjectContext: (path: string) => Promise<string>;
  getSessionContext: (
    projectPath: string,
    sessionId: string,
  ) => Promise<string>;
  getSessionPreview: (
    projectPath: string,
    sessionId: string,
  ) => Promise<SessionPreview>;

  // Claude CLI
  detectClaude: () => Promise<boolean>;
  renameSuggestions: (payload: RenamePayload) => Promise<SuggestionsResponse>;
  clusterProjects: (payload: ClusterPayload) => Promise<ClusterResponse>;

  // Terminal
  listTerminals: () => Promise<InstalledTerminals>;
  resumeInTerminal: (payload: ResumePayload) => Promise<void>;
  startNewProject: (payload: NewProjectPayload) => Promise<string>;
  startNewSession: (payload: {
    projectPath: string;
    initialPrompt?: string;
    terminal: string;
  }) => Promise<void>;

  // Store
  storeGet: <K extends keyof StoreSchema>(key: K) => Promise<StoreSchema[K]>;
  storeSet: <K extends keyof StoreSchema>(
    key: K,
    value: StoreSchema[K],
  ) => Promise<void>;
  addWorkspace: (path: string) => Promise<string[]>;
  removeWorkspace: (path: string) => Promise<string[]>;
  setProjectMeta: (
    path: string,
    meta: ProjectMeta,
  ) => Promise<void>;
  setSessionTitle: (sessionId: string, title: string) => Promise<void>;

  // System info
  getUsername: () => Promise<string | null>;

  // Hybrid search (LanceDB Rust core + Python embedder, no daemon).
  lancedbSearch: (payload: {
    query: string;
    topK?: number;
    model?: string;
  }) => Promise<{ sessionId: string; score: number; text: string }[]>;
  lancedbRebuild: (payload: {
    items: {
      sessionId: string;
      text: string;
      projectPath: string | null;
      lastActive: number;
    }[];
    model?: string;
  }) => Promise<{
    embedded: number;
    reused: number;
    removed: number;
    errors: number;
    ok: boolean;
    message?: string;
  }>;
  lancedbStatus: () => Promise<{
    ready: boolean;
    model: string;
    count: number;
    builtAt: number | null;
    ageMs: number | null;
    dim: number | null;
  }>;
  lancedbClear: () => Promise<void>;
}

export interface ProjectMeta {
  aiName?: string;
  cluster?: string;
  pinned?: boolean;
}

export interface StoreSchema {
  workspaces: string[];
  terminalPreference: string;
  customTerminalCommand?: string;
  theme: "dark" | "light";
  projectMeta: Record<string, ProjectMeta>;
  sessionTitles: Record<string, string>;
  clustersByWorkspace: Record<
    string,
    { name: string; projectIds: string[] }[]
  >;
}

export interface Project {
  path: string;
  name: string;
  sessionCount: number;
}

export interface Session {
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

export interface SessionPreview {
  lastMessages: { role: "user" | "assistant"; text: string; timestamp: number }[];
}

export interface AllSession {
  id: string;
  /** "subagent" = orphaned Task() research subagent; "primary" = top-level user session. */
  kind: "primary" | "subagent";
  /** True when transcript is gone — only usage-data meta survives. */
  archive: boolean;
  /** True when the dominant cwd directory has been deleted from disk. */
  folderDeleted: boolean;
  /** Fork pointer to the parent session + message uuid. */
  forkedFrom: { sessionId: string; messageUuid: string } | null;
  title: string | null;
  customTitle: string | null;
  /** Where claude was launched from — the cwd encoded into the .jsonl's parent dir. */
  launchedFrom: string | null;
  /** Most-frequent cwd in the message stream (where work actually happened). */
  dominantCwd: string | null;
  drifted: boolean;
  startedAt: number;
  lastActive: number;
  messageCount: number;
  model: string | null;
  gitBranch: string | null;
  active: boolean;
  activeName: string | null;
}

export interface RenamePayload {
  kind: "project" | "session";
  context: string;
}

export interface SuggestionsResponse {
  suggestions: { name: string; reasoning: string }[];
}

export interface ClusterPayload {
  workspace: string;
  projects: { id: string; name: string; firstPrompts: string[] }[];
}

export interface ClusterResponse {
  clusters: { name: string; projectIds: string[] }[];
}

export interface InstalledTerminals {
  iterm2: boolean;
  warp: boolean;
  ghostty: boolean;
  kitty: boolean;
  alacritty: boolean;
  terminalApp: true;
}

export interface ResumePayload {
  terminal: string;
  cwd: string;
  sessionId?: string;
  customCommandTemplate?: string;
}

export interface NewProjectPayload {
  workspace: string;
  name?: string;
  initialPrompt?: string;
  terminal: string;
}

const api: CairnApi = {
  pickFolder: () => ipcRenderer.invoke("workspace:pick-folder"),
  scanWorkspace: (path) => ipcRenderer.invoke("workspace:scan", path),
  createFolder: (workspace, name) =>
    ipcRenderer.invoke("workspace:create-folder", workspace, name),
  listSessions: (projectPath) => ipcRenderer.invoke("workspace:sessions", projectPath),
  listAllSessions: () => ipcRenderer.invoke("workspace:all-sessions"),
  deleteSessions: (ids) => ipcRenderer.invoke("workspace:delete-sessions", ids),
  renameProject: (oldPath, newName) =>
    ipcRenderer.invoke("workspace:rename-project", oldPath, newName),
  revealInFinder: (path) => ipcRenderer.invoke("shell:reveal", path),
  getProjectContext: (path) =>
    ipcRenderer.invoke("workspace:project-context", path),
  getSessionContext: (projectPath, sessionId) =>
    ipcRenderer.invoke("workspace:session-context", projectPath, sessionId),
  getSessionPreview: (projectPath, sessionId) =>
    ipcRenderer.invoke("workspace:session-preview", projectPath, sessionId),

  detectClaude: () => ipcRenderer.invoke("claude:detect"),
  renameSuggestions: (payload) =>
    ipcRenderer.invoke("claude:rename-suggestions", payload),
  clusterProjects: (payload) => ipcRenderer.invoke("claude:cluster", payload),

  listTerminals: () => ipcRenderer.invoke("terminal:list"),
  resumeInTerminal: (payload) => ipcRenderer.invoke("terminal:resume", payload),
  startNewProject: (payload) => ipcRenderer.invoke("terminal:new-project", payload),
  startNewSession: (payload) => ipcRenderer.invoke("terminal:new-session", payload),

  storeGet: (key) => ipcRenderer.invoke("store:get", key),
  storeSet: (key, value) => ipcRenderer.invoke("store:set", key, value),
  addWorkspace: (path) => ipcRenderer.invoke("store:add-workspace", path),
  removeWorkspace: (path) => ipcRenderer.invoke("store:remove-workspace", path),
  setProjectMeta: (path, meta) =>
    ipcRenderer.invoke("store:set-project-meta", path, meta),
  setSessionTitle: (id, title) =>
    ipcRenderer.invoke("store:set-session-title", id, title),

  getUsername: () => ipcRenderer.invoke("system:username"),

  lancedbSearch: (payload) => ipcRenderer.invoke("lancedb:search", payload),
  lancedbRebuild: (payload) => ipcRenderer.invoke("lancedb:rebuild", payload),
  lancedbStatus: () => ipcRenderer.invoke("lancedb:status"),
  lancedbClear: () => ipcRenderer.invoke("lancedb:clear"),
};

contextBridge.exposeInMainWorld("cairn", api);

declare global {
  interface Window {
    cairn: CairnApi;
  }
}
