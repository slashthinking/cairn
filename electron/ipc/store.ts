// Persistent app state via electron-store (PRD §4.1).
//
// Stores: registered workspace paths, terminal preference, theme, AI rename history,
// per-project metadata (cluster / pinned).

import { ipcMain } from "electron";
import Store from "electron-store";
import { validateAbsolutePath } from "../lib/escape.js";

interface Schema {
  workspaces: string[]; // absolute paths
  terminalPreference: string;
  customTerminalCommand?: string;
  theme: "dark" | "light";
  projectMeta: Record<
    string,
    {
      aiName?: string;
      cluster?: string;
      pinned?: boolean;
    }
  >;
  sessionTitles: Record<string, string>; // sessionId → AI-suggested title
  /**
   * Persisted AI cluster results, keyed by workspace path. Re-loaded on
   * startup so users don't pay another LLM call for a list they already
   * organized. Reconciliation against the current project list happens in
   * AppStore on hydrate + after every scanWorkspace.
   */
  clustersByWorkspace: Record<
    string,
    { name: string; projectIds: string[] }[]
  >;
}

const store = new Store<Schema>({
  defaults: {
    workspaces: [],
    terminalPreference: "iterm2",
    theme: "dark",
    projectMeta: {},
    sessionTitles: {},
    clustersByWorkspace: {},
  },
});

export function registerStoreIpc() {
  ipcMain.handle("store:get", (_e, key: keyof Schema) => store.get(key));

  ipcMain.handle("store:set", (_e, key: keyof Schema, value: unknown) => {
    store.set(key, value as Schema[keyof Schema]);
  });

  ipcMain.handle("store:add-workspace", (_e, p: unknown) => {
    const validated = validateAbsolutePath(typeof p === "string" ? p : "");
    const existing = store.get("workspaces");
    if (existing.includes(validated)) return existing;
    // Reject nested registration (PRD §3.1)
    for (const w of existing) {
      if (validated.startsWith(w + "/") || w.startsWith(validated + "/")) {
        throw new Error(`workspace nesting not allowed: conflicts with ${w}`);
      }
    }
    const next = [...existing, validated];
    store.set("workspaces", next);
    return next;
  });

  ipcMain.handle("store:remove-workspace", (_e, p: unknown) => {
    if (typeof p !== "string") throw new Error("path required");
    const next = store.get("workspaces").filter((w) => w !== p);
    store.set("workspaces", next);
    return next;
  });

  ipcMain.handle(
    "store:set-project-meta",
    (
      _e,
      projectPath: unknown,
      meta: Schema["projectMeta"][string],
    ) => {
      if (typeof projectPath !== "string") throw new Error("path required");
      const existing = store.get("projectMeta");
      store.set("projectMeta", { ...existing, [projectPath]: meta });
    },
  );

  ipcMain.handle(
    "store:set-session-title",
    (_e, sessionId: unknown, title: unknown) => {
      if (typeof sessionId !== "string" || typeof title !== "string") {
        throw new Error("both sessionId and title must be strings");
      }
      const existing = store.get("sessionTitles");
      store.set("sessionTitles", { ...existing, [sessionId]: title });
    },
  );
}
