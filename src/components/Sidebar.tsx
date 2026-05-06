import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Folder,
  FolderOpen,
  FolderPlus,
  Play,
  Search,
  Sparkles,
  Terminal,
  Trash2,
} from "lucide-react";
import { basename } from "../lib/path";
import { useMemo, useState } from "react";
import { useApp } from "../store/AppStore";
import { cn } from "../lib/cn";
import { useContextMenu, type MenuItem } from "./ContextMenu";
import { toast } from "./Toast";

interface Props {
  onRequestRename: (target: {
    kind: "project";
    path: string;
    currentName: string;
  }) => void;
}

export function Sidebar({ onRequestRename }: Props) {
  const app = useApp();
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Auto-expand the workspace containing the active project
  const ensuredExpanded = useMemo(() => {
    const out = { ...expanded };
    if (app.selectedWorkspace && out[app.selectedWorkspace] === undefined) {
      out[app.selectedWorkspace] = true;
    }
    return out;
  }, [expanded, app.selectedWorkspace]);

  const filtered = (workspacePath: string) => {
    const list = app.projectsByWorkspace[workspacePath] ?? [];
    if (!filter) return list;
    const q = filter.toLowerCase();
    return list.filter((p) => p.name.toLowerCase().includes(q));
  };

  return (
    <aside className="flex w-[220px] shrink-0 flex-col border-r border-border bg-cc-surface-base p-3">
      <div className="px-1 py-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        Workspaces
      </div>

      <div className="mb-2 flex h-7 items-center gap-1.5 rounded-cc-sm border border-border bg-cc-surface-hover px-3">
        <Search className="h-3 w-3 text-muted-foreground" />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter folders…"
          className="w-full bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
      </div>

      <div className="cc-scroll-thin flex-1 space-y-1 overflow-y-auto pr-1.5">
        {app.workspaces.map((wsPath) => (
          <WorkspaceGroup
            key={wsPath}
            workspacePath={wsPath}
            projects={filtered(wsPath)}
            totalCount={(app.projectsByWorkspace[wsPath] ?? []).length}
            expanded={ensuredExpanded[wsPath] ?? false}
            onToggle={() =>
              setExpanded((e) => ({ ...e, [wsPath]: !ensuredExpanded[wsPath] }))
            }
            onRequestRename={onRequestRename}
          />
        ))}
      </div>

      <button
        onClick={app.registerWorkspace}
        className="mt-3 flex h-9 items-center justify-center gap-2 rounded-cc-sm border border-dashed border-cc-surface-strong bg-cc-surface-hover text-[13px] font-medium text-muted-foreground hover:bg-cc-surface-press"
      >
        <FolderPlus className="h-3.5 w-3.5" />
        Add Workspace
      </button>
    </aside>
  );
}

