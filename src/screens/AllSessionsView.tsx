import {
  Archive,
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  FolderX,
  GitBranch,
  GitFork,
  Layers,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { TitleBar } from "../components/TitleBar";
import { useApp } from "../store/AppStore";
import { toast } from "../components/Toast";
import { formatRelativeTime } from "../lib/path";
import { cn } from "../lib/cn";
import type { AllSession } from "../types/cairn-api";

interface Props {
  onOpenSettings: () => void;
  onOpenHelp: () => void;
}

type Filter =
  | "all"
  | "active"
  | "drifted"
  | "named"
  | "forks"
  | "subagents"
  | "archive"
  | "folder-gone"
  | "cleanup";

export function AllSessionsView({ onOpenSettings, onOpenHelp }: Props) {
  const app = useApp();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [busyDeleting, setBusyDeleting] = useState(false);

  // Lazy-load on first mount if the title-bar entry didn't kick it off.
  useEffect(() => {
    if (app.allSessions === null) void app.loadAllSessions();
  }, [app.allSessions, app.loadAllSessions]);

  const sessions = Array.isArray(app.allSessions) ? app.allSessions : [];

  const counts = useMemo(() => {
    let active = 0,
      drifted = 0,
      named = 0,
      subagents = 0,
      archive = 0,
      live = 0,
      folderGone = 0,
      forks = 0;
    for (const s of sessions) {
      if (s.kind === "subagent") subagents++;
      else if (s.archive) archive++;
      else live++;
      if (s.active) active++;
      if (s.drifted) drifted++;
      if (s.customTitle || s.activeName) named++;
      if (s.folderDeleted) folderGone++;
      if (s.forkedFrom) forks++;
    }
    return {
      total: sessions.length,
      active,
      drifted,
      named,
      subagents,
      archive,
      live,
      folderGone,
      forks,
    };
  }, [sessions]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sessions.filter((s) => {
      // The default ("all") view shows live primary sessions. Subagents and
      // archive ghosts are gated behind their own filter chips so they don't
      // drown out the user's actual conversations. folder-gone is a
      // CROSS-CUTTING filter — a session can be folder-gone AND archive AND
      // subagent — so when it's selected we don't apply the kind gates.
      if (filter !== "subagents" && filter !== "folder-gone" && s.kind === "subagent") return false;
      if (filter !== "archive" && filter !== "folder-gone" && s.archive) return false;
      if (filter === "subagents" && s.kind !== "subagent") return false;
      if (filter === "archive" && !s.archive) return false;
      if (filter === "folder-gone" && !s.folderDeleted) return false;
      if (filter === "active" && !s.active) return false;
      if (filter === "drifted" && !s.drifted) return false;
      if (filter === "named" && !(s.customTitle || s.activeName)) return false;
      if (filter === "forks" && !s.forkedFrom) return false;
      if (q) {
        const hay = [
          s.customTitle ?? "",
          s.activeName ?? "",
          s.title ?? "",
          s.dominantCwd ?? "",
          s.launchedFrom ?? "",
          s.gitBranch ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [sessions, filter, query]);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <TitleBar
        theme={app.theme}
        onToggleTheme={() => app.setTheme(app.theme === "dark" ? "light" : "dark")}
        onOpenSettings={onOpenSettings}
        onOpenHelp={onOpenHelp}
        onOpenHome={() => app.setView("home")}
        onOpenAllSessions={() => void app.loadAllSessions()}
        onRefresh={() => void app.loadAllSessions()}
        view="all-sessions"
      />

      <div className="cc-scroll-thin flex-1 overflow-y-auto">
        <header className="flex flex-col gap-3 px-10 pt-9 pb-7">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-cc-accent-light">
              All Sessions
            </span>
            <span className="text-[11px] text-muted-foreground">·</span>
            <span className="text-[11px] font-medium text-muted-foreground">
              {app.allSessions === "loading"
                ? "scanning ~/.claude/projects/ + usage-data/session-meta/…"
                : `${counts.live} live · ${counts.active} active now · ${counts.drifted} drifted · ${counts.archive} archived · ${counts.subagents} orphan subagents`}
            </span>
          </div>
          <h1 className="text-[32px] font-bold leading-[1.15] tracking-tight">
            Every Claude Code conversation
          </h1>
          <p className="text-[13px] text-muted-foreground">
            Browse, search, and resume every session — including ones launched outside any registered workspace, or from a parent of one.
          </p>
        </header>

        <section className="flex items-center gap-2.5 px-10 pb-4">
          <div className="flex h-[34px] flex-1 items-center gap-2 rounded-cc-md border border-border bg-cc-surface-hover px-3">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, prompt, branch, or path…"
              className="w-full bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            <kbd className="rounded-[4px] bg-cc-surface-strong px-1 font-mono text-[10px] font-semibold text-muted-foreground">
              ⌘K
            </kbd>
          </div>
          <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
            All
          </FilterChip>
          <FilterChip
            active={filter === "active"}
            onClick={() => setFilter("active")}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-cc-success" />
            Active {counts.active}
          </FilterChip>
          <FilterChip
            active={filter === "drifted"}
            onClick={() => setFilter("drifted")}
            tone="claude"
          >
            Drifted {counts.drifted}
          </FilterChip>
          <FilterChip
            active={filter === "named"}
            onClick={() => setFilter("named")}
          >
            Named {counts.named}
          </FilterChip>
          <FilterChip
            active={filter === "forks"}
            onClick={() => setFilter("forks")}
            tone="claude"
          >
            <GitFork className="h-2.5 w-2.5" />
            Forks {counts.forks}
          </FilterChip>
          <FilterChip
            active={filter === "subagents"}
            onClick={() => setFilter("subagents")}
            tone="subagent"
          >
            <Layers className="h-2.5 w-2.5" />
            Subagents {counts.subagents}
          </FilterChip>
          <FilterChip
            active={filter === "archive"}
            onClick={() => setFilter("archive")}
            tone="archive"
          >
            <Archive className="h-2.5 w-2.5" />
            Archive {counts.archive}
          </FilterChip>
          <FilterChip
            active={filter === "folder-gone"}
            onClick={() => setFilter("folder-gone")}
            tone="claude"
          >
            <FolderX className="h-2.5 w-2.5" />
            Folder gone {counts.folderGone}
          </FilterChip>
          <FilterChip
            active={filter === "cleanup"}
            onClick={() => setFilter("cleanup")}
            tone="claude"
          >
            <Sparkles className="h-2.5 w-2.5" />
            Cleanup {counts.subagents + counts.archive + counts.folderGone + counts.drifted}
          </FilterChip>
        </section>

        {filter === "folder-gone" && filtered.length > 0 && (
          <section
            className="mx-10 mb-3 flex items-center justify-between gap-3 rounded-cc-md px-4 py-3"
            style={{ backgroundColor: "#F0934014", border: "1px solid #F0934026" }}
          >
            <div className="flex items-center gap-2.5">
              <FolderX className="h-4 w-4 text-cc-claude" />
              <p className="text-[12.5px] text-foreground">
                <span className="font-semibold">{filtered.length}</span>{" "}
                session{filtered.length === 1 ? "" : "s"} whose project folder has been deleted.
                <span className="ml-1.5 text-muted-foreground">
                  Removing them frees disk space and clears noise — Claude
                  can't resume them anyway.
                </span>
              </p>
            </div>
            <button
              disabled={busyDeleting}
              onClick={async () => {
                const ids = filtered.map((s) => s.id);
                const ok = window.confirm(
                  `Delete ${ids.length} session${ids.length === 1 ? "" : "s"}?\n\nThis removes:\n• Their .jsonl transcripts\n• Any nested subagent dirs\n• Their usage-data meta files\n\nThis can't be undone.`,
                );
                if (!ok) return;
                setBusyDeleting(true);
                try {
                  const res = await window.cairn.deleteSessions(ids);
                  toast.success(
                    `Deleted ${res.deleted} sessions`,
                    `Freed ${formatBytes(res.bytesFreed)}${res.errors.length ? ` · ${res.errors.length} errors` : ""}`,
                  );
                  await app.loadAllSessions();
                } catch (err) {
                  toast.error(
                    "Cleanup failed",
                    err instanceof Error ? err.message : String(err),
                  );
                } finally {
                  setBusyDeleting(false);
                }
              }}
              className={cn(
                "flex items-center gap-1.5 rounded-cc-sm bg-cc-claude px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity",
                busyDeleting ? "opacity-50" : "hover:opacity-90",
              )}
            >
              <Trash2 className="h-3 w-3" />
              {busyDeleting ? "Deleting…" : `Delete all ${filtered.length}`}
            </button>
          </section>
        )}

        {filter === "cleanup" ? (
          <CleanupView
            sessions={sessions}
            loading={app.allSessions === "loading"}
            onChanged={() => void app.loadAllSessions()}
          />
        ) : (
          <section className="px-10 pb-12">
            <div className="flex items-center gap-3 rounded-cc-md border-y border-border bg-cc-surface-hover/40 px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
              <span className="w-9" />
              <span className="w-[300px]">Title</span>
              <span className="w-[240px]">Project</span>
              <span className="w-[140px]">Branch</span>
              <span className="w-[60px] text-right">Msgs</span>
              <span className="ml-auto">Last active</span>
            </div>

            {app.allSessions === "loading" && (
              <p className="px-4 py-12 text-center text-[12px] text-muted-foreground">
                Scanning ~/.claude/projects/…
              </p>
            )}
            {Array.isArray(app.allSessions) && filtered.length === 0 && (
              <p className="px-4 py-12 text-center text-[12px] text-muted-foreground">
                No sessions match.
              </p>
            )}
            {filtered.map((s) => (
              <SessionRow key={s.id} session={s} />
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

function FilterChip({
  active,
  tone,
  onClick,
  children,
}: {
  active: boolean;
  tone?: "default" | "claude" | "subagent" | "archive";
  onClick: () => void;
  children: React.ReactNode;
}) {
  const inactive =
    tone === "claude"
      ? "bg-cc-surface-hover text-cc-claude hover:bg-cc-surface-press"
      : tone === "subagent"
        ? "bg-cc-surface-hover text-cc-accent-light hover:bg-cc-surface-press"
        : tone === "archive"
          ? "bg-cc-surface-hover text-muted-foreground hover:bg-cc-surface-press"
          : "bg-cc-surface-hover text-foreground hover:bg-cc-surface-press";
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex h-[26px] items-center gap-1.5 rounded-full px-2.5 text-[11px] font-semibold transition-colors",
        active ? "bg-cc-accent text-cc-accent-fg" : inactive,
      )}
    >
      {children}
    </button>
  );
}

function SessionRow({ session }: { session: AllSession }) {
  const app = useApp();
  const isSubagent = session.kind === "subagent";
  const isArchive = session.archive;
  const displayName =
    session.customTitle ??
    session.activeName ??
    session.title ??
    "(untitled session)";

  const dominantBase = lastTwoSegments(session.dominantCwd);
  const launchBase = session.launchedFrom ?? "(unknown)";

  async function handleResume() {
    if (isArchive) {
      // No transcript on disk — claude --resume <uuid> would 404. Best we
      // can do is reveal the cwd in Finder so the user can poke around.
      if (session.dominantCwd) {
        try {
          await window.cairn.revealInFinder(session.dominantCwd);
        } catch (err) {
          toast.error(
            "Couldn't open folder",
            err instanceof Error ? err.message : String(err),
          );
        }
      } else {
        toast.info(
          "Archive entry — no transcript",
          "Only meta survived; the .jsonl was cleaned up.",
        );
      }
      return;
    }
    if (isSubagent) {
      // Subagents have no resumable parent — clicking should reveal the
      // dir, not pretend to resume something that doesn't exist anymore.
      if (session.dominantCwd) {
        try {
          await window.cairn.revealInFinder(session.dominantCwd);
        } catch (err) {
          toast.error(
            "Couldn't open folder",
            err instanceof Error ? err.message : String(err),
          );
        }
      } else {
        toast.info(
          "Subagent has no recorded cwd",
          "This was a Task() research call whose parent session is gone.",
        );
      }
      return;
    }
    if (!session.dominantCwd) {
      toast.error("Can't resume", "No cwd recorded for this session.");
      return;
    }
    try {
      await window.cairn.resumeInTerminal({
        terminal: app.terminalPref,
        cwd: session.dominantCwd,
        sessionId: session.id,
      });
      toast.success("Resuming session", session.dominantCwd);
    } catch (err) {
      toast.error(
        "Couldn't resume",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return (
    <button
      onClick={handleResume}
      className={cn(
        "group flex w-full items-center gap-3 border-b border-border px-4 py-3.5 text-left transition-colors hover:bg-cc-surface-hover",
        (isSubagent || isArchive) && "opacity-65",
      )}
    >
      <span className="flex w-9 shrink-0 items-center">
        {isArchive ? (
          <Archive className="h-3 w-3 text-muted-foreground" />
        ) : isSubagent ? (
          <Layers className="h-3 w-3 text-cc-accent-light" />
        ) : (
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              session.active ? "bg-cc-success" : "bg-cc-surface-strong",
            )}
          />
        )}
      </span>

      <span className="flex w-[300px] flex-col gap-1">
        <span className="flex items-center gap-2">
          <span
            className={cn(
              "truncate text-[13px] font-bold",
              isSubagent ? "text-foreground/85 italic" : "text-foreground",
            )}
          >
            {displayName}
          </span>
          {isArchive && (
            <span className="flex items-center gap-1 rounded-[4px] bg-cc-surface-strong px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
              <Archive className="h-2.5 w-2.5" />
              archive
            </span>
          )}
          {isSubagent && (
            <span
              className="flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.05em] text-cc-accent-light"
              style={{ backgroundColor: "#7DA8FF26" }}
            >
              <Layers className="h-2.5 w-2.5" />
              subagent
            </span>
          )}
          {!isSubagent && !isArchive && (session.customTitle || session.activeName) && (
            <span
              className="rounded-[4px] px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-[0.04em] text-cc-accent-light"
              style={{ backgroundColor: "#3072F033" }}
            >
              --name
            </span>
          )}
          {session.forkedFrom && !isSubagent && !isArchive && (
            <span
              className="flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.05em] text-cc-claude"
              style={{ backgroundColor: "#F0934033" }}
              title={`Forked from ${session.forkedFrom.sessionId.slice(0, 8)}`}
            >
              <GitFork className="h-2.5 w-2.5" />
              fork
            </span>
          )}
        </span>
        {isSubagent ? (
          <span className="truncate text-[11px] italic text-muted-foreground">
            Orphaned Task() research · parent session gone
          </span>
        ) : isArchive ? (
          <span className="truncate text-[11px] italic text-muted-foreground">
            Transcript cleaned up · only meta survives
          </span>
        ) : (
          session.title &&
          session.title !== displayName && (
            <span className="truncate text-[11px] text-muted-foreground">
              {session.title}
            </span>
          )
        )}
      </span>

      <span className="flex w-[240px] flex-col gap-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate font-mono text-[12px] font-semibold text-foreground">
            {dominantBase}
          </span>
        </span>
        {session.folderDeleted && (
          <span
            className="flex w-fit items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-[9px] font-medium text-cc-claude"
            style={{ backgroundColor: "#F0934026" }}
          >
            <FolderX className="h-2.5 w-2.5" />
            folder gone
          </span>
        )}
        {!session.folderDeleted && session.drifted && (
          <span
            className="flex w-fit items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-[9px] font-medium text-cc-claude"
            style={{ backgroundColor: "#F0934026" }}
          >
            <CornerDownRight className="h-2.5 w-2.5" />
            <span className="truncate font-mono">launched from {launchBase}</span>
          </span>
        )}
      </span>

      <span className="flex w-[140px] items-center gap-1.5 text-[11px] text-muted-foreground">
        <GitBranch className="h-3 w-3" />
        <span className="truncate font-mono">{session.gitBranch ?? "—"}</span>
      </span>

      <span className="w-[60px] text-right font-mono text-[12px] font-semibold text-foreground">
        {session.messageCount.toLocaleString()}
      </span>

      <span className="ml-auto flex items-center gap-1.5 text-[11px] font-semibold">
        {session.active && (
          <span className="h-1.5 w-1.5 rounded-full bg-cc-success" />
        )}
        <span className={session.active ? "text-cc-success" : "text-muted-foreground"}>
          {session.active
            ? "now"
            : session.lastActive
              ? `${formatRelativeTime(session.lastActive)} ago`
              : "—"}
        </span>
      </span>
    </button>
  );
}

function CleanupView({
  sessions,
  loading,
  onChanged,
}: {
  sessions: AllSession[];
  loading: boolean;
  onChanged: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [busyAll, setBusyAll] = useState(false);

  if (loading) {
    return (
      <p className="px-10 py-12 text-center text-[12px] text-muted-foreground">
        Scanning ~/.claude/projects/…
      </p>
    );
  }

  const subagents = sessions.filter((s) => s.kind === "subagent");
  const archive = sessions.filter((s) => s.kind !== "subagent" && s.archive);
  const folderGone = sessions.filter(
    (s) => s.kind !== "subagent" && !s.archive && s.folderDeleted,
  );
  const drifted = sessions.filter(
    (s) => s.kind !== "subagent" && !s.archive && !s.folderDeleted && s.drifted,
  );

  const totalCleanup = subagents.length + archive.length + folderGone.length;
  const totalRowsForSelection = subagents.length + archive.length + folderGone.length;

  // Rough size estimate (each message ≈ 2KB).
  const estBytes = sessions.reduce((sum, s) => sum + s.messageCount * 2048, 0);

  function toggleId(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return;
    const ok = window.confirm(
      `Delete ${selected.size} session${selected.size === 1 ? "" : "s"}?\n\nRemoves transcripts, subagent dirs, and usage-data meta. Cannot be undone.`,
    );
    if (!ok) return;
    setBulkBusy(true);
    try {
      const res = await window.cairn.deleteSessions([...selected]);
      toast.success(
        `Deleted ${res.deleted} sessions`,
        `Freed ${formatBytes(res.bytesFreed)}${res.errors.length ? ` · ${res.errors.length} errors` : ""}`,
      );
      setSelected(new Set());
      onChanged();
    } catch (err) {
      toast.error(
        "Bulk delete failed",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleDeleteAll() {
    const allDeletable = [...subagents, ...archive, ...folderGone].map((s) => s.id);
    if (allDeletable.length === 0) return;
    const ok = window.confirm(
      `Delete all ${allDeletable.length} stale sessions?\n\nThis includes subagent ghosts, archive entries, and folder-gone sessions. Cannot be undone.`,
    );
    if (!ok) return;
    setBusyAll(true);
    try {
      const res = await window.cairn.deleteSessions(allDeletable);
      toast.success(
        `Deleted ${res.deleted} sessions`,
        `Freed ${formatBytes(res.bytesFreed)}${res.errors.length ? ` · ${res.errors.length} errors` : ""}`,
      );
      setSelected(new Set());
      onChanged();
    } catch (err) {
      toast.error(
        "Delete-all failed",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setBusyAll(false);
    }
  }

  const selectedSizeEst = sessions
    .filter((s) => selected.has(s.id))
    .reduce((sum, s) => sum + s.messageCount * 2048, 0);

  return (
    <section className="flex flex-col gap-6 px-10 pb-32">
      {/* Hero */}
      <div className="flex items-end justify-between gap-4 pt-2">
        <div className="flex flex-col gap-2">
          <h1 className="text-[32px] font-semibold leading-[1.1] tracking-[-0.4px] text-foreground">
            Cleanup
          </h1>
          <p className="text-[13px] text-muted-foreground">
            {totalCleanup + drifted.length} stale item
            {totalCleanup + drifted.length === 1 ? "" : "s"} polluting{" "}
            <span className="font-mono">claude -r</span> ·{" "}
            {formatBytes(estBytes)} estimated
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onChanged}
            className="flex items-center gap-1.5 rounded-cc-sm border border-border bg-cc-surface-elevated px-3 py-1.5 text-[12px] font-medium text-muted-foreground hover:bg-cc-surface-press hover:text-foreground"
          >
            Re-scan
          </button>
          <button
            onClick={handleDeleteAll}
            disabled={busyAll || totalCleanup === 0}
            className="flex items-center gap-1.5 rounded-cc-sm px-3 py-1.5 text-[12px] font-semibold text-white"
            style={{
              backgroundColor: "#F09340",
              opacity: busyAll || totalCleanup === 0 ? 0.4 : 1,
            }}
          >
            <Trash2 className="h-3 w-3" />
            {busyAll ? "Deleting…" : `Delete all ${totalCleanup}`}
          </button>
        </div>
      </div>

      {totalCleanup === 0 && drifted.length === 0 && (
        <div className="rounded-[14px] border border-border bg-cc-card px-6 py-10 text-center">
          <Sparkles className="mx-auto h-5 w-5 text-cc-success" />
          <p className="mt-3 text-[14px] font-semibold text-foreground">
            Nothing to clean up.
          </p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            No subagent ghosts, archive entries, dead links, or drifted sessions found.
          </p>
        </div>
      )}

      <CleanupSection
        title="Subagent ghosts"
        subtitle="Orphaned Task() research transcripts whose parent session is gone"
        rows={subagents}
        deletable
        selected={selected}
        onToggleId={toggleId}
        onChanged={onChanged}
      />
      <CleanupSection
        title="Archive ghosts"
        subtitle="Transcript already cleaned up — only usage-data meta survives"
        rows={archive}
        deletable
        selected={selected}
        onToggleId={toggleId}
        onChanged={onChanged}
      />
      <CleanupSection
        title="Folder gone"
        subtitle="Project folder deleted from disk — Claude can't resume these"
        rows={folderGone}
        deletable
        selected={selected}
        onToggleId={toggleId}
        onChanged={onChanged}
      />
      <CleanupSection
        title="Drifted"
        subtitle="Launched from a parent dir but actually worked elsewhere — review before deleting"
        rows={drifted}
        deletable={false}
        selected={selected}
        onToggleId={toggleId}
        onChanged={onChanged}
      />

      {/* Sticky bulk action bar */}
      {selected.size > 0 && totalRowsForSelection > 0 && (
        <div className="fixed bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3.5 rounded-[14px] border border-border bg-cc-surface-elevated px-5 py-3.5 shadow-lg">
          <Sparkles className="h-3.5 w-3.5 text-cc-accent-light" />
          <span className="text-[13px] font-medium text-foreground">
            {selected.size} item{selected.size === 1 ? "" : "s"} selected ·{" "}
            {formatBytes(selectedSizeEst)} will be freed
          </span>
          <button
            onClick={clearSelection}
            className="text-[11.5px] font-normal text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
          <button
            onClick={handleBulkDelete}
            disabled={bulkBusy}
            className="flex items-center gap-1.5 rounded-cc-sm px-3.5 py-1.5 text-[12px] font-semibold text-white"
            style={{ backgroundColor: "#F09340", opacity: bulkBusy ? 0.5 : 1 }}
          >
            <Trash2 className="h-3 w-3" />
            {bulkBusy ? "Deleting…" : "Delete selected"}
          </button>
        </div>
      )}
    </section>
  );
}

function CleanupSection({
  title,
  subtitle,
  rows,
  deletable,
  selected,
  onToggleId,
  onChanged,
}: {
  title: string;
  subtitle: string;
  rows: AllSession[];
  deletable: boolean;
  selected: Set<string>;
  onToggleId: (id: string) => void;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);

  if (rows.length === 0) return null;

  async function handleDeleteAll() {
    const ids = rows.map((s) => s.id);
    const ok = window.confirm(
      `Delete ${ids.length} ${title.toLowerCase()} session${ids.length === 1 ? "" : "s"}?\n\nThis removes their .jsonl transcripts (if any), nested subagent dirs, and usage-data meta. Cannot be undone.`,
    );
    if (!ok) return;
    setBusy(true);
    try {
      const res = await window.cairn.deleteSessions(ids);
      toast.success(
        `Deleted ${res.deleted} sessions`,
        `Freed ${formatBytes(res.bytesFreed)}${res.errors.length ? ` · ${res.errors.length} errors` : ""}`,
      );
      onChanged();
    } catch (err) {
      toast.error(
        "Cleanup failed",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-cc-md border border-border bg-cc-surface-elevated">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 text-left"
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <span className="text-[13px] font-semibold text-foreground">
            {title}
          </span>
          <span className="rounded-full bg-cc-surface-hover px-2 py-0.5 text-[10.5px] font-semibold text-muted-foreground">
            {rows.length}
          </span>
        </button>
        <span className="ml-1 truncate text-[11.5px] text-muted-foreground">
          {subtitle}
        </span>
        {deletable && (
          <button
            disabled={busy}
            onClick={handleDeleteAll}
            className={cn(
              "ml-auto flex items-center gap-1.5 rounded-cc-sm bg-cc-claude px-2.5 py-1 text-[11.5px] font-semibold text-white transition-opacity",
              busy ? "opacity-50" : "hover:opacity-90",
            )}
          >
            <Trash2 className="h-3 w-3" />
            {busy ? "Deleting…" : `Delete ${rows.length}`}
          </button>
        )}
      </div>
      {open && (
        <div>
          {rows.map((s) => (
            <div key={s.id} className="flex items-center">
              {deletable && (
                <label className="flex h-full shrink-0 cursor-pointer items-center pl-4 pr-1">
                  <input
                    type="checkbox"
                    checked={selected.has(s.id)}
                    onChange={() => onToggleId(s.id)}
                    className="h-3.5 w-3.5 cursor-pointer accent-cc-accent"
                  />
                </label>
              )}
              <div className="flex-1">
                <SessionRow session={s} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function lastTwoSegments(p: string | null): string {
  if (!p) return "(no cwd)";
  const parts = p.split("/").filter(Boolean);
  if (parts.length <= 2) return p;
  return parts.slice(-2).join("/");
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
