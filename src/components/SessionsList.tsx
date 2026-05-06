import { Copy, GitFork, Play, Plus, Sparkles } from "lucide-react";
import { useApp } from "../store/AppStore";
import { cn } from "../lib/cn";
import { basename } from "../lib/path";
import { formatRelativeTime } from "../lib/path";
import { toast } from "./Toast";
import { useContextMenu, type MenuItem } from "./ContextMenu";

interface Props {
  onRequestRename: (target: {
    kind: "session";
    id: string;
    currentTitle: string;
    projectPath: string;
  }) => void;
  onOpenQuickStart: () => void;
}

export function SessionsList({ onRequestRename, onOpenQuickStart: _ }: Props) {
  const app = useApp();
  const projectPath = app.selectedProject;
  const sessions = projectPath
    ? app.sessionsByProject[projectPath] ?? []
    : [];

  const displayTitle = (s: import("../types/cairn-api").Session) =>
    app.sessionTitles[s.id] ?? s.title ?? "(untitled)";

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

  return (
    <section className="flex w-[300px] shrink-0 flex-col border-r border-border bg-background">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <h2 className="max-w-[140px] truncate text-[17px] font-bold leading-tight text-foreground">
            {projectPath ? basename(projectPath) : "No project"}
          </h2>
          <span className="shrink-0 text-[12px] font-medium text-muted-foreground">
            {sessions.length} sessions
          </span>
        </div>
        <button
          onClick={handleNewSession}
          disabled={!projectPath}
          title="New session in current project (⌘⇧N)"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-cc-sm border border-border bg-cc-surface-hover text-foreground hover:bg-cc-surface-press disabled:opacity-40"
          aria-label="New session"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="cc-scroll-thin flex-1 overflow-y-auto">
        {!projectPath && (
          <p className="p-6 text-center text-[12px] text-muted-foreground">
            Select a project on the left.
          </p>
        )}
        {projectPath && sessions.length === 0 && (
          <p className="p-6 text-center text-[12px] text-muted-foreground">
            No sessions yet. Click + to start one.
          </p>
        )}
        {sessions.map((s) => (
          <SessionItem
            key={s.id}
            session={s}
            title={displayTitle(s)}
            active={app.selectedSession === s.id}
            onSelect={() => app.selectSession(s.id)}
            onRename={() =>
              onRequestRename({
                kind: "session",
                id: s.id,
                currentTitle: displayTitle(s),
                projectPath: s.projectPath,
              })
            }
          />
        ))}
      </div>
    </section>
  );
}

function SessionItem({
  session,
  title,
  active,
  onSelect,
  onRename,
}: {
  session: import("../types/cairn-api").Session;
  title: string;
  active: boolean;
  onSelect: () => void;
  onRename: () => void;
}) {
  const app = useApp();
  const menu = useContextMenu();

  function buildMenu(): MenuItem[] {
    return [
      {
        label: "Resume in terminal",
        icon: Play,
        onClick: async () => {
          try {
            await window.cairn.resumeInTerminal({
              terminal: app.terminalPref,
              cwd: session.projectPath,
              sessionId: session.id,
            });
            toast.success("Resuming session", title);
          } catch (err) {
            toast.error(
              "Couldn't resume",
              err instanceof Error ? err.message : String(err),
            );
          }
        },
      },
      {
        label: "Copy resume command",
        icon: Copy,
        onClick: async () => {
          const cmd = `cd ${shellQuote(session.projectPath)} && claude --resume ${session.id}`;
          try {
            await navigator.clipboard.writeText(cmd);
            toast.success("Copied to clipboard", cmd);
          } catch (err) {
            toast.error(
              "Couldn't copy",
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
    ];
  }

  return (
    <div
      onClick={onSelect}
      onContextMenu={(e) => menu.open(e, buildMenu())}
      className={cn(
        "group block w-full cursor-pointer border-b border-border px-4 py-3 text-left",
        active ? "bg-cc-accent text-cc-accent-fg" : "hover:bg-cc-surface-hover",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 truncate text-[13px] font-semibold leading-snug">
          {session.forkedFrom && (
            <GitFork
              className={cn(
                "mr-1 inline-block h-3 w-3 align-[-2px]",
                active ? "text-cc-text-on-accent-soft" : "text-cc-claude",
              )}
            />
          )}
          {title}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRename();
          }}
          className={cn(
            "shrink-0 p-0.5",
            active
              ? "opacity-80 hover:opacity-100"
              : "opacity-0 transition-opacity group-hover:opacity-100",
          )}
          aria-label="Rename session with AI"
        >
          <Sparkles
            className={cn(
              "h-3 w-3",
              active ? "text-cc-text-on-accent-soft" : "text-cc-claude",
            )}
          />
        </button>
      </div>
      <div
        className={cn(
          "mt-1.5 text-[11px] font-medium",
          active ? "text-cc-text-on-accent-mute" : "text-muted-foreground",
        )}
      >
        {formatRelativeTime(session.startedAt)} · last{" "}
        {formatRelativeTime(session.lastActive)} · {session.messageCount} msg
        {session.model && ` · ${session.model}`}
        {session.gitBranch && ` · ${session.gitBranch}`}
      </div>
    </div>
  );
}

// Wrap a path in POSIX single-quotes so it pastes safely into a terminal.
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