function WorkspaceGroup({
  workspacePath,
  projects,
  totalCount,
  expanded,
  onToggle,
  onRequestRename,
}: {
  workspacePath: string;
  projects: { path: string; name: string; sessionCount: number }[];
  totalCount: number;
  expanded: boolean;
  onToggle: () => void;
  onRequestRename: Props["onRequestRename"];
}) {
  const app = useApp();
  const wsName = basename(workspacePath);

  return (
    <div>
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 rounded-cc-xs px-1 py-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground hover:bg-cc-surface-hover"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        <Folder className="h-3 w-3" />
        <span className="flex-1 text-left normal-case">{wsName}</span>
        <span className="font-medium text-muted-foreground">{totalCount}</span>
      </button>
      {expanded && (
        <div className="space-y-0.5">
          {projects.map((p) => (
            <ProjectItem
              key={p.path}
              project={p}
              active={app.selectedProject === p.path}
              onSelect={() => app.selectProject(p.path)}
              onRename={() =>
                onRequestRename({
                  kind: "project",
                  path: p.path,
                  currentName: p.name,
                })
              }
            />
          ))}
          {projects.length === 0 && totalCount > 0 && (
            <p className="px-7 py-1 text-[11px] text-muted-foreground">
              No matches.
            </p>
          )}
          {projects.length === 0 && totalCount === 0 && (
            <p className="px-7 py-1 text-[11px] text-muted-foreground">
              No projects yet. Add a sub-folder or click + Add Workspace.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ProjectItem({
  project,
  active,
  onSelect,
  onRename,
}: {
  project: { path: string; name: string; sessionCount: number };
  active: boolean;
  onSelect: () => void;
  onRename: () => void;
}) {
  const app = useApp();
  const menu = useContextMenu();

  function buildMenu(): MenuItem[] {
    const sessions = app.sessionsByProject[project.path] ?? [];
    const latest = sessions[0];
    return [
      {
        label: "Open new session in terminal",
        icon: Terminal,
        onClick: async () => {
          try {
            await window.cairn.startNewSession({
              projectPath: project.path,
              terminal: app.terminalPref,
            });
            toast.success("New session started", project.path);
          } catch (err) {
            toast.error(
              "Couldn't start session",
              err instanceof Error ? err.message : String(err),
            );
          }
        },
      },
      {
        label: latest ? "Resume latest session" : "No sessions to resume",
        icon: Play,
        disabled: !latest,
        onClick: async () => {
          if (!latest) return;
          try {
            await window.cairn.resumeInTerminal({
              terminal: app.terminalPref,
              cwd: project.path,
              sessionId: latest.id,
            });
            toast.success("Resuming session", latest.title ?? latest.id);
          } catch (err) {
            toast.error(
              "Couldn't resume",
              err instanceof Error ? err.message : String(err),
            );
          }
        },
        separatorAfter: true,
      },
      {
        label: "Rename with AI",
        icon: Sparkles,
        onClick: onRename,
      },
      {
        label: "Reveal in Finder",
        icon: ExternalLink,
        onClick: async () => {
          try {
            await window.cairn.revealInFinder(project.path);
          } catch (err) {
            toast.error(
              "Couldn't reveal",
              err instanceof Error ? err.message : String(err),
            );
          }
        },
        separatorAfter: true,
      },
      {
        label: "Remove from Cairn",
        icon: Trash2,
        destructive: true,
        onClick: async () => {
          // Removing the project means forgetting its label; the folder itself
          // stays on disk. We just clear projectMeta — workspace removal is
          // a separate flow.
          await app.setProjectMeta(project.path, {});
          toast.info("Project label cleared", project.path);
        },
      },
    ];
  }

  return (
    <div
      onContextMenu={(e) => menu.open(e, buildMenu())}
      className={cn(
        "group flex w-full items-center gap-2 rounded-cc-sm py-1.5 pl-6 pr-2 text-left text-[13px] font-medium",
        active
          ? "bg-cc-accent text-cc-accent-fg"
          : "text-foreground hover:bg-cc-surface-hover",
      )}
    >
      <button
        onClick={onSelect}
        className="flex flex-1 items-center gap-2 truncate text-left"
      >
        {active ? (
          <FolderOpen className="h-3.5 w-3.5" />
        ) : (
          <Folder className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <span className="flex-1 truncate">{project.name}</span>
      </button>
      <button
        onClick={onRename}
        className={cn(
          "p-0.5",
          active
            ? "opacity-80 hover:opacity-100"
            : "opacity-0 transition-opacity group-hover:opacity-100",
        )}
        aria-label="Rename with AI"
      >
        <Sparkles
          className={cn(
            "h-3 w-3",
            active ? "text-cc-text-on-accent-soft" : "text-cc-claude",
          )}
        />
      </button>
      <span
        className={cn(
          "text-[11px] font-medium",
          active ? "text-cc-text-on-accent-soft" : "text-muted-foreground",
        )}
      >
        {project.sessionCount}
      </span>
    </div>
  );
}
