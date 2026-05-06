// App-wide state. Plain React context (no extra deps).
// Hydrates from electron-store on mount; mutations call IPC and update local state.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  AllSession,
  Project,
  Session,
  StoreSchema,
} from "../types/cairn-api";

interface Cluster {
  name: string;
  projectIds: string[];
}

/**
 * Keep a persisted cluster list aligned with the current project list:
 *   - drop projectIds that no longer exist (folder renamed / removed)
 *   - append newcomers to a synthetic "Unsorted" group at the end so the
 *     user can see what the AI hasn't seen yet
 *   - drop any cluster that becomes empty after pruning
 *
 * Pure function so it's safe to run on every `scanWorkspace` cycle.
 */
function reconcileClusters(
  cached: Cluster[],
  liveProjects: { path: string }[],
): Cluster[] {
  const livePaths = new Set(liveProjects.map((p) => p.path));
  const placed = new Set<string>();
  const out: Cluster[] = [];
  for (const c of cached) {
    const surviving = c.projectIds.filter((id) => livePaths.has(id));
    surviving.forEach((id) => placed.add(id));
    if (surviving.length > 0) {
      out.push({ name: c.name, projectIds: surviving });
    }
  }
  const unsorted = liveProjects
    .map((p) => p.path)
    .filter((id) => !placed.has(id));
  if (unsorted.length > 0) {
    out.push({ name: "Unsorted", projectIds: unsorted });
  }
  return out;
}

interface State {
  ready: boolean;
  view: "main" | "home" | "all-sessions" | "workspaces" | "session";
  workspaces: string[]; // absolute paths
  projectsByWorkspace: Record<string, Project[]>;
  sessionsByProject: Record<string, Session[]>;
  clustersByWorkspace: Record<string, Cluster[] | "loading" | undefined>;
  allSessions: AllSession[] | "loading" | null;

  selectedWorkspace: string | null;
  selectedProject: string | null;
  selectedSession: string | null;

  terminalPref: string;
  theme: "dark" | "light";
  projectMeta: StoreSchema["projectMeta"];
  sessionTitles: StoreSchema["sessionTitles"];

  claudeAvailable: boolean;
  username: string | null;
}

interface Actions {
  registerWorkspace: () => Promise<void>;
  removeWorkspace: (path: string) => Promise<void>;
  selectWorkspace: (path: string | null) => void;
  selectProject: (path: string | null) => Promise<void>;
  selectSession: (id: string | null) => void;
  setTerminalPref: (t: string) => Promise<void>;
  setTheme: (t: "dark" | "light") => Promise<void>;
  refreshSessions: (projectPath: string) => Promise<void>;
  refreshAll: () => Promise<void>;
  setView: (v: "main" | "home" | "all-sessions" | "workspaces" | "session") => void;
  loadAllSessions: () => Promise<void>;
  runClustering: (workspacePath: string) => Promise<void>;
  setSessionTitle: (sessionId: string, title: string) => Promise<void>;
  setProjectMeta: (
    projectPath: string,
    meta: StoreSchema["projectMeta"][string],
  ) => Promise<void>;
  renameProjectOnDisk: (
    oldPath: string,
    newName: string,
  ) => Promise<string>;
}

