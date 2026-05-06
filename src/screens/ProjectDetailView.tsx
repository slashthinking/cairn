// V2-K Project detail (Pencil x6TbKl).
// Breadcrumb + hero + filter chips + day-grouped session list + sticky resume bar.

import {
  ChevronLeft,
  Copy,
  GitBranch,
  GitFork,
  MoreVertical,
  Play,
  Plus,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import { TitleBar } from "../components/TitleBar";
import { useApp } from "../store/AppStore";
import { toast } from "../components/Toast";
import { basename, formatRelativeTime } from "../lib/path";
import { cn } from "../lib/cn";
import type { Session } from "../types/cairn-api";

interface Props {
  onOpenSettings: () => void;
  onOpenHelp: () => void;
  onOpenQuickStart: () => void;
  onRequestRename: (target: {
    kind: "session";
    id: string;
    currentTitle: string;
    projectPath: string;
  }) => void;
}

type Filter = "all" | "active" | "forks" | "stale";

export function ProjectDetailView({
  onOpenSettings,
  onOpenHelp,
  onOpenQuickStart: _onOpenQuickStart,
  onRequestRename,
}: Props) {
  const app = useApp();
  const projectPath = app.selectedProject;
  const sessions = projectPath ? app.sessionsByProject[projectPath] ?? [] : [];
  const projectName = projectPath ? basename(projectPath) : "(no project)";
  const workspacePath = useMemo(() => {
    if (!projectPath) return null;
    return (
      app.workspaces.find(
        (w) =>
          projectPath === w ||
          projectPath.startsWith(w.replace(/\/+$/, "") + "/"),
      ) ?? null
    );
  }, [app.workspaces, projectPath]);

  const [filter, setFilter] = useState<Filter>("all");

  const counts = useMemo(() => {
    const now = Date.now();
    const STALE_MS = 7 * 24 * 60 * 60 * 1000;
    let active = 0,
      forks = 0,
      stale = 0;
    for (const s of sessions) {
      // Heuristic: lastActive within 5 min and message count > 0 = active
      if (now - s.lastActive < 5 * 60 * 1000 && s.messageCount > 0) active++;
      if (s.forkedFrom) forks++;
      if (now - s.lastActive > STALE_MS) stale++;
    }
    return { active, forks, stale };
  }, [sessions]);

  const filtered = useMemo(() => {
    const now = Date.now();
    return sessions.filter((s) => {
      if (filter === "all") return true;
      if (filter === "active")
        return now - s.lastActive < 5 * 60 * 1000 && s.messageCount > 0;
      if (filter === "forks") return !!s.forkedFrom;
      if (filter === "stale") return now - s.lastActive > 7 * 24 * 60 * 60 * 1000;
      return true;
    });
  }, [sessions, filter]);

  const grouped = useMemo(() => groupByDay(filtered), [filtered]);
  const lastResumable = sessions[0] ?? null;

  async function handleNewSession() {
    if (!projectPath) return;
    try {
      await window.cairn.startNewSession({
        projectPath,
        terminal: app.terminalPref,
      });
      toast.success("New session started", projectPath);
    } catch (err) {
      toast.error(
        "Couldn't start session",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  async function handleResumeRecent() {
    if (!projectPath || !lastResumable) {
      toast.info("Nothing to resume yet");
      return;
    }
    try {
      await window.cairn.resumeInTerminal({
        terminal: app.terminalPref,
        cwd: projectPath,
        sessionId: lastResumable.id,
      });
      toast.success("Resuming", lastResumable.title ?? "(untitled)");
    } catch (err) {
      toast.error(
        "Couldn't resume",
        err instanceof Error ? err.message : String(err),
      );
    }
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
          if (projectPath) {
            try {
              await app.refreshSessions(projectPath);
              toast.success("Refreshed");
            } catch (err) {
              toast.error("Refresh failed", err instanceof Error ? err.message : String(err));
            }
          }
        }}
        view="main"
      />

      <div className="cc-scroll-thin flex-1 overflow-y-auto pb-24">
        <div className="mx-auto flex max-w-[920px] flex-col gap-3 px-5 py-4">
          {/* Breadcrumb */}
          <button
            onClick={() => app.setView("workspaces")}
            className="flex w-fit items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-3 w-3" />
            {workspacePath ? basename(workspacePath) : "Workspaces"} /{" "}
            <span className="text-foreground">{projectName}</span>
          </button>

          {/* Hero */}
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex items-baseline gap-3">
              <h1
                className="text-[22px] font-semibold leading-tight tracking-[-0.3px] text-foreground"
                style={{ fontFamily: "Source Serif 4, Newsreader, ui-serif, serif" }}
              >
                {projectName}
              </h1>
              <p className="text-[11.5px] text-muted-foreground">
                {sessions.length} session{sessions.length === 1 ? "" : "s"}
                {counts.active > 0 && ` · ${counts.active} active`}
                {counts.forks > 0 && ` · ${counts.forks} fork${counts.forks === 1 ? "" : "s"}`}
                {counts.stale > 0 && ` · ${counts.stale} stale`}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleNewSession}
                className="flex items-center gap-1.5 rounded-cc-sm border border-border bg-cc-surface-elevated px-2.5 py-1 text-[11.5px] font-medium text-foreground hover:bg-cc-surface-press"
              >
                <Plus className="h-3 w-3" />
                New session
              </button>
              <button
                onClick={handleResumeRecent}
                className="flex items-center gap-1.5 rounded-cc-sm bg-cc-accent px-2.5 py-1 text-[11.5px] font-semibold text-cc-accent-fg hover:opacity-90"
              >
                <Play className="h-3 w-3" />
                Resume recent
              </button>
            </div>
          </div>

          {/* Filter chips */}
          <div className="flex items-center gap-1.5">
            <Chip selected={filter === "all"} onClick={() => setFilter("all")}>
              All {sessions.length}
            </Chip>
            <Chip
              selected={filter === "active"}
              onClick={() => setFilter("active")}
            >
              Active {counts.active}
            </Chip>
            <Chip selected={filter === "forks"} onClick={() => setFilter("forks")}>
              <GitFork className="h-3 w-3" />
              Forks {counts.forks}
            </Chip>
            <Chip selected={filter === "stale"} onClick={() => setFilter("stale")}>
              Stale {counts.stale}
            </Chip>
          </div>

          {/* Grouped session list */}
          {filtered.length === 0 && (
            <div className="rounded-[14px] border border-dashed border-border bg-cc-card px-6 py-12 text-center text-[12.5px] text-muted-foreground">
              No sessions match this filter.
            </div>
          )}

          {grouped.map((group) => (
            <div key={group.label} className="flex flex-col gap-1">
              <h3 className="px-1 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                {group.label}
                <span className="ml-1.5 text-muted-foreground/60">
                  · {group.sessions.length}
                </span>
              </h3>
              <div className="flex flex-col rounded-[10px] border border-border bg-cc-card">
                {group.sessions.map((s, i) => (
                  <SessionRow
                    key={s.id}
                    session={s}
                    projectPath={projectPath ?? ""}
                    isFirst={i === 0}
                    onSelect={() => {
                      app.selectSession(s.id);
                      app.setView("session");
                    }}
                    onRequestRename={() =>
                      onRequestRename({
                        kind: "session",
                        id: s.id,
                        currentTitle: s.title ?? "(untitled)",
                        projectPath: projectPath ?? "",
                      })
                    }
                    onResume={async () => {
                      if (!projectPath) return;
                      try {
                        await window.cairn.resumeInTerminal({
                          terminal: app.terminalPref,
                          cwd: projectPath,
                          sessionId: s.id,
                        });
                        toast.success("Resuming");
                      } catch (err) {
                        toast.error(
                          "Couldn't resume",
                          err instanceof Error ? err.message : String(err),
                        );
                      }
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sticky resume bar */}
      {lastResumable && (
        <div className="absolute bottom-0 left-0 right-0 border-t border-border bg-cc-surface-elevated px-6 py-3">
          <div className="mx-auto flex max-w-[880px] items-center gap-3">
            <span className="grow truncate text-[12.5px] text-muted-foreground">
              Latest:{" "}
              <span className="text-foreground">
                {lastResumable.title ?? "(untitled session)"}
              </span>{" "}
              · {formatRelativeTime(lastResumable.lastActive)} ago
            </span>
            <button
              onClick={handleNewSession}
              className="flex items-center gap-1.5 rounded-cc-sm border border-border bg-cc-surface-elevated px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-cc-surface-press"
            >
              <Plus className="h-3 w-3" />
              New
            </button>
            <button
              onClick={handleResumeRecent}
              className="flex items-center gap-1.5 rounded-cc-sm bg-cc-accent px-3.5 py-1.5 text-[12.5px] font-semibold text-cc-accent-fg hover:opacity-90"
            >
              <Play className="h-3 w-3" />
              Resume in terminal
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-full px-3 py-1 text-[11.5px] font-medium transition-colors",
        selected
          ? "border border-border bg-cc-surface-press text-foreground"
          : "border border-transparent text-muted-foreground hover:border-border hover:bg-cc-surface-hover hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function SessionRow({
  session,
  projectPath,
  isFirst,
  onSelect,
  onRequestRename,
  onResume,
}: {
  session: Session;
  projectPath: string;
  isFirst: boolean;
  onSelect: () => void;
  onRequestRename: () => void;
  onResume: () => void;
}) {
  const [hover, setHover] = useState(false);
  const startedClock = new Date(session.startedAt).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const lastClock = new Date(session.lastActive).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  async function copyResumeCmd() {
    const cmd = `cd ${shellQuote(projectPath)} && claude --resume ${session.id}`;
    try {
      await navigator.clipboard.writeText(cmd);
      toast.success("Copied to clipboard", cmd);
    } catch (err) {
      toast.error("Couldn't copy", err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onSelect}
      className={cn(
        "flex cursor-pointer items-center gap-2.5 px-3.5 py-2 transition-colors hover:bg-cc-surface-hover",
        !isFirst && "border-t border-border",
      )}
    >
      <span className="flex w-2 shrink-0 justify-center">
        {session.forkedFrom ? (
          <GitFork className="h-3 w-3 text-cc-claude" />
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-cc-surface-strong" />
        )}
      </span>
      <span className="truncate text-[12.5px] font-medium text-foreground">
        {session.title ?? "(untitled session)"}
      </span>
      <span className="shrink-0 truncate text-[10.5px] text-muted-foreground">
        {session.messageCount} msg
        {session.gitBranch && (
          <span className="ml-1.5 font-mono">
            <GitBranch className="mr-0.5 inline-block h-2.5 w-2.5 align-[-1px]" />
            {session.gitBranch}
          </span>
        )}
        {session.model && <span className="ml-1.5 font-mono">{session.model}</span>}
      </span>
      <span className="grow" />
      <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
        {startedClock}–{lastClock}
      </span>

      {/* Hover actions */}
      {hover && (
        <div
          className="flex shrink-0 items-center gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          <IconBtn
            tooltip="Copy resume command"
            onClick={copyResumeCmd}
            icon={<Copy className="h-3 w-3" />}
          />
          <IconBtn
            tooltip="Rename with AI"
            onClick={onRequestRename}
            icon={<Sparkles className="h-3 w-3" />}
          />
          <button
            onClick={onResume}
            className="flex items-center gap-1 rounded-cc-sm bg-cc-accent px-2.5 py-1 text-[11px] font-semibold text-cc-accent-fg hover:opacity-90"
          >
            Resume
          </button>
          <IconBtn tooltip="More" onClick={() => {}} icon={<MoreVertical className="h-3 w-3" />} />
        </div>
      )}
    </div>
  );
}

function IconBtn({
  icon,
  tooltip,
  onClick,
}: {
  icon: React.ReactNode;
  tooltip: string;
  onClick: () => void;
}) {
  return (
    <button
      title={tooltip}
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded-cc-sm text-muted-foreground hover:bg-cc-surface-press hover:text-foreground"
    >
      {icon}
    </button>
  );
}

// ---------- Day grouping ---------------------------------------------------

interface DayGroup {
  label: string;
  sessions: Session[];
}

function groupByDay(sessions: Session[]): DayGroup[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 24 * 3600 * 1000;
  const weekAgo = today - 7 * 24 * 3600 * 1000;

  const todayArr: Session[] = [];
  const yestArr: Session[] = [];
  const weekArr: Session[] = [];
  const olderArr: Session[] = [];

  for (const s of sessions) {
    const t = s.lastActive;
    if (t >= today) todayArr.push(s);
    else if (t >= yesterday) yestArr.push(s);
    else if (t >= weekAgo) weekArr.push(s);
    else olderArr.push(s);
  }

  const groups: DayGroup[] = [];
  if (todayArr.length) groups.push({ label: "Today", sessions: todayArr });
  if (yestArr.length) groups.push({ label: "Yesterday", sessions: yestArr });
  if (weekArr.length) groups.push({ label: "Earlier this week", sessions: weekArr });
  if (olderArr.length) groups.push({ label: "Older", sessions: olderArr });
  return groups;
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
