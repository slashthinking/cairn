// V2-K Workspaces page (Pencil amOyr).
// Hero (counts + Add workspace) + per-workspace card with project list + Unsorted section.

import {
  ChevronLeft,
  ChevronRight,
  Folder,
  FolderPlus,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { TitleBar } from "../components/TitleBar";
import { useApp } from "../store/AppStore";
import { toast } from "../components/Toast";
import { basename, formatRelativeTime } from "../lib/path";
import type { AllSession, Project } from "../types/cairn-api";

interface Props {
  onOpenSettings: () => void;
  onOpenHelp: () => void;
  onOpenQuickStart: () => void;
}

const PROJECT_ROW_LIMIT = 5;

export function WorkspacesView({
  onOpenSettings,
  onOpenHelp,
  onOpenQuickStart,
}: Props) {
  const app = useApp();

  const totalProjects = app.workspaces.reduce(
    (sum, ws) => sum + (app.projectsByWorkspace[ws]?.length ?? 0),
    0,
  );
  const totalSessions = app.workspaces.reduce(
    (sum, ws) =>
      sum +
      (app.projectsByWorkspace[ws] ?? []).reduce(
        (s, p) => s + p.sessionCount,
        0,
      ),
    0,
  );

  // Unsorted = primary live sessions whose dominantCwd is NOT under any
  // registered workspace path. Group by 2-segment cwd basename for display.
  const unsorted = useMemo(() => {
    const all = Array.isArray(app.allSessions) ? app.allSessions : [];
    const buckets = new Map<string, AllSession[]>();
    for (const s of all) {
      if (s.kind !== "primary" || s.archive || s.folderDeleted) continue;
      const cwd = s.dominantCwd;
      if (!cwd) continue;
      const isUnderRegistered = app.workspaces.some(
        (w) => cwd === w || cwd.startsWith(w.replace(/\/+$/, "") + "/"),
      );
      if (isUnderRegistered) continue;
      // Bucket key = parent dir of the session's project.
      const projectDir = cwd; // already a full path; cluster on parent
      const parent = projectDir.replace(/\/[^/]+\/?$/, "");
      const key = parent || projectDir;
      const arr = buckets.get(key) ?? [];
      arr.push(s);
      buckets.set(key, arr);
    }
    return [...buckets.entries()]
      .map(([parent, sessions]) => ({ parent, sessions }))
      .sort((a, b) => b.sessions.length - a.sessions.length)
      .slice(0, 8);
  }, [app.allSessions, app.workspaces]);

  async function handleAddWorkspace() {
    try {
      await app.registerWorkspace();
    } catch (err) {
      toast.error(
        "Couldn't add workspace",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  async function handleAdoptUnsorted(parent: string) {
    try {
      await window.cairn.addWorkspace(parent);
      await app.refreshAll();
      toast.success("Workspace registered", parent);
    } catch (err) {
      toast.error(
        "Couldn't register workspace",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  function jumpToProject(projectPath: string) {
    app.selectProject(projectPath);
    app.setView("main");
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <TitleBar
        theme={app.theme}
        onToggleTheme={() => app.setTheme(app.theme === "dark" ? "light" : "dark")}
        onOpenSettings={onOpenSettings}
        onOpenHelp={onOpenHelp}
        onOpenHome={() => app.setView("home")}
        onOpenAllSessions={() => {
          app.setView("all-sessions");
          void app.loadAllSessions();
        }}
        onRefresh={async () => {
          try {
            await app.refreshAll();
            await app.loadAllSessions();
            toast.success("Refreshed");
          } catch (err) {
            toast.error("Refresh failed", err instanceof Error ? err.message : String(err));
          }
        }}
        view="home"
      />

      <div className="cc-scroll-thin flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[920px] flex-col gap-3 px-5 py-4">
          {/* Hero */}
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex items-baseline gap-3">
              <button
                onClick={() => app.setView("home")}
                className="flex w-fit items-center gap-1.5 text-[11.5px] text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft className="h-3 w-3" />
                Home
              </button>
              <h1 className="text-[20px] font-semibold leading-tight tracking-[-0.2px] text-foreground">
                {app.workspaces.length} workspace
                {app.workspaces.length === 1 ? "" : "s"} ·{" "}
                {totalProjects} project{totalProjects === 1 ? "" : "s"} ·{" "}
                {totalSessions} session{totalSessions === 1 ? "" : "s"}
              </h1>
            </div>
            <button
              onClick={handleAddWorkspace}
              className="flex items-center gap-1.5 rounded-cc-sm border border-border bg-cc-surface-elevated px-2.5 py-1 text-[11.5px] font-medium text-foreground hover:bg-cc-surface-press"
            >
              <Plus className="h-3 w-3" />
              Add workspace
            </button>
          </div>

          {/* Workspace cards */}
          {app.workspaces.map((ws) => (
            <WorkspaceCard
              key={ws}
              workspacePath={ws}
              projects={app.projectsByWorkspace[ws] ?? []}
              sessionsByProject={app.sessionsByProject}
              onJumpProject={jumpToProject}
              onCreateFolder={() => {
                app.selectWorkspace(ws);
                onOpenQuickStart();
              }}
            />
          ))}

          {/* Unsorted */}
          {unsorted.length > 0 && (
            <UnsortedCard
              groups={unsorted}
              onAdopt={handleAdoptUnsorted}
              onCleanup={() => {
                app.setView("all-sessions");
                void app.loadAllSessions();
              }}
            />
          )}

          {app.workspaces.length === 0 && (
            <div className="rounded-[14px] border border-dashed border-border bg-cc-card px-6 py-12 text-center text-[13px] text-muted-foreground">
              No workspaces registered yet. Click <strong>Add workspace</strong> above.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Workspace card --------------------------------------------------

function WorkspaceCard({
  workspacePath,
  projects,
  sessionsByProject,
  onJumpProject,
  onCreateFolder,
}: {
  workspacePath: string;
  projects: Project[];
  sessionsByProject: ReturnType<typeof useApp>["sessionsByProject"];
  onJumpProject: (path: string) => void;
  onCreateFolder: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const sessionsTotal = projects.reduce((sum, p) => sum + p.sessionCount, 0);

  // Sort projects by most recent session activity.
  const orderedProjects = useMemo(() => {
    return [...projects].sort((a, b) => {
      const lastA = sessionsByProject[a.path]?.[0]?.lastActive ?? 0;
      const lastB = sessionsByProject[b.path]?.[0]?.lastActive ?? 0;
      return lastB - lastA;
    });
  }, [projects, sessionsByProject]);

  const visible = expanded
    ? orderedProjects
    : orderedProjects.slice(0, PROJECT_ROW_LIMIT);
  const hidden = orderedProjects.length - visible.length;

  return (
    <div className="overflow-hidden rounded-[10px] border border-border bg-cc-card">
      {/* Header */}
      <div className="flex items-baseline gap-3 border-b border-border px-4 py-2.5">
        <h2 className="text-[15px] font-semibold leading-tight text-foreground">
          {basename(workspacePath)}
        </h2>
        <p className="text-[11px] text-muted-foreground">
          {projects.length} project{projects.length === 1 ? "" : "s"} ·{" "}
          {sessionsTotal} session{sessionsTotal === 1 ? "" : "s"}
        </p>
        <span className="grow" />
        <button
          onClick={onCreateFolder}
          className="flex items-center gap-1.5 rounded-cc-sm border border-border bg-cc-surface-elevated px-2.5 py-1 text-[11.5px] font-medium text-muted-foreground hover:bg-cc-surface-press hover:text-foreground"
        >
          <FolderPlus className="h-3 w-3" />
          New folder
        </button>
      </div>

      {/* Project rows */}
      {projects.length === 0 ? (
        <p className="px-4 py-4 text-center text-[11.5px] text-muted-foreground">
          No projects yet — start a session via <strong>New folder</strong>.
        </p>
      ) : (
        <div className="px-3">
          {visible.map((p) => (
            <ProjectRow
              key={p.path}
              project={p}
              lastActive={sessionsByProject[p.path]?.[0]?.lastActive ?? 0}
              onClick={() => onJumpProject(p.path)}
            />
          ))}
        </div>
      )}

      {/* Footer */}
      {hidden > 0 && (
        <div className="flex items-center justify-end border-t border-border px-4 py-2">
          <button
            onClick={() => setExpanded(true)}
            className="flex items-center gap-1 text-[11.5px] font-medium text-cc-accent-light hover:underline"
          >
            See all {projects.length}
            <ChevronRight className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}

function ProjectRow({
  project,
  lastActive,
  onClick,
}: {
  project: Project;
  lastActive: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2.5 border-b border-border last:border-b-0 px-1 py-1.5 text-left hover:bg-cc-surface-hover"
    >
      <Folder className="h-3 w-3 text-muted-foreground" />
      <span className="truncate text-[12.5px] font-medium text-foreground">
        {project.name}
      </span>
      <span className="shrink-0 text-[10.5px] text-muted-foreground">
        {project.sessionCount} session{project.sessionCount === 1 ? "" : "s"}
      </span>
      <span className="grow" />
      <span className="shrink-0 text-[10.5px] text-muted-foreground">
        {lastActive ? `${formatRelativeTime(lastActive)} ago` : "—"}
      </span>
      <ChevronRight className="h-3 w-3 text-muted-foreground" />
    </button>
  );
}

// ---------- Unsorted (orange-tinted) ----------------------------------------

function UnsortedCard({
  groups,
  onAdopt,
  onCleanup,
}: {
  groups: { parent: string; sessions: AllSession[] }[];
  onAdopt: (parent: string) => Promise<void>;
  onCleanup: () => void;
}) {
  const totalSessions = groups.reduce((s, g) => s + g.sessions.length, 0);
  return (
    <div
      className="overflow-hidden rounded-[14px]"
      style={{
        backgroundColor: "#F0934010",
        border: "1px solid #F0934026",
      }}
    >
      <div
        className="flex items-center gap-3 px-6 py-5"
        style={{ borderBottom: "1px solid #F0934026" }}
      >
        <Sparkles className="h-4 w-4 text-cc-claude" />
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[16px] font-semibold leading-tight text-foreground">
            Unsorted ({totalSessions} session
            {totalSessions === 1 ? "" : "s"})
          </h2>
          <p className="text-[11.5px] text-muted-foreground">
            Sessions launched outside any registered workspace — adopt or clean
            up
          </p>
        </div>
        <span className="grow" />
        <button
          onClick={onCleanup}
          className="flex items-center gap-1.5 rounded-cc-sm border border-border bg-cc-surface-elevated px-2.5 py-1.5 text-[11.5px] font-medium text-muted-foreground hover:text-foreground"
        >
          <Trash2 className="h-3 w-3" />
          Open Cleanup
        </button>
      </div>
      <div className="px-6 py-2">
        {groups.map((g) => (
          <UnsortedRow
            key={g.parent}
            parent={g.parent}
            sessionCount={g.sessions.length}
            onAdopt={() => onAdopt(g.parent)}
          />
        ))}
      </div>
    </div>
  );
}

function UnsortedRow({
  parent,
  sessionCount,
  onAdopt,
}: {
  parent: string;
  sessionCount: number;
  onAdopt: () => void;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-border last:border-b-0 px-1 py-3">
      <Folder className="h-3.5 w-3.5 text-cc-claude" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-mono text-[12px] font-medium text-foreground">
          {parent || "(root)"}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {sessionCount} session{sessionCount === 1 ? "" : "s"} found here
        </span>
      </div>
      <button
        onClick={onAdopt}
        className="shrink-0 rounded-cc-sm border border-border bg-cc-surface-elevated px-2.5 py-1 text-[11.5px] font-medium text-foreground hover:bg-cc-surface-press"
      >
        Add as workspace
      </button>
    </div>
  );
}
