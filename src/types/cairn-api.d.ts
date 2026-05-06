// Type declarations for the preload bridge surface.
// Mirror of electron/preload.ts CairnApi — kept in sync manually.

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
  kind: "primary" | "subagent";
  archive: boolean;
  folderDeleted: boolean;
  forkedFrom: { sessionId: string; messageUuid: string } | null;
  title: string | null;
  customTitle: string | null;
  launchedFrom: string | null;
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

export interface CairnApi {
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

  detectClaude: () => Promise<boolean>;
  renameSuggestions: (payload: RenamePayload) => Promise<SuggestionsResponse>;
  clusterProjects: (payload: ClusterPayload) => Promise<ClusterResponse>;

  listTerminals: () => Promise<InstalledTerminals>;
  resumeInTerminal: (payload: ResumePayload) => Promise<void>;
  startNewProject: (payload: NewProjectPayload) => Promise<string>;
  startNewSession: (payload: {
    projectPath: string;
    initialPrompt?: string;
    terminal: string;
  }) => Promise<void>;

  storeGet: <K extends keyof StoreSchema>(key: K) => Promise<StoreSchema[K]>;
  storeSet: <K extends keyof StoreSchema>(
    key: K,
    value: StoreSchema[K],
  ) => Promise<void>;
  addWorkspace: (path: string) => Promise<string[]>;
  removeWorkspace: (path: string) => Promise<string[]>;
  setProjectMeta: (path: string, meta: ProjectMeta) => Promise<void>;
  setSessionTitle: (sessionId: string, title: string) => Promise<void>;

  getUsername: () => Promise<string | null>;

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

declare global {
  interface Window {
    cairn: CairnApi;
  }
}