const Ctx = createContext<(State & Actions) | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>({
    ready: false,
    // Default to Workspaces Home (dashboard). User picks a project from there
    // to drop into the three-pane MainView.
    view: "home",
    workspaces: [],
    projectsByWorkspace: {},
    sessionsByProject: {},
    clustersByWorkspace: {},
    allSessions: null,
    selectedWorkspace: null,
    selectedProject: null,
    selectedSession: null,
    terminalPref: "iterm2",
    theme: "dark",
    projectMeta: {},
    sessionTitles: {},
    claudeAvailable: false,
    username: null,
  });

  // Hydrate from store on mount. Resilient to IPC failures — `ready: true` is
  // set unconditionally so the user always reaches the UI even if some calls fail.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const safe = async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
        try {
          return await fn();
        } catch (err) {
          console.error("[AppStore IPC]", err);
          return fallback;
        }
      };

      // Bail early if preload didn't expose window.cairn at all.
      if (typeof window.cairn !== "object" || window.cairn === null) {
        console.error("[AppStore] window.cairn is missing — preload failed.");
        if (!cancelled) setState((s) => ({ ...s, ready: true }));
        return;
      }

      const [
        workspaces,
        terminalPref,
        theme,
        projectMeta,
        sessionTitles,
        persistedClusters,
        claudeAvailable,
        username,
      ] = await Promise.all([
        safe(() => window.cairn.storeGet("workspaces"), [] as string[]),
        safe(() => window.cairn.storeGet("terminalPreference"), "iterm2"),
        safe(
          () => window.cairn.storeGet("theme"),
          "dark" as "dark" | "light",
        ),
        safe(
          () => window.cairn.storeGet("projectMeta"),
          {} as State["projectMeta"],
        ),
        safe(
          () => window.cairn.storeGet("sessionTitles"),
          {} as State["sessionTitles"],
        ),
        safe(
          () => window.cairn.storeGet("clustersByWorkspace"),
          {} as StoreSchema["clustersByWorkspace"],
        ),
        safe(() => window.cairn.detectClaude(), false),
        safe(() => window.cairn.getUsername(), null as string | null),
      ]);
      if (cancelled) return;

      const projectsByWorkspace: Record<string, Project[]> = {};
      for (const ws of workspaces) {
        projectsByWorkspace[ws] = await safe(
          () => window.cairn.scanWorkspace(ws),
          [],
        );
      }

      const firstWs = workspaces[0] ?? null;
      const firstProj =
        firstWs ? projectsByWorkspace[firstWs]?.[0]?.path ?? null : null;

      // Eager-load sessions for ALL projects so the dashboard's "Jump back in"
      // rail and recent activity ordering work without the user having to
      // click into each project first. Each call is a directory read; the
      // total is fast even with 60+ projects on a developer machine.
      const allProjects: Project[] = Object.values(projectsByWorkspace).flat();
      const sessionLists = await Promise.all(
        allProjects.map((p) =>
          safe(() => window.cairn.listSessions(p.path), [] as Session[]),
        ),
      );
      const sessionsByProject: Record<string, Session[]> = {};
      allProjects.forEach((p, i) => {
        sessionsByProject[p.path] = sessionLists[i] ?? [];
      });

      // Reconcile each workspace's persisted cluster list against the live
      // project list — drop projectIds that no longer exist on disk and
      // append unsorted (newly-added) ones to a synthetic "Unsorted" group.
      // Re-runs of `runClustering` will replace this with the AI's answer.
      const clustersByWorkspace: State["clustersByWorkspace"] = {};
      for (const ws of workspaces) {
        const cached = persistedClusters[ws];
        if (!cached) continue;
        clustersByWorkspace[ws] = reconcileClusters(
          cached,
          projectsByWorkspace[ws] ?? [],
        );
      }

      if (cancelled) return;
      setState((s) => ({
        ...s,
        ready: true,
        workspaces,
        projectsByWorkspace,
        sessionsByProject,
        clustersByWorkspace,
        selectedWorkspace: firstWs,
        selectedProject: firstProj,
        selectedSession:
          sessionsByProject[firstProj ?? ""]?.[0]?.id ?? null,
        terminalPref,
        theme,
        projectMeta,
        sessionTitles,
        claudeAvailable,
        username,
      }));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Apply theme to <html>
  useEffect(() => {
    document.documentElement.classList.toggle("dark", state.theme === "dark");
    document.documentElement.classList.toggle("light", state.theme === "light");
  }, [state.theme]);

  const registerWorkspace = useCallback(async () => {
    const picked = await window.cairn.pickFolder();
    if (!picked) return;
    const next = await window.cairn.addWorkspace(picked);
    const projects = await window.cairn.scanWorkspace(picked);
    setState((s) => ({
      ...s,
      workspaces: next,
      projectsByWorkspace: { ...s.projectsByWorkspace, [picked]: projects },
      selectedWorkspace: s.selectedWorkspace ?? picked,
    }));
  }, []);

  const removeWorkspace = useCallback(async (path: string) => {
    const next = await window.cairn.removeWorkspace(path);
    setState((s) => {
      const { [path]: _gone, ...rest } = s.projectsByWorkspace;
      return {
        ...s,
        workspaces: next,
        projectsByWorkspace: rest,
        selectedWorkspace:
          s.selectedWorkspace === path ? next[0] ?? null : s.selectedWorkspace,
      };
    });
  }, []);

  const selectWorkspace = useCallback((path: string | null) => {
    setState((s) => ({ ...s, selectedWorkspace: path }));
  }, []);

  const refreshSessions = useCallback(async (projectPath: string) => {
    try {
      const sessions = await window.cairn.listSessions(projectPath);
      setState((s) => ({
        ...s,
        sessionsByProject: { ...s.sessionsByProject, [projectPath]: sessions },
      }));
    } catch (err) {
      console.error("refreshSessions:", err);
    }
  }, []);

  // Re-scan every workspace + reload every project's sessions. Used by the
  // titlebar Refresh button on the dashboard, where there's no single
  // selectedProject to refresh.
  const refreshAll = useCallback(async () => {
    try {
      const projectsByWorkspace: Record<string, Project[]> = {};
      for (const ws of state.workspaces) {
        try {
          projectsByWorkspace[ws] = await window.cairn.scanWorkspace(ws);
        } catch {
          projectsByWorkspace[ws] = state.projectsByWorkspace[ws] ?? [];
        }
      }
      const allProjects = Object.values(projectsByWorkspace).flat();
      const lists = await Promise.all(
        allProjects.map((p) =>
          window.cairn.listSessions(p.path).catch(() => []),
        ),
      );
      const sessionsByProject: Record<string, Session[]> = {};
      allProjects.forEach((p, i) => {
        sessionsByProject[p.path] = lists[i] ?? [];
      });
      setState((s) => {
        // Reconcile every workspace's cluster list against the new project
        // list. Loading state is preserved if the user kicked off a re-run.
        const nextClusters: State["clustersByWorkspace"] = {};
        for (const [ws, current] of Object.entries(s.clustersByWorkspace)) {
          if (current === "loading" || current === undefined) {
            nextClusters[ws] = current;
            continue;
          }
          nextClusters[ws] = reconcileClusters(
            current,
            projectsByWorkspace[ws] ?? [],
          );
        }
        // Persist the reconciled snapshot so unsorted/dropped projects survive
        // a relaunch without re-running the LLM.
        const persistable: StoreSchema["clustersByWorkspace"] = {};
        for (const [k, v] of Object.entries(nextClusters)) {
          if (Array.isArray(v)) persistable[k] = v;
        }
        void window.cairn.storeSet("clustersByWorkspace", persistable);
        return {
          ...s,
          projectsByWorkspace,
          sessionsByProject,
          clustersByWorkspace: nextClusters,
        };
      });
    } catch (err) {
      console.error("refreshAll:", err);
    }
  }, [state.workspaces, state.projectsByWorkspace]);

  const selectProject = useCallback(
    async (path: string | null) => {
      setState((s) => ({ ...s, selectedProject: path, selectedSession: null }));
      if (path) {
        await refreshSessions(path);
        setState((s) => ({
          ...s,
          selectedSession: s.sessionsByProject[path]?.[0]?.id ?? null,
        }));
      }
    },
    [refreshSessions],
  );

  const selectSession = useCallback((id: string | null) => {
    setState((s) => ({ ...s, selectedSession: id }));
  }, []);

  const setTerminalPref = useCallback(async (t: string) => {
    await window.cairn.storeSet("terminalPreference", t);
    setState((s) => ({ ...s, terminalPref: t }));
  }, []);

  const setTheme = useCallback(async (t: "dark" | "light") => {
    await window.cairn.storeSet("theme", t);
    setState((s) => ({ ...s, theme: t }));
  }, []);

  const setView = useCallback(
    (v: "main" | "home" | "all-sessions" | "workspaces" | "session") => {
      setState((s) => ({ ...s, view: v }));
    },
    [],
  );

  const loadAllSessions = useCallback(async () => {
    setState((s) => ({ ...s, allSessions: "loading" }));
    try {
      const list = await window.cairn.listAllSessions();
      setState((s) => ({ ...s, allSessions: list }));
    } catch (err) {
      console.error("loadAllSessions:", err);
      setState((s) => ({ ...s, allSessions: [] }));
    }
  }, []);

  const runClustering = useCallback(async (workspacePath: string) => {
    const projects = state.projectsByWorkspace[workspacePath] ?? [];
    if (projects.length === 0) return;
    setState((s) => ({
      ...s,
      clustersByWorkspace: {
        ...s.clustersByWorkspace,
        [workspacePath]: "loading",
      },
    }));
    try {
      // For each project, fetch its sessions for first prompts (cached if already loaded)
      const projectInputs = await Promise.all(
        projects.slice(0, 30).map(async (p) => {
          const sessions =
            state.sessionsByProject[p.path] ??
            (await window.cairn.listSessions(p.path).catch(() => []));
          const firstPrompts = sessions
            .filter((s) => s.title)
            .slice(0, 3)
            .map((s) => s.title!.slice(0, 100));
          return { id: p.path, name: p.name, firstPrompts };
        }),
      );
      const result = await window.cairn.clusterProjects({
        workspace: workspacePath,
        projects: projectInputs,
      });
      // Reconcile against the live project list before persisting — defensive
      // in case the project list shifted during the LLM call.
      const reconciled = reconcileClusters(result.clusters, projects);
      setState((s) => {
        const next = {
          ...s.clustersByWorkspace,
          [workspacePath]: reconciled,
        };
        // Persist only the non-loading entries (loading is a transient UI state).
        const persistable: StoreSchema["clustersByWorkspace"] = {};
        for (const [k, v] of Object.entries(next)) {
          if (Array.isArray(v)) persistable[k] = v;
        }
        void window.cairn.storeSet("clustersByWorkspace", persistable);
        return { ...s, clustersByWorkspace: next };
      });
    } catch (err) {
      console.error("[runClustering]", err);
      setState((s) => ({
        ...s,
        clustersByWorkspace: {
          ...s.clustersByWorkspace,
          [workspacePath]: undefined,
        },
      }));
      throw err;
    }
  }, [state.projectsByWorkspace, state.sessionsByProject]);

  const setSessionTitle = useCallback(
    async (sessionId: string, title: string) => {
      await window.cairn.setSessionTitle(sessionId, title);
      setState((s) => ({
        ...s,
        sessionTitles: { ...s.sessionTitles, [sessionId]: title },
      }));
    },
    [],
  );

  const setProjectMeta = useCallback(
    async (
      projectPath: string,
      meta: StoreSchema["projectMeta"][string],
    ) => {
      await window.cairn.setProjectMeta(projectPath, meta);
      setState((s) => ({
        ...s,
        projectMeta: { ...s.projectMeta, [projectPath]: meta },
      }));
    },
    [],
  );

  // Disk rename of a project folder: mv on disk + remap encoded session dir, then
  // patch every store entry keyed by the old absolute path so the UI stays consistent.
  const renameProjectOnDisk = useCallback(
    async (oldPath: string, newName: string): Promise<string> => {
      const newPath = await window.cairn.renameProject(oldPath, newName);
      setState((s) => {
        const newProjectsByWorkspace: Record<string, Project[]> = {};
        for (const [ws, list] of Object.entries(s.projectsByWorkspace)) {
          newProjectsByWorkspace[ws] = list.map((p) =>
            p.path === oldPath ? { ...p, path: newPath, name: newName } : p,
          );
        }
        const sessions = s.sessionsByProject[oldPath];
        const newSessionsByProject = { ...s.sessionsByProject };
        if (sessions) {
          delete newSessionsByProject[oldPath];
          newSessionsByProject[newPath] = sessions.map((sess) => ({
            ...sess,
            projectPath: newPath,
          }));
        }
        const oldMeta = s.projectMeta[oldPath];
        const newProjectMeta = { ...s.projectMeta };
        if (oldMeta) {
          delete newProjectMeta[oldPath];
          newProjectMeta[newPath] = oldMeta;
        }
        return {
          ...s,
          projectsByWorkspace: newProjectsByWorkspace,
          sessionsByProject: newSessionsByProject,
          projectMeta: newProjectMeta,
          selectedProject:
            s.selectedProject === oldPath ? newPath : s.selectedProject,
        };
      });
      return newPath;
    },
    [],
  );

  const value = useMemo<State & Actions>(
    () => ({
      ...state,
      registerWorkspace,
      removeWorkspace,
      selectWorkspace,
      selectProject,
      selectSession,
      setTerminalPref,
      setTheme,
      refreshSessions,
      setView,
      loadAllSessions,
      runClustering,
      setSessionTitle,
      setProjectMeta,
      renameProjectOnDisk,
      refreshAll,
    }),
    [
      state,
      registerWorkspace,
      removeWorkspace,
      selectWorkspace,
      selectProject,
      selectSession,
      setTerminalPref,
      setTheme,
      refreshSessions,
      setView,
      loadAllSessions,
      runClustering,
      setSessionTitle,
      setProjectMeta,
      renameProjectOnDisk,
      refreshAll,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): State & Actions {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp must be used inside <AppProvider>");
  return ctx;
}
