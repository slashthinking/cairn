// V2-K Mix dashboard. Day-grouped activity stream — projects are a
// secondary detail. Driven by `app.allSessions` (auto-loaded on mount).

import {
  Archive,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  CornerDownRight,
  Folder,
  GitFork,
  Play,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { searchAll, type SearchHit } from "../lib/search";
import { TitleBar } from "../components/TitleBar";
import { useApp } from "../store/AppStore";
import { toast } from "../components/Toast";
import { basename, formatRelativeTime } from "../lib/path";
import { cn } from "../lib/cn";
import type { AllSession } from "../types/cairn-api";

interface Props {
  onOpenSettings: () => void;
  onOpenQuickStart: () => void;
  onOpenHelp: () => void;
  onOpenSession: (projectPath: string, sessionId: string) => void;
}

const PROJECT_PALETTE = [
  "#F09340", // claude
  "#3072F0", // accent
  "#A78BFA", // violet
  "#22C55E", // success
  "#F472B6", // pink
  "#38BDF8", // sky
] as const;

function projectColor(path: string | null): string {
  if (!path) return "#6B7280";
  let hash = 0;
  for (let i = 0; i < path.length; i++) {
    hash = (hash * 31 + path.charCodeAt(i)) | 0;
  }
  return PROJECT_PALETTE[Math.abs(hash) % PROJECT_PALETTE.length]!;
}

interface DayBucket {
  /** Local-midnight timestamp for this day. */
  dayStart: number;
  /** Sessions active that day, sorted by startedAt asc. */
  sessions: AllSession[];
}

export function WorkspacesHome({
  onOpenSettings,
  onOpenQuickStart,
  onOpenHelp,
  onOpenSession,
}: Props) {
  const app = useApp();

  // Auto-load on first mount — V2-K Mix needs allSessions to render
  // anything meaningful. Subsequent visits use the cached list.
  useEffect(() => {
    if (app.allSessions === null) void app.loadAllSessions();
  }, [app.allSessions, app.loadAllSessions]);

  // Daily-cadence vector index rebuild — TEMPORARILY DISABLED on launch.
  //
  // The embedder (candle Metal + fastembed) panics during model load on
  // some setups; that panic SIGTRAP-aborts the Electron main process
  // before any JS catch can run. Re-enable once the panic is caught at
  // the napi-rs boundary (panic = "unwind" alone isn't enough; needs
  // explicit catch_unwind wrappers in cairn-embed/src/lib.rs).
  //
  // Search continues to work via lexical (BM25) fallback; vector results
  // are simply unavailable until the rebuild path is safe again.
  useEffect(() => {
    let cancelled = false;
    let startedToastShown = false;
    const REBUILD_ON_LAUNCH = false;
    const startDelay = setTimeout(() => {
      if (cancelled || !REBUILD_ON_LAUNCH) return;
      runIndex().catch((err) => {
        toast.info(
          "Search index couldn't update",
          err instanceof Error ? err.message : String(err),
        );
      });
    }, 8_000);
    async function runIndex() {
      const status = await window.cairn.lancedbStatus();
      const stale =
        !status.ready ||
        (status.ageMs !== null && status.ageMs > 24 * 60 * 60 * 1000);
      if (!stale) {
        // Even when fresh, run an incremental pass on app boot so that
        // any sessions added/changed/deleted since the last build get
        // picked up. Fast: only changed sessions actually re-embed.
        // Skip if last built within 5 min — likely just relaunched.
        if (status.ageMs !== null && status.ageMs < 5 * 60 * 1000) return;
      }
      // Wait for allSessions so we have something to embed.
      const list = Array.isArray(app.allSessions)
        ? app.allSessions
        : await window.cairn.listAllSessions();
      if (cancelled) return;
      // First-build (or stale) is heavy — let the user know so they're
      // not surprised by sudden CPU + disk activity.
      if (!status.ready && !startedToastShown && list.length > 0) {
        startedToastShown = true;
        toast.info(
          "Building search index…",
          `${list.length} sessions · runs in background`,
        );
      }
        // Fetch the 10-message preview for each session so the embedder
        // and BM25 see real conversation content, not just metadata.
        // Bound concurrency so we don't fire 100s of IPC calls at once.
        const candidates = list.filter(
          (s) => s.kind === "primary" && !s.archive && s.dominantCwd,
        );
        const previews = new Map<string, string>();
        const CONCURRENCY = 10;
        for (let i = 0; i < candidates.length; i += CONCURRENCY) {
          if (cancelled) return;
          await Promise.all(
            candidates.slice(i, i + CONCURRENCY).map(async (s) => {
              try {
                const p = await window.cairn.getSessionPreview(
                  s.dominantCwd!,
                  s.id,
                );
                // Concat all preview messages, prefer first user message
                // first (anchors what the conversation was about).
                const sorted = [...p.lastMessages].sort(
                  (a, b) => a.timestamp - b.timestamp,
                );
                const cleaned = sorted
                  .map((m) => stripMarkup(m.text))
                  .filter((t) => t.length > 0);
                // Skip sessions whose entire preview is tool-result
                // boilerplate (no real user intent or assistant prose).
                const isAllToolResult = cleaned.every((t) =>
                  /^Tool result of/i.test(t.trim()) ||
                  /^Calling `[a-z_]+`/i.test(t.trim()),
                );
                if (cleaned.length > 0 && !isAllToolResult) {
                  previews.set(s.id, cleaned.join(" ").slice(0, 1500));
                }
              } catch {
                // Skip sessions whose preview fails (deleted folder, etc).
              }
            }),
          );
        }

        const items = list
          .filter((s) => s.kind === "primary" && !s.archive)
          .map((s) => {
            const named = (s.customTitle ?? s.activeName ?? "").trim();
            const fallbackTitle = stripMarkup(s.title ?? "");
            const preview = previews.get(s.id) ?? "";
            const text = [
              named,
              named ? "" : fallbackTitle,
              preview,
              s.dominantCwd ? s.dominantCwd.split("/").pop() : null,
              s.gitBranch,
            ]
              .filter((x) => x && x.trim().length > 0)
              .join(" · ");
            return {
              sessionId: s.id,
              projectPath: s.dominantCwd ?? null,
              lastActive: s.lastActive,
              text,
            };
          })
          // Drop sessions whose only signal would have been tool-result
          // boilerplate (preview filter rejected them, AND there's no
          // human-given title to fall back on).
          .filter(
            (it) =>
              it.text.trim().length > 0 &&
              !/^Tool result of/i.test(it.text.trim()),
          );
      if (items.length === 0) return;
      const res = await window.cairn.lancedbRebuild({ items });
      if (cancelled) return;
      if (res.ok) {
        // Stay quiet when nothing changed — only toast when the index
        // actually moved (new embeds, deletions, or first build).
        if (res.embedded > 0 || res.removed > 0) {
          const parts: string[] = [];
          if (res.embedded > 0) parts.push(`+${res.embedded} embedded`);
          if (res.reused > 0) parts.push(`${res.reused} reused`);
          if (res.removed > 0) parts.push(`-${res.removed} removed`);
          toast.success("Semantic index updated", parts.join(" · "));
        }
      }
    }
    return () => {
      cancelled = true;
      clearTimeout(startDelay);
    };
  }, [app.allSessions]);

  const all = Array.isArray(app.allSessions) ? app.allSessions : [];
  const loading = app.allSessions === "loading";

  // Filter pill state: null = All, otherwise a workspace path. Selected
  // workspace acts as a scope filter — every panel below derives from it.
  const [scope, setScope] = useState<string | null>(null);
  // Drill into a single project (only meaningful when scope is set). Null
  // = show project list; non-null = show that project's sessions inline.
  const [projectDrill, setProjectDrill] = useState<string | null>(null);

  function isUnderScope(cwd: string | null): boolean {
    if (scope === null) return true;
    if (!cwd) return false;
    const ws = scope.replace(/\/+$/, "");
    return cwd === ws || cwd.startsWith(ws + "/");
  }

  // Live primary sessions only — pollution shouldn't show up in the timeline.
  const live = useMemo(
    () =>
      all.filter(
        (s) =>
          s.kind === "primary" &&
          !s.archive &&
          !s.folderDeleted &&
          isUnderScope(s.dominantCwd),
      ),
    [all, scope],
  );

  const dayBuckets = useMemo(() => buildDayBuckets(live), [live]);

  // Counts for the "Cleanup" suggested action and the Issues found section.
  // Pollution counts respect scope when one is selected.
  const issueCounts = useMemo(() => {
    let subagents = 0,
      archive = 0,
      folderGone = 0,
      drifted = 0;
    for (const s of all) {
      if (!isUnderScope(s.dominantCwd ?? s.launchedFrom)) continue;
      if (s.kind === "subagent") subagents++;
      else if (s.archive) archive++;
      if (s.folderDeleted) folderGone++;
      if (s.drifted) drifted++;
    }
    return {
      subagents,
      archive,
      folderGone,
      drifted,
      cleanupTotal: subagents + archive + folderGone,
    };
  }, [all, scope]);

  const activeCount = useMemo(
    () => all.filter((s) => s.active && isUnderScope(s.dominantCwd)).length,
    [all, scope],
  );
  const lastResumable = useMemo(
    () =>
      [...live]
        .sort((a, b) => b.lastActive - a.lastActive)
        .find((s) => s.dominantCwd) ?? null,
    [live],
  );

  // Workspace chips. "All" = aggregate across registered workspaces.
  // Unsorted projects = projects in cluster groups named "Unsorted".
  const workspaceChips = useMemo(() => {
    return app.workspaces.map((ws) => {
      const projects = app.projectsByWorkspace[ws] ?? [];
      const sessionTotal = projects.reduce((s, p) => s + p.sessionCount, 0);
      return { path: ws, name: basename(ws), count: sessionTotal };
    });
  }, [app.workspaces, app.projectsByWorkspace]);

  const totalSessions = workspaceChips.reduce((s, w) => s + w.count, 0);

  function jumpToCleanup() {
    app.setView("all-sessions");
    void app.loadAllSessions();
  }

  // Drill into a project's sessions inline (level-3 of home view).
  // Owns no navigation — caller flips projectDrill to the project path.
  function drillIntoProject(projectPath: string) {
    setProjectDrill(projectPath);
    app.selectProject(projectPath);
  }

  // Forward to the Shell-level drawer trigger.
  function openSession(projectPath: string, sessionId: string) {
    onOpenSession(projectPath, sessionId);
  }

  async function handleResumeLast() {
    if (!lastResumable?.dominantCwd) {
      toast.info("No resumable session yet");
      return;
    }
    try {
      await window.cairn.resumeInTerminal({
        terminal: app.terminalPref,
        cwd: lastResumable.dominantCwd,
        sessionId: lastResumable.id,
      });
      toast.success("Resuming", lastResumable.dominantCwd);
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
        onOpenAllSessions={jumpToCleanup}
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
        <div className="mx-auto flex max-w-[920px] flex-col gap-3 px-5 pt-4 pb-10">
          <WorkspaceChips
            chips={workspaceChips}
            unsortedCount={0}
            totalSessions={totalSessions}
            scope={scope}
            onPickAll={() => {
              setScope(null);
              setProjectDrill(null);
            }}
            onPickWorkspace={(path) => {
              // Toggle: clicking the already-active workspace pops project
              // drill back up to project list. Clicking a different one
              // switches scope and resets project drill.
              if (scope === path) {
                setProjectDrill(null);
              } else {
                setScope(path);
                setProjectDrill(null);
              }
            }}
            onManage={onOpenSettings}
          />

          <SearchBar
            allSessions={all}
            workspaces={app.workspaces}
            projectsByWorkspace={app.projectsByWorkspace}
            onPickSession={(s) => {
              if (s.dominantCwd) onOpenSession(s.dominantCwd, s.id);
            }}
            onPickProject={(path, ws) => {
              setScope(ws);
              setProjectDrill(path);
              app.selectProject(path);
            }}
            onPickWorkspace={(ws) => {
              setScope(ws);
              setProjectDrill(null);
            }}
          />

          {/* Suggested actions only on the dashboard (All scope, top level).
              Hidden when filtered to a workspace or drilled into a project —
              those views have their own context-specific row of actions. */}
          {scope === null && projectDrill === null && (
            <SuggestedActions
              onResumeLast={handleResumeLast}
              onScratch={onOpenQuickStart}
              onOpenActive={() => {
                app.setView("all-sessions");
                void app.loadAllSessions();
              }}
              onCleanup={jumpToCleanup}
              cleanupCount={issueCounts.cleanupTotal}
              activeCount={activeCount}
              disabled={!lastResumable}
            />
          )}

          {loading && (
            <div className="rounded-[14px] border border-border bg-cc-card px-6 py-12 text-center text-[13px] text-muted-foreground">
              Scanning ~/.claude/projects/ for activity…
            </div>
          )}

          {scope === null ? (
            // ── All scope = dashboard mode ─────────────────────────────────
            <>
              {!loading && dayBuckets.length === 0 && (
                <div className="rounded-[14px] border border-border bg-cc-card px-6 py-12 text-center">
                  <p className="text-[14px] font-semibold text-foreground">
                    No live sessions yet.
                  </p>
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    Start one with the New scratch button above, or run `claude` in any project under your workspaces.
                  </p>
                </div>
              )}

              {dayBuckets[0] && (
                <DayCardLarge
                  bucket={dayBuckets[0]}
                  kind="today"
                  onClickSession={(s) =>
                    s.dominantCwd && openSession(s.dominantCwd, s.id)
                  }
                />
              )}
              {dayBuckets[1] && (
                <DayCardLarge
                  bucket={dayBuckets[1]}
                  kind="yesterday"
                  onClickSession={(s) =>
                    s.dominantCwd && openSession(s.dominantCwd, s.id)
                  }
                />
              )}
              {dayBuckets[2] && (
                <DayCardCompact
                  bucket={dayBuckets[2]}
                  onClickSession={(s) =>
                    s.dominantCwd && openSession(s.dominantCwd, s.id)
                  }
                />
              )}
              {dayBuckets.length > 3 && (
                <EarlierDays buckets={dayBuckets.slice(3, 7)} onOpenAll={jumpToCleanup} />
              )}
              {dayBuckets.length > 0 && <ViewAllLink onClick={jumpToCleanup} />}

              <ByTopicSection
                workspaces={app.workspaces}
                projectsByWorkspace={app.projectsByWorkspace}
                clustersByWorkspace={app.clustersByWorkspace}
                onJumpProject={(path) => {
                  // From dashboard, clicking a cluster project jumps to its
                  // workspace then drills directly into that project.
                  const ws = app.workspaces.find(
                    (w) =>
                      path === w ||
                      path.startsWith(w.replace(/\/+$/, "") + "/"),
                  );
                  if (ws) setScope(ws);
                  drillIntoProject(path);
                }}
                onEnterWorkspace={(ws) => {
                  setScope(ws);
                  setProjectDrill(null);
                }}
                onRecluster={async (ws) => {
                  try {
                    await app.runClustering(ws);
                    toast.success("Re-clustered");
                  } catch (err) {
                    toast.error("Cluster failed", err instanceof Error ? err.message : String(err));
                  }
                }}
              />

              {issueCounts.cleanupTotal + issueCounts.drifted > 0 && (
                <IssuesFoundSection counts={issueCounts} onOpenCleanup={jumpToCleanup} />
              )}

              <ActiveForksSection sessions={all} onOpenAll={jumpToCleanup} />
            </>
          ) : projectDrill === null ? (
            // ── Workspace scope = project list ────────────────────────────
            <ScopedProjectList
              workspace={scope}
              projects={app.projectsByWorkspace[scope] ?? []}
              sessionsByProject={app.sessionsByProject}
              clusters={
                Array.isArray(app.clustersByWorkspace[scope])
                  ? (app.clustersByWorkspace[scope] as {
                      name: string;
                      projectIds: string[];
                    }[])
                  : undefined
              }
              onJumpProject={drillIntoProject}
              onRecluster={async () => {
                try {
                  await app.runClustering(scope);
                  toast.success("Re-clustered");
                } catch (err) {
                  toast.error(
                    "Cluster failed",
                    err instanceof Error ? err.message : String(err),
                  );
                }
              }}
            />
          ) : (
            // ── Project drill = session list of that project ──────────────
            <ScopedSessionList
              projectPath={projectDrill}
              workspace={scope}
              sessions={app.sessionsByProject[projectDrill] ?? []}
              sessionTitles={app.sessionTitles}
              onBack={() => setProjectDrill(null)}
              onOpenSession={(sessionId) => openSession(projectDrill, sessionId)}
              onRefresh={() => app.refreshAll()}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Day bucketing ---------------------------------------------------

function buildDayBuckets(sessions: AllSession[]): DayBucket[] {
  const byDay = new Map<number, AllSession[]>();
  for (const s of sessions) {
    if (!s.lastActive) continue;
    const d = new Date(s.lastActive);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    let arr = byDay.get(dayStart);
    if (!arr) {
      arr = [];
      byDay.set(dayStart, arr);
    }
    arr.push(s);
  }
  const buckets: DayBucket[] = [];
  for (const [dayStart, arr] of byDay) {
    arr.sort((a, b) => a.startedAt - b.startedAt);
    buckets.push({ dayStart, sessions: arr });
  }
  buckets.sort((a, b) => b.dayStart - a.dayStart);
  return buckets;
}

// ---------- Scoped project list (when a workspace pill is picked) ----------

function ScopedProjectList({
  projects,
  sessionsByProject,
  clusters,
  onJumpProject,
  onRecluster,
}: {
  workspace: string;
  projects: { path: string; name: string; sessionCount: number }[];
  sessionsByProject: ReturnType<typeof useApp>["sessionsByProject"];
  clusters: { name: string; projectIds: string[] }[] | undefined;
  onJumpProject: (projectPath: string) => void;
  onRecluster: () => Promise<void>;
}) {
  const hasClusters = Array.isArray(clusters) && clusters.length > 0;
  const [view, setView] = useState<"topic" | "time">(
    hasClusters ? "topic" : "time",
  );
  const [reclusterPending, setReclusterPending] = useState(false);

  const ordered = useMemo(() => {
    const annotated = projects.map((p) => {
      const top = sessionsByProject[p.path]?.[0];
      return {
        ...p,
        lastActive: top?.lastActive ?? 0,
        branch: top?.gitBranch ?? null,
      };
    });
    annotated.sort((a, b) => b.lastActive - a.lastActive);
    return annotated;
  }, [projects, sessionsByProject]);

  const byPath = useMemo(
    () =>
      new Map(
        projects.map((p) => [p.path, p] as const),
      ),
    [projects],
  );

  const clusterGroups = useMemo(() => {
    if (!hasClusters || !clusters) return [];
    const claimed = new Set<string>();
    const groups = clusters
      .filter((c) => !c.name.toLowerCase().includes("unsorted"))
      .map((c) => {
        const ids = c.projectIds.filter((id) => byPath.has(id));
        ids.forEach((id) => claimed.add(id));
        return { name: c.name, projectIds: ids };
      })
      .filter((g) => g.projectIds.length > 0);
    const unclaimed = projects
      .map((p) => p.path)
      .filter((id) => !claimed.has(id));
    if (unclaimed.length > 0) {
      groups.push({ name: "Uncategorized", projectIds: unclaimed });
    }
    return groups;
  }, [clusters, hasClusters, byPath, projects]);

  async function handleRecluster() {
    setReclusterPending(true);
    try {
      await onRecluster();
      setView("topic");
    } finally {
      setReclusterPending(false);
    }
  }

  if (ordered.length === 0) {
    return (
      <div className="rounded-[10px] border border-border bg-cc-card px-4 py-6 text-center text-[12px] text-muted-foreground">
        No projects yet — start one with New scratch.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        {hasClusters ? (
          <div className="flex items-center gap-1 rounded-full border border-border bg-cc-surface-press p-1">
            <ToggleSeg
              active={view === "topic"}
              onClick={() => setView("topic")}
              label="By topic"
            />
            <ToggleSeg
              active={view === "time"}
              onClick={() => setView("time")}
              label="By time"
            />
          </div>
        ) : (
          <span className="text-[11px] text-muted-foreground">
            {ordered.length} projects · most recent first
          </span>
        )}
        <button
          onClick={handleRecluster}
          disabled={reclusterPending}
          className="flex items-center gap-1.5 rounded-cc-md border border-border bg-cc-card px-3 py-1.5 text-[11.5px] font-medium text-foreground transition-colors hover:bg-cc-surface-press disabled:opacity-50"
        >
          <Sparkles className="h-3 w-3" />
          {reclusterPending
            ? "Clustering…"
            : hasClusters
              ? "Re-cluster"
              : "AI Cluster"}
        </button>
      </div>

      {view === "topic" && hasClusters ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {clusterGroups.map((g) => (
            <ClusterCard
              key={g.name}
              name={g.name}
              projectIds={g.projectIds}
              byPath={byPath}
              onJump={onJumpProject}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col rounded-[10px] border border-border bg-cc-card">
          {ordered.map((p, i) => (
            <ScopedProjectRow
              key={p.path}
              name={p.name}
              path={p.path}
              sessionCount={p.sessionCount}
              lastActive={p.lastActive}
              branch={p.branch}
              isFirst={i === 0}
              onClick={() => onJumpProject(p.path)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ToggleSeg({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1 text-[11.5px] font-medium transition-colors",
        active
          ? "bg-cc-card text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function ScopedSessionList({
  projectPath,
  workspace,
  sessions,
  sessionTitles,
  onBack,
  onOpenSession,
  onRefresh,
}: {
  projectPath: string;
  workspace: string;
  sessions: import("../types/cairn-api").Session[];
  sessionTitles: Record<string, string>;
  onBack: () => void;
  onOpenSession: (sessionId: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const ordered = useMemo(
    () => [...sessions].sort((a, b) => b.lastActive - a.lastActive),
    [sessions],
  );

  const recent = ordered.slice(0, 30);
  const unnamedCount = recent.filter((s) => !sessionTitles[s.id]).length;

  const [aiPending, setAiPending] = useState(false);
  const [aiProgress, setAiProgress] = useState({ done: 0, total: 0 });

  async function generateAISummaries() {
    const toName = recent.filter((s) => !sessionTitles[s.id]);
    if (toName.length === 0) return;
    setAiPending(true);
    setAiProgress({ done: 0, total: toName.length });
    let done = 0;
    let errored = 0;
    // Concurrency: 2 — we're shelling out to the local `claude` CLI per
    // session. Going higher floods file handles + the user's machine.
    const queue = [...toName];
    async function worker() {
      while (queue.length > 0) {
        const s = queue.shift();
        if (!s) break;
        try {
          const ctx = await window.cairn.getSessionContext(projectPath, s.id);
          const r = await window.cairn.renameSuggestions({
            kind: "session",
            context: ctx,
          });
          const top = r.suggestions[0];
          if (top?.name) {
            await window.cairn.setSessionTitle(s.id, top.name);
          }
        } catch {
          errored += 1;
        } finally {
          done += 1;
          setAiProgress({ done, total: toName.length });
        }
      }
    }
    await Promise.all([worker(), worker()]);
    await onRefresh();
    setAiPending(false);
    if (errored === 0) {
      toast.success(`Named ${done} session${done === 1 ? "" : "s"}`);
    } else {
      toast.info(
        `Named ${done - errored} of ${done}`,
        `${errored} failed — see ~/.claude/cairn/logs`,
      );
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Breadcrumb + AI summaries action — sits above the list, replacing the
          old in-card back row. Workspace name is muted; project name is the
          heaviest element on the row. */}
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={onBack}
          className="-ml-1 flex items-baseline gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-cc-surface-hover"
        >
          <ChevronLeft className="h-4 w-4 self-center text-foreground" />
          <span className="text-[14px] font-medium leading-none text-muted-foreground">
            {basename(workspace)}
          </span>
          <ChevronRight className="h-3 w-3 self-center text-muted-foreground" />
          <span className="text-[18px] font-bold leading-none tracking-tight text-foreground">
            {basename(projectPath)}
          </span>
          <span className="text-[14px] font-medium leading-none text-muted-foreground">
            · {ordered.length} session{ordered.length === 1 ? "" : "s"}
          </span>
        </button>

        {unnamedCount > 0 && (
          <button
            onClick={generateAISummaries}
            disabled={aiPending}
            className="flex items-center gap-2 rounded-cc-md bg-foreground px-3.5 py-2 text-[12px] font-semibold text-background shadow-[0_1px_2px_rgba(0,0,0,0.06),0_4px_12px_-4px_rgba(0,0,0,0.18)] dark:shadow-[0_1px_0_rgba(0,0,0,0.2),0_6px_18px_-6px_rgba(0,0,0,0.6)] transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            <Sparkles className="h-3 w-3" />
            {aiPending
              ? `Generating… ${aiProgress.done}/${aiProgress.total}`
              : `Generate AI summaries · ${unnamedCount}`}
          </button>
        )}
      </div>

      <div className="flex flex-col rounded-[10px] border border-border bg-cc-card">
        {ordered.length === 0 ? (
          <p className="px-4 py-6 text-center text-[12px] text-muted-foreground">
            No sessions yet.
          </p>
        ) : (
          ordered.map((s, i) => (
            <SessionInProjectRow
              key={s.id}
              session={s}
              isFirst={i === 0}
              onClick={() => onOpenSession(s.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function SessionInProjectRow({
  session,
  isFirst,
  onClick,
}: {
  session: import("../types/cairn-api").Session;
  isFirst: boolean;
  onClick: () => void;
}) {
  const startedClock = new Date(session.startedAt).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const lastClock = new Date(session.lastActive).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-cc-surface-hover",
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
        {cleanTitle(session.title)}
      </span>
      <span className="shrink-0 text-[10.5px] text-muted-foreground">
        {session.messageCount} msg
      </span>
      {session.gitBranch && (
        <span className="shrink-0 truncate font-mono text-[10.5px] text-muted-foreground">
          {session.gitBranch}
        </span>
      )}
      <span className="grow" />
      <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
        {startedClock}–{lastClock}
      </span>
    </button>
  );
}

function ScopedProjectRow({
  name,
  path,
  sessionCount,
  lastActive,
  branch,
  isFirst,
  onClick,
}: {
  name: string;
  path: string;
  sessionCount: number;
  lastActive: number;
  branch: string | null;
  isFirst: boolean;
  onClick: () => void;
}) {
  const color = projectColor(path);
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-baseline gap-3 px-4 py-2.5 text-left transition-colors hover:bg-cc-surface-hover",
        !isFirst && "border-t border-border",
      )}
    >
      <span
        className="h-1.5 w-1.5 shrink-0 translate-y-[1px] self-center rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="truncate text-[13px] font-medium leading-none text-foreground">
        {name}
      </span>
      <span className="shrink-0 text-[12px] font-medium leading-none text-muted-foreground">
        {sessionCount} session{sessionCount === 1 ? "" : "s"}
      </span>
      {branch && (
        <span className="shrink-0 truncate font-mono text-[12px] leading-none text-muted-foreground">
          {branch}
        </span>
      )}
      <span className="grow" />
      <span className="shrink-0 text-[12px] leading-none text-muted-foreground">
        {lastActive ? `${formatRelativeTime(lastActive)} ago` : "—"}
      </span>
      <ChevronRight className="h-3 w-3 shrink-0 self-center text-muted-foreground" />
    </button>
  );
}

// ---------- Workspace chips -------------------------------------------------

function WorkspaceChips({
  chips,
  unsortedCount,
  totalSessions,
  scope,
  onPickAll,
  onPickWorkspace,
  onManage,
}: {
  chips: { path: string; name: string; count: number }[];
  unsortedCount: number;
  totalSessions: number;
  scope: string | null;
  onPickAll: () => void;
  onPickWorkspace: (path: string) => void;
  onManage: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Chip
        selected={scope === null}
        onClick={onPickAll}
        leadingIcon={<span className="h-2.5 w-2.5 rounded-full bg-cc-accent" />}
      >
        All <span className="text-[12px] font-medium text-muted-foreground">{totalSessions}</span>
      </Chip>
      {chips.map((c) => (
        <Chip
          key={c.path}
          selected={scope === c.path}
          onClick={() => onPickWorkspace(c.path)}
          leadingIcon={<Folder className="h-3 w-3 text-muted-foreground" />}
        >
          <span className="text-foreground">{c.name}</span>
          <span className="text-[12px] font-medium text-muted-foreground">{c.count}</span>
        </Chip>
      ))}
      {unsortedCount > 0 && (
        <Chip leadingIcon={<Sparkles className="h-3 w-3 text-cc-claude" />}>
          <span className="text-foreground">Unsorted</span>
          <span className="text-[12px] font-semibold text-cc-claude">
            {unsortedCount}
          </span>
        </Chip>
      )}
      <span className="grow" />
      <Chip
        onClick={onManage}
        leadingIcon={<Settings2 className="h-3 w-3 text-muted-foreground" />}
      >
        <span className="text-[11.5px] font-medium text-muted-foreground">
          Manage workspaces
        </span>
      </Chip>
    </div>
  );
}

function Chip({
  selected,
  onClick,
  leadingIcon,
  children,
}: {
  selected?: boolean;
  onClick?: () => void;
  leadingIcon?: React.ReactNode;
  children: React.ReactNode;
}) {
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[12px] font-medium transition-colors",
        selected
          ? "bg-foreground text-background shadow-[0_1px_2px_rgba(0,0,0,0.06),0_4px_12px_-4px_rgba(0,0,0,0.18)] dark:shadow-[0_1px_0_rgba(0,0,0,0.2),0_6px_18px_-6px_rgba(0,0,0,0.6)] [&_span]:!text-background [&_svg]:!text-background"
          : onClick
            ? "border border-transparent hover:border-border hover:bg-cc-surface-hover"
            : "border border-transparent",
      )}
    >
      {leadingIcon}
      {children}
    </Tag>
  );
}

// ---------- Search bar ------------------------------------------------------

function SearchBar({
  allSessions,
  workspaces,
  projectsByWorkspace,
  onPickSession,
  onPickProject,
  onPickWorkspace,
}: {
  allSessions: AllSession[];
  workspaces: string[];
  projectsByWorkspace: Record<
    string,
    { path: string; name: string; sessionCount: number }[]
  >;
  onPickSession: (s: AllSession) => void;
  onPickProject: (path: string, workspacePath: string) => void;
  onPickWorkspace: (path: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  // Disk-backed semantic results, merged into lexical scoring. Empty when
  // ollama is down or the index hasn't been built yet — gracefully falls
  // back to lexical-only.
  const [vectorMap, setVectorMap] = useState<Map<string, number>>(new Map());
  // Snippet text from the vector backend, keyed by sessionId. Used to
  // show what actually matched when the session title alone doesn't
  // explain why a result surfaced.
  const [vectorText, setVectorText] = useState<Map<string, string>>(new Map());
  // Debounce vector calls — embedding round-trip is ~50–200ms so we don't
  // want to fire one keystroke at a time.
  const vectorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ⌘K to focus + open
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const cmd = e.metaKey || e.ctrlKey;
      if (cmd && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      } else if (e.key === "Escape" && document.activeElement === inputRef.current) {
        inputRef.current?.blur();
        setOpen(false);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Fire a vector search ~250ms after the user stops typing. Result merges
  // back into lexical scoring via vectorMap. If ollama isn't up the IPC
  // returns [] and we silently stay lexical-only.
  useEffect(() => {
    if (vectorTimer.current) clearTimeout(vectorTimer.current);
    if (!query.trim()) {
      setVectorMap(new Map());
      setVectorText(new Map());
      return;
    }
    vectorTimer.current = setTimeout(async () => {
      try {
        const hits = await window.cairn.lancedbSearch({ query, topK: 50 });
        const scores = new Map<string, number>();
        const texts = new Map<string, string>();
        for (const h of hits) {
          scores.set(h.sessionId, h.score);
          if (h.text) texts.set(h.sessionId, h.text);
        }
        setVectorMap(scores);
        setVectorText(texts);
      } catch {
        setVectorMap(new Map());
        setVectorText(new Map());
      }
    }, 250);
    return () => {
      if (vectorTimer.current) clearTimeout(vectorTimer.current);
    };
  }, [query]);

  const hits = useMemo(
    () =>
      searchAll({
        query,
        sessions: allSessions,
        workspaces,
        projectsByWorkspace,
        vector: vectorMap,
        vectorText,
      }),
    [query, allSessions, workspaces, projectsByWorkspace, vectorMap, vectorText],
  );

  // Reset highlight when results change.
  useEffect(() => {
    setHighlightIdx(0);
  }, [query]);

  const showResults = open && query.trim().length > 0;

  function selectHit(hit: SearchHit) {
    if (hit.kind === "session") onPickSession(hit.session);
    else if (hit.kind === "project") onPickProject(hit.path, hit.workspacePath);
    else onPickWorkspace(hit.path);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  }

  return (
    <div className="relative">
      <div
        className={cn(
          "flex items-center gap-3 rounded-[14px] border border-border bg-cc-card px-4 py-2.5 transition-shadow",
          open &&
            "shadow-[0_4px_16px_-6px_rgba(0,0,0,0.18)] dark:shadow-[0_8px_24px_-6px_rgba(0,0,0,0.4)]",
        )}
      >
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Delay so click on result still fires.
            setTimeout(() => setOpen(false), 120);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlightIdx((i) => Math.min(i + 1, hits.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlightIdx((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const hit = hits[highlightIdx];
              if (hit) selectHit(hit);
            }
          }}
          placeholder="Search sessions, projects, workspaces…"
          className="grow bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        <kbd className="flex items-center gap-1 rounded-[6px] border border-border bg-cc-surface-base px-1.5 py-[2px] text-[10px] font-semibold text-cc-accent-fg">
          ⌘K
        </kbd>
      </div>

      {showResults && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1.5 max-h-[480px] overflow-y-auto rounded-[12px] border border-border bg-cc-card shadow-2xl">
          {hits.length === 0 ? (
            <div className="px-4 py-6 text-center text-[12px] text-muted-foreground">
              No matches for "{query}".
            </div>
          ) : (
            <ResultGroups
              hits={hits}
              query={query}
              highlightIdx={highlightIdx}
              onHover={setHighlightIdx}
              onPick={selectHit}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ResultGroups({
  hits,
  query,
  highlightIdx,
  onHover,
  onPick,
}: {
  hits: SearchHit[];
  query: string;
  highlightIdx: number;
  onHover: (idx: number) => void;
  onPick: (hit: SearchHit) => void;
}) {
  // Hits are already sorted by score globally. Group by kind for visual
  // separation but keep within-group order = score order.
  const sessionHits = hits.filter((h) => h.kind === "session");
  const projectHits = hits.filter((h) => h.kind === "project");
  const workspaceHits = hits.filter((h) => h.kind === "workspace");

  const flat = [...sessionHits, ...projectHits, ...workspaceHits];

  function rowIdx(h: SearchHit): number {
    return flat.indexOf(h);
  }

  return (
    <div className="flex flex-col py-1">
      {sessionHits.length > 0 && (
        <Group label="Sessions">
          {sessionHits.map((h) => {
            const i = rowIdx(h);
            const sh = h as Extract<SearchHit, { kind: "session" }>;
            const s = sh.session;
            const title = cleanTitle(s.customTitle ?? s.activeName ?? s.title);
            const project = basename(s.dominantCwd ?? s.launchedFrom ?? "—");
            return (
              <ResultRow
                key={`s-${s.id}`}
                highlighted={i === highlightIdx}
                onMouseEnter={() => onHover(i)}
                onClick={() => onPick(h)}
                icon={
                  s.active ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-cc-success" />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-cc-surface-strong" />
                  )
                }
                title={title}
                meta={`${project} · ${s.messageCount} msg`}
                snippet={pickSnippet(title, sh.snippet, query)}
                trailing={
                  s.lastActive ? `${formatRelativeTime(s.lastActive)} ago` : ""
                }
              />
            );
          })}
        </Group>
      )}

      {projectHits.length > 0 && (
        <Group label="Projects">
          {projectHits.map((h) => {
            const i = rowIdx(h);
            const p = h as Extract<SearchHit, { kind: "project" }>;
            return (
              <ResultRow
                key={`p-${p.path}`}
                highlighted={i === highlightIdx}
                onMouseEnter={() => onHover(i)}
                onClick={() => onPick(h)}
                icon={<Folder className="h-3 w-3 text-muted-foreground" />}
                title={p.name}
                meta={`${basename(p.workspacePath)} · ${p.sessionCount} session${p.sessionCount === 1 ? "" : "s"}`}
                trailing=""
              />
            );
          })}
        </Group>
      )}

      {workspaceHits.length > 0 && (
        <Group label="Workspaces">
          {workspaceHits.map((h) => {
            const i = rowIdx(h);
            const w = h as Extract<SearchHit, { kind: "workspace" }>;
            return (
              <ResultRow
                key={`w-${w.path}`}
                highlighted={i === highlightIdx}
                onMouseEnter={() => onHover(i)}
                onClick={() => onPick(h)}
                icon={<Settings2 className="h-3 w-3 text-muted-foreground" />}
                title={w.name}
                meta={w.path}
                trailing=""
              />
            );
          })}
        </Group>
      )}
    </div>
  );
}

function Group({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <span className="px-3 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

function ResultRow({
  highlighted,
  onMouseEnter,
  onClick,
  icon,
  title,
  meta,
  snippet,
  trailing,
}: {
  highlighted: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  meta: string;
  snippet?: string | null;
  trailing: string;
}) {
  return (
    <button
      onMouseEnter={onMouseEnter}
      onMouseDown={(e) => e.preventDefault() /* keep input focused */}
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-2.5 px-3 py-1.5 text-left",
        highlighted ? "bg-cc-surface-press" : "hover:bg-cc-surface-hover",
      )}
    >
      <span className="mt-1 flex w-3 shrink-0 items-center justify-center">
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2.5">
          <span className="truncate text-[12.5px] font-medium text-foreground">
            {title}
          </span>
          <span className="shrink-0 truncate text-[10.5px] text-muted-foreground">
            {meta}
          </span>
          <span className="grow" />
          {trailing && (
            <span className="shrink-0 text-[10.5px] text-muted-foreground">
              {trailing}
            </span>
          )}
        </div>
        {snippet && (
          <span className="mt-0.5 truncate text-[10.5px] italic text-muted-foreground">
            {snippet}
          </span>
        )}
      </div>
    </button>
  );
}

/**
 * If the title already contains the query (case-insensitive), no snippet
 * needed — the row visually explains itself. Otherwise build a ~80-char
 * window around the first matched query token in the indexed text. This
 * is what surfaces vector-only / BM25-on-content matches to the user.
 */
function pickSnippet(
  title: string,
  text: string | undefined,
  query: string,
): string | undefined {
  if (!text) return undefined;
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  if (title.toLowerCase().includes(q)) return undefined;

  const lower = text.toLowerCase();
  // Try to anchor on any whitespace-separated query token; fall back to
  // a head snippet if nothing matched (vector hits without lexical overlap).
  const tokens = q.split(/\s+/).filter((t) => t.length >= 2);
  let anchor = -1;
  for (const tok of tokens) {
    const i = lower.indexOf(tok);
    if (i >= 0) {
      anchor = i;
      break;
    }
  }
  if (anchor < 0) {
    return text.slice(0, 80) + (text.length > 80 ? "…" : "");
  }
  const start = Math.max(0, anchor - 30);
  const end = Math.min(text.length, anchor + 50);
  return (
    (start > 0 ? "…" : "") +
    text.slice(start, end) +
    (end < text.length ? "…" : "")
  );
}

// ---------- Suggested actions -----------------------------------------------

function SuggestedActions({
  onResumeLast,
  onScratch,
  onOpenActive,
  onCleanup,
  cleanupCount,
  activeCount,
  disabled,
}: {
  onResumeLast: () => void;
  onScratch: () => void;
  onOpenActive: () => void;
  onCleanup: () => void;
  cleanupCount: number;
  activeCount: number;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="px-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Suggested actions
      </span>
      <div className="flex flex-wrap gap-2">
        <ActionChip
          icon={<Play className="h-[14px] w-[14px] text-cc-accent" />}
          label="Resume last"
          accessory="⏎"
          onClick={onResumeLast}
          disabled={disabled}
        />
        <ActionChip
          icon={<Plus className="h-[14px] w-[14px] text-foreground" />}
          label="New scratch"
          accessory="⌘N"
          onClick={onScratch}
        />
        <ActionChip
          icon={<CircleDot className="h-[14px] w-[14px] text-cc-success" />}
          label="Open active"
          accessory={activeCount > 0 ? String(activeCount) : "0"}
          onClick={onOpenActive}
          disabled={activeCount === 0}
        />
        <ActionChip
          icon={<Trash2 className="h-[14px] w-[14px] text-muted-foreground" />}
          label="Cleanup"
          accessory={
            <span className="font-semibold text-cc-claude">{cleanupCount}</span>
          }
          onClick={onCleanup}
          disabled={cleanupCount === 0}
        />
      </div>
    </div>
  );
}

function ActionChip({
  icon,
  label,
  accessory,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  accessory: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-2 rounded-[10px] border border-border bg-cc-surface-elevated px-3.5 py-2.5 text-[13px] font-medium text-foreground transition-colors",
        disabled
          ? "opacity-50"
          : "hover:border-[#3072F099] hover:bg-cc-surface-press",
      )}
    >
      <span className="flex h-[14px] w-[14px] items-center justify-center">
        {icon}
      </span>
      <span className="leading-none">{label}</span>
      <span className="flex items-center justify-center leading-none text-[11px] font-normal text-muted-foreground">
        {accessory}
      </span>
    </button>
  );
}

// ---------- Day card (today / yesterday — large) ----------------------------

function DayCardLarge({
  bucket,
  kind,
  onClickSession,
}: {
  bucket: DayBucket;
  kind: "today" | "yesterday";
  onClickSession: (s: AllSession) => void;
}) {
  const date = new Date(bucket.dayStart);
  const dateLabel =
    kind === "today"
      ? `Today · ${formatWeekday(date)}, ${formatMonthDay(date)}`
      : `Yesterday · ${formatWeekday(date)}, ${formatMonthDay(date)}`;

  const sessions = bucket.sessions;
  const activeCount = sessions.filter((s) => s.active).length;
  const focusHours = computeFocusHours(sessions);
  const summary = synthesize(sessions);

  return (
    <section className="flex flex-col gap-2.5 rounded-[12px] border border-border bg-cc-card px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[18px] font-semibold leading-tight tracking-[-0.2px] text-foreground">
            {dateLabel}
          </h2>
          <p className="text-[11.5px] text-muted-foreground">
            {sessions.length} session{sessions.length === 1 ? "" : "s"}
            {focusHours > 0 && ` · ${focusHours.toFixed(1)}h`}
            {activeCount > 0 && ` · ${activeCount} active`}
          </p>
        </div>
        {activeCount > 0 && (
          <span
            className="flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10.5px] font-medium text-cc-accent-light"
            style={{
              backgroundColor: "#3072F01F",
              border: "1px solid #3072F052",
            }}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-cc-accent" />
            {activeCount} active
          </span>
        )}
      </div>

      <SynthesisBox text={summary} compact />

      <Timeline sessions={sessions} />

      <div className="flex flex-col">
        {sessions.map((s, i) => (
          <SessionRow
            key={s.id}
            session={s}
            withDivider={i > 0}
            compact
            onClick={() => onClickSession(s)}
          />
        ))}
      </div>
    </section>
  );
}

// ---------- Day card (compact — third day) ----------------------------------

function DayCardCompact({
  bucket,
  onClickSession,
}: {
  bucket: DayBucket;
  onClickSession: (s: AllSession) => void;
}) {
  const date = new Date(bucket.dayStart);
  const sessions = bucket.sessions;
  const focusHours = computeFocusHours(sessions);
  const summary = synthesize(sessions);

  return (
    <section className="flex flex-col gap-4 rounded-[14px] border border-border bg-cc-card px-5 py-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[18px] font-semibold leading-tight text-foreground">
            {formatWeekday(date)}, {formatMonthDay(date)}
          </h2>
          <p className="text-[12px] text-muted-foreground">
            {sessions.length} session{sessions.length === 1 ? "" : "s"}
            {focusHours > 0 && ` · ${focusHours.toFixed(1)}h total`}
            {sessions.length >= 5 && ` · fragmented`}
          </p>
        </div>
        <span className="rounded-full bg-cc-surface-hover px-2.5 py-1 text-[10.5px] font-medium text-muted-foreground">
          {sessions.length}
        </span>
      </div>

      <SynthesisBox text={summary} compact />

      <CompactTimeline sessions={sessions} />

      <div className="flex flex-col">
        {sessions.map((s, i) => (
          <SessionRow
            key={s.id}
            session={s}
            withDivider={i > 0}
            compact
            onClick={() => onClickSession(s)}
          />
        ))}
      </div>
    </section>
  );
}

// ---------- Synthesis -------------------------------------------------------

function SynthesisBox({ text, compact }: { text: string; compact?: boolean }) {
  // V2-K l5KV9 spec: bg #F0934014 (8% alpha) + border #F0934026 (~15% alpha)
  // r10, padding 14/16. Icon wrap is 24x24 r6 with bg #F0934033 (20% alpha).
  return (
    <div
      className="flex gap-3 rounded-[10px] px-4 py-3.5"
      style={{
        backgroundColor: "#F0934014",
        border: "1px solid #F0934026",
      }}
    >
      <div
        className={cn(
          "flex shrink-0 items-center justify-center rounded-md",
          compact ? "h-[18px] w-[18px]" : "h-6 w-6",
        )}
        style={{ backgroundColor: "#F0934033" }}
      >
        <Sparkles
          className={cn(
            "text-cc-claude",
            compact ? "h-[10px] w-[10px]" : "h-3.5 w-3.5",
          )}
        />
      </div>
      <div className="flex flex-col gap-1">
        {!compact && (
          <span
            className="text-[11px] font-semibold uppercase text-cc-claude"
            style={{ letterSpacing: "0.4px" }}
          >
            Daily synthesis
          </span>
        )}
        <p className="text-[13px] leading-[1.55] text-foreground">{text}</p>
      </div>
    </div>
  );
}

function synthesize(sessions: AllSession[]): string {
  if (sessions.length === 0) return "No activity yet.";
  const projectFreq = new Map<string, number>();
  for (const s of sessions) {
    const p = s.dominantCwd ?? s.launchedFrom;
    if (!p) continue;
    projectFreq.set(p, (projectFreq.get(p) ?? 0) + 1);
  }
  const topProjects = [...projectFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([p]) => basename(p));
  const totalMsgs = sessions.reduce((s, x) => s + x.messageCount, 0);
  const longest = [...sessions].sort((a, b) => b.messageCount - a.messageCount)[0];
  const longestLabel = cleanTitle(
    longest?.customTitle ?? longest?.activeName ?? longest?.title ?? "an unnamed thread",
  );

  if (sessions.length === 1) {
    return `One session in ${topProjects[0] ?? "an untracked folder"} — ${totalMsgs} message${totalMsgs === 1 ? "" : "s"}.`;
  }
  if (topProjects.length === 1) {
    return `${sessions.length} sessions, all in ${topProjects[0]}. ${totalMsgs} messages total — the longest stretch was "${truncate(longestLabel, 60)}".`;
  }
  return `${sessions.length} sessions across ${topProjects.join(", ")}. ${totalMsgs} messages total — the deepest one was "${truncate(longestLabel, 60)}".`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/**
 * Aggressive markup stripper used when embedding session titles. Removes
 * <command-message>, <teammate-message>, <system-reminder>,
 * <local-command-caveat> and friends — anything that's CLI/agent
 * boilerplate rather than the user's actual intent. Distinct from
 * cleanTitle() which is more conservative (keeps fallback if everything
 * is stripped).
 */
function stripMarkup(raw: string): string {
  if (!raw) return "";
  let s = raw;
  // Closed pairs WITH OPTIONAL ATTRIBUTES on the opening tag, greedy
  // across newlines: <foo bar="baz">...</foo>.
  s = s.replace(/<([a-z][a-z0-9-]*)(?:\s+[^>]*)?>[\s\S]*?<\/\1\s*>/gi, " ");
  // Dangling self-closed or orphan opening tags (also with attrs).
  s = s.replace(/<\/?[a-z][a-z0-9-]*(?:\s+[^>]*)?\/?>/gi, " ");
  // Stray brackets, collapse whitespace.
  s = s.replace(/[<>]/g, " ").replace(/\s+/g, " ").trim();
  return s;
}

// Slash-command invocations land in the JSONL as `<command-message>init…`
// markup. Strip it for display so the dashboard doesn't show raw tags.
// Handles closed, dangling, and orphan tags.
function cleanTitle(raw: string | null | undefined): string {
  if (!raw) return "(untitled)";
  // If it's pure command markup, recover the slash-command name.
  const cmdMatch = raw.match(/<command-name>\s*\/?([\w-]+)/);
  // Strip tag pairs first.
  let s = raw.replace(/<command-(?:message|name|args)>[\s\S]*?<\/command-[^>]+>/g, "");
  // Strip any remaining tag-like fragments (closed, opened, or dangling).
  s = s.replace(/<\/?[a-z-]+\s*>?/gi, "");
  // Strip stray angle brackets.
  s = s.replace(/[<>]/g, "");
  s = s.trim();
  if (!s) {
    return cmdMatch ? `/${cmdMatch[1]}` : "(slash command)";
  }
  // If the title was almost entirely command markup with one leftover word,
  // prefer the friendlier slash form.
  if (cmdMatch && s.length < 6) {
    return `/${cmdMatch[1]}`;
  }
  return s;
}

// ---------- Timeline (large) ------------------------------------------------

function Timeline({ sessions }: { sessions: AllSession[] }) {
  // 8a–8p (12 hours) horizontal track. Each session = colored block.
  // Matches V2-K Today card spec: track h=50, baseline at y=46, ticks
  // 6px tall, blocks h=34 at y=6, active halo h=44 at y=1, "Now" line
  // 50px tall accent.
  const HOUR_START = 8;
  const HOUR_END = 20;
  const HOURS = HOUR_END - HOUR_START;
  const ticks = Array.from({ length: HOURS + 1 }, (_, i) => i);

  function pct(ms: number): number {
    if (!ms) return 0;
    const d = new Date(ms);
    const hour = d.getHours() + d.getMinutes() / 60;
    if (hour <= HOUR_START) return 0;
    if (hour >= HOUR_END) return 1;
    return (hour - HOUR_START) / HOURS;
  }

  // Stable "now" position for current viewer time so the indicator
  // shows up even on dates other than today (offset to end-of-day on
  // past days, or omit if today not in track).
  const now = new Date();
  const showNow = sessions.some(
    (s) => new Date(s.lastActive).toDateString() === now.toDateString(),
  );
  const nowHour = now.getHours() + now.getMinutes() / 60;
  const nowPct =
    nowHour > HOUR_START && nowHour < HOUR_END
      ? (nowHour - HOUR_START) / HOURS
      : null;

  return (
    <div className="flex flex-col gap-2 pt-2">
      <div className="relative h-[60px]">
        {/* Baseline at y=50, height 1. Uses --input (0.15 white) which
            reads better than --border (0.10) at 1px on dark cards. */}
        <div className="absolute left-0 right-0 top-[50px] h-px bg-input" />
        {/* Hour ticks: 1px wide, 6px tall straddling baseline (y=46 → y=52) */}
        {ticks.map((i) => (
          <span
            key={i}
            className="absolute top-[46px] h-[6px] w-px bg-input"
            style={{ left: `${(i / HOURS) * 100}%` }}
          />
        ))}
        {/* Active session = single block with success-green border (no halo).
            User feedback: two-frame halo + block reads as visual noise. */}
        {/* Now indicator: 1px wide, 50px tall accent line at current hour */}
        {showNow && nowPct !== null && (
          <span
            className="pointer-events-none absolute top-0 h-[50px] w-px bg-cc-accent opacity-60"
            style={{ left: `${nowPct * 100}%` }}
          />
        )}
        {/* Blocks — V2-K spec: r=7, h=34, y=6, border 1px (1.5px when active) */}
        {sessions.map((s) => {
          const start = pct(s.startedAt || s.lastActive);
          const end = pct(s.lastActive);
          const left = Math.max(0, Math.min(start, end));
          const right = Math.max(start, end);
          const width = Math.max(right - left, 0.018);
          const color = projectColor(s.dominantCwd ?? s.launchedFrom);
          const labelText = s.customTitle
            ? cleanTitle(s.customTitle)
            : basename(s.dominantCwd ?? s.launchedFrom ?? "—");
          return (
            <div
              key={s.id}
              className="absolute top-[6px] flex h-[34px] items-center overflow-hidden rounded-[7px] px-2 text-[10.5px] font-medium"
              style={{
                left: `${left * 100}%`,
                width: `${width * 100}%`,
                backgroundColor: s.active ? "#22C55E40" : color + "33",
                border: s.active
                  ? "1.5px solid #22C55E"
                  : `1px solid ${color}A6`,
                color: s.active ? "#FFFFFF" : "currentColor",
              }}
              title={`${labelText} · ${formatClock(s.startedAt)} – ${s.active ? "now" : formatClock(s.lastActive)}`}
            >
              <span className="truncate">{labelText}</span>
            </div>
          );
        })}
      </div>
      {/* Hour labels */}
      <div className="relative h-3">
        {[8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map((h) => {
          const pos = (h - HOUR_START) / HOURS;
          const lbl =
            h === 8
              ? "8a"
              : h === 12
                ? "12p"
                : h === 20
                  ? "8p"
                  : h > 12
                    ? String(h - 12)
                    : String(h);
          return (
            <span
              key={h}
              className="absolute text-[9.5px] font-medium text-muted-foreground"
              style={{ left: `${pos * 100}%`, transform: "translateX(-50%)" }}
            >
              {lbl}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function CompactTimeline({ sessions }: { sessions: AllSession[] }) {
  // Yesterday/older day card. 6 AM – 10 PM strip with axis labels above
  // and four interior tick lines at 4-hour intervals.
  const HOUR_START = 6;
  const HOUR_END = 22;
  const HOURS = HOUR_END - HOUR_START;
  function pct(ms: number): number {
    if (!ms) return 0;
    const d = new Date(ms);
    const hour = d.getHours() + d.getMinutes() / 60;
    if (hour <= HOUR_START) return 0;
    if (hour >= HOUR_END) return 1;
    return (hour - HOUR_START) / HOURS;
  }

  const axisLabels: { hour: number; label: string }[] = [
    { hour: 6, label: "6 AM" },
    { hour: 10, label: "10" },
    { hour: 14, label: "2 PM" },
    { hour: 18, label: "6" },
    { hour: 22, label: "10 PM" },
  ];

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between text-[9.5px] font-medium tracking-[0.04em] text-muted-foreground">
        {axisLabels.map((a) => (
          <span key={a.hour}>{a.label}</span>
        ))}
      </div>
      <div className="relative h-[32px] overflow-hidden rounded-md border border-border bg-cc-surface-base">
        {/* Interior tick lines at 10am, 2pm, 6pm */}
        {[10, 14, 18].map((h) => (
          <span
            key={h}
            className="absolute top-0 h-full w-px bg-foreground/[0.04]"
            style={{ left: `${((h - HOUR_START) / HOURS) * 100}%` }}
          />
        ))}
        {sessions.map((s) => {
          const start = pct(s.startedAt || s.lastActive);
          const end = pct(s.lastActive);
          const left = Math.max(0, Math.min(start, end));
          const right = Math.max(start, end);
          const width = Math.max(right - left, 0.012);
          const color = projectColor(s.dominantCwd ?? s.launchedFrom);
          return (
            <span
              key={s.id}
              className="absolute top-[4px] h-6 rounded-[6px]"
              style={{
                left: `${left * 100}%`,
                width: `${width * 100}%`,
                backgroundColor: color,
              }}
              title={basename(s.dominantCwd ?? "—")}
            />
          );
        })}
      </div>
    </div>
  );
}

// ---------- Session row -----------------------------------------------------

function SessionRow({
  session,
  withDivider,
  compact,
  onClick,
}: {
  session: AllSession;
  withDivider?: boolean;
  compact?: boolean;
  onClick?: () => void;
}) {
  const color = projectColor(session.dominantCwd ?? session.launchedFrom);
  const title = cleanTitle(
    session.customTitle ?? session.activeName ?? session.title,
  );
  const project = basename(session.dominantCwd ?? session.launchedFrom ?? "—");
  const startedTime = formatClock(session.startedAt);
  const endedTime = session.active ? "now" : formatClock(session.lastActive);

  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "flex w-full items-center gap-3 px-2 py-1.5 text-left transition-colors hover:bg-cc-surface-hover",
        withDivider && "border-t border-border",
      )}
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span
        className={cn(
          "truncate font-medium text-foreground",
          compact ? "text-[12px]" : "text-[12.5px]",
        )}
      >
        {title}
        {session.forkedFrom && (
          <GitFork className="ml-1.5 inline-block h-2.5 w-2.5 align-[-1px] text-cc-claude" />
        )}
      </span>
      <span className="shrink-0 truncate text-[10.5px] text-muted-foreground">
        {project} · {session.messageCount} msg
      </span>
      <span className="grow" />
      <span
        className={cn(
          "shrink-0 font-mono text-[10.5px]",
          session.active ? "font-semibold text-cc-success" : "text-muted-foreground",
        )}
      >
        {startedTime}–{endedTime}
      </span>
    </button>
  );
}

// ---------- Earlier days (compact rows) -------------------------------------

function EarlierDays({
  buckets,
  onOpenAll,
}: {
  buckets: DayBucket[];
  onOpenAll: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 px-1 pt-2">
      <span className="px-2 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        Earlier this week
      </span>
      <div className="flex flex-col">
        {buckets.map((b) => {
          const date = new Date(b.dayStart);
          const focusHours = computeFocusHours(b.sessions);
          const projectNames = topProjectNames(b.sessions, 3);
          return (
            <button
              key={b.dayStart}
              onClick={onOpenAll}
              className="flex items-center gap-3.5 border-b border-border px-3 py-3.5 text-left hover:bg-cc-surface-hover"
            >
              <span className="w-[80px] shrink-0 text-[12px] font-medium text-foreground">
                {formatWeekday(date, true)} {formatMonthDay(date, true)}
              </span>
              <span className="w-[150px] shrink-0 text-[11px] text-muted-foreground">
                {b.sessions.length} session{b.sessions.length === 1 ? "" : "s"}
                {focusHours > 0 && ` · ${focusHours.toFixed(1)}h focus`}
              </span>
              <span className="grow truncate text-[11.5px] text-muted-foreground">
                {projectNames.join(" · ") || "—"}
              </span>
              <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ViewAllLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-center gap-1.5 px-3 py-2 text-[11.5px] font-medium text-muted-foreground hover:text-foreground"
    >
      View all sessions
      <ChevronRight className="h-3 w-3" />
    </button>
  );
}

// ---------- By topic (clusters) --------------------------------------------

function ByTopicSection({
  workspaces,
  projectsByWorkspace,
  clustersByWorkspace,
  onJumpProject,
  onEnterWorkspace,
  onRecluster,
}: {
  workspaces: string[];
  projectsByWorkspace: ReturnType<typeof useApp>["projectsByWorkspace"];
  clustersByWorkspace: ReturnType<typeof useApp>["clustersByWorkspace"];
  onJumpProject: (projectPath: string) => void;
  onEnterWorkspace: (workspacePath: string) => void;
  onRecluster: (workspacePath: string) => Promise<void>;
}) {
  const wsWithClusters = workspaces.filter((w) => Array.isArray(clustersByWorkspace[w]));
  const primaryWs = wsWithClusters[0] ?? workspaces[0];
  if (!primaryWs) return null;
  const clusters = clustersByWorkspace[primaryWs];
  if (!Array.isArray(clusters) || clusters.length === 0) {
    return (
      <div className="flex flex-col gap-3.5">
        <SectionHeader
          title="By topic"
          meta="No AI clusters yet"
          action="Run cluster →"
          onAction={() => void onRecluster(primaryWs)}
        />
        <div className="rounded-[14px] border border-dashed border-border bg-cc-card px-5 py-6 text-center text-[12px] text-muted-foreground">
          Run AI clustering to group projects by topic.
        </div>
      </div>
    );
  }

  const projects = projectsByWorkspace[primaryWs] ?? [];
  const byPath = new Map(projects.map((p) => [p.path, p]));
  const top = clusters.slice(0, 2);
  const rest = clusters.slice(2, 4);

  return (
    <div className="flex flex-col gap-3.5">
      <SectionHeader
        title="By topic"
        meta={`AI clustered · ${clusters.length} group${clusters.length === 1 ? "" : "s"}`}
        action="Re-cluster →"
        onAction={() => void onRecluster(primaryWs)}
      />
      <div className="grid grid-cols-2 gap-4">
        {top.map((c) => (
          <ClusterCard
            key={c.name}
            name={c.name}
            projectIds={c.projectIds}
            byPath={byPath}
            onJump={onJumpProject}
            onEnterWorkspace={() => onEnterWorkspace(primaryWs)}
          />
        ))}
      </div>
      {rest.length > 0 && (
        <div className="grid grid-cols-2 gap-4">
          {rest.map((c) => (
            <CompactClusterCard
              key={c.name}
              name={c.name}
              count={c.projectIds.length}
              onClick={() => onEnterWorkspace(primaryWs)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ClusterCard({
  name,
  projectIds,
  byPath,
  onJump,
  onEnterWorkspace,
}: {
  name: string;
  projectIds: string[];
  byPath: Map<string, { path: string; name: string; sessionCount: number }>;
  onJump: (path: string) => void;
  onEnterWorkspace?: () => void;
}) {
  const visible = projectIds.slice(0, 4);
  const more = projectIds.length - visible.length;
  return (
    <div className="flex flex-col gap-3.5 rounded-[14px] border border-border bg-cc-card px-5 py-4">
      <button
        onClick={onEnterWorkspace}
        disabled={!onEnterWorkspace}
        className="-mx-1 -my-0.5 flex items-baseline justify-between gap-2 rounded-md px-1 py-0.5 text-left transition-colors enabled:hover:bg-cc-surface-hover disabled:cursor-default"
      >
        <h3 className="text-[15px] font-medium text-foreground">{name}</h3>
        <span className="text-[10.5px] font-medium text-muted-foreground">
          {projectIds.length} projects
        </span>
      </button>
      <div className="flex flex-col">
        {visible.map((id) => {
          const p = byPath.get(id);
          if (!p) return null;
          return (
            <button
              key={id}
              onClick={() => onJump(id)}
              className="flex items-center justify-between gap-3 border-b border-border py-2 text-left hover:bg-cc-surface-hover"
            >
              <span className="truncate text-[12.5px] font-medium text-foreground">
                {p.name}
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {p.sessionCount}
              </span>
            </button>
          );
        })}
      </div>
      {more > 0 && (
        <button
          className="text-[11px] font-medium text-muted-foreground hover:text-foreground hover:underline"
          onClick={onEnterWorkspace}
        >
          + {more} more in this topic →
        </button>
      )}
    </div>
  );
}

function CompactClusterCard({
  name,
  count,
  onClick,
}: {
  name: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 rounded-[14px] border border-border bg-cc-card px-5 py-3.5 text-left hover:bg-cc-surface-press"
    >
      <span className="grow text-[15px] font-medium text-foreground">
        {name}
      </span>
      <span className="text-[11px] text-muted-foreground">
        {count} projects
      </span>
      <ChevronRight className="h-3 w-3 text-muted-foreground" />
    </button>
  );
}

// ---------- Issues found ----------------------------------------------------

function IssuesFoundSection({
  counts,
  onOpenCleanup,
}: {
  counts: {
    subagents: number;
    archive: number;
    folderGone: number;
    drifted: number;
    cleanupTotal: number;
  };
  onOpenCleanup: () => void;
}) {
  return (
    <div className="flex flex-col gap-3.5">
      <SectionHeader
        title="Issues found"
        meta={`${counts.cleanupTotal} stale items polluting \`claude -r\``}
        action="Open Cleanup →"
        onAction={onOpenCleanup}
      />
      <div className="flex flex-col rounded-[14px] border border-border bg-cc-card px-6">
        {counts.subagents > 0 && (
          <IssueRow
            icon={<TriangleAlert className="h-3.5 w-3.5 text-cc-claude" />}
            title={`${counts.subagents} subagent ghost${counts.subagents === 1 ? "" : "s"}`}
            sub="Orphaned Task() research transcripts whose parent session is gone"
            action="Cleanup"
            actionTone="claude"
            onAction={onOpenCleanup}
          />
        )}
        {counts.archive > 0 && (
          <IssueRow
            icon={<Archive className="h-3.5 w-3.5 text-muted-foreground" />}
            title={`${counts.archive} archive ghost${counts.archive === 1 ? "" : "s"}`}
            sub="Transcript already cleaned up — only usage-data meta survives"
            action="Cleanup"
            actionTone="muted"
            onAction={onOpenCleanup}
          />
        )}
        {counts.folderGone > 0 && (
          <IssueRow
            icon={<TriangleAlert className="h-3.5 w-3.5 text-cc-claude" />}
            title={`${counts.folderGone} session${counts.folderGone === 1 ? "" : "s"} with deleted folders`}
            sub="Project folder gone from disk — Claude can't resume these"
            action="Cleanup"
            actionTone="claude"
            onAction={onOpenCleanup}
          />
        )}
        {counts.drifted > 0 && (
          <IssueRow
            icon={<CornerDownRight className="h-3.5 w-3.5 text-muted-foreground" />}
            title={`${counts.drifted} drifted session${counts.drifted === 1 ? "" : "s"}`}
            sub="Launched from a parent dir but actually worked elsewhere"
            action="Re-file"
            actionTone="accent"
            onAction={onOpenCleanup}
          />
        )}
      </div>
    </div>
  );
}

function IssueRow({
  icon,
  title,
  sub,
  action,
  actionTone,
  onAction,
}: {
  icon: React.ReactNode;
  title: string;
  sub: string;
  action: string;
  actionTone: "claude" | "muted" | "accent";
  onAction: () => void;
}) {
  return (
    <div className="flex items-center gap-3.5 border-b border-border last:border-b-0 py-3.5">
      <span className="shrink-0">{icon}</span>
      <div className="grow">
        <p className="text-[12.5px] font-medium text-foreground">{title}</p>
        <p className="text-[11.5px] text-muted-foreground">{sub}</p>
      </div>
      <button
        onClick={onAction}
        className={cn(
          "shrink-0 rounded-md px-2.5 py-1 text-[11px] font-medium",
          actionTone === "claude" && "text-cc-claude hover:bg-[#F0934019]",
          actionTone === "muted" && "text-muted-foreground hover:bg-cc-surface-hover hover:text-foreground",
          actionTone === "accent" && "text-cc-accent-light hover:bg-[#3072F019]",
        )}
      >
        {action}
      </button>
    </div>
  );
}

// ---------- Active forks ----------------------------------------------------

function ActiveForksSection({
  sessions,
  onOpenAll,
}: {
  sessions: AllSession[];
  onOpenAll: () => void;
}) {
  const forks = sessions.filter(
    (s) => s.kind === "primary" && !s.archive && s.forkedFrom,
  );
  if (forks.length === 0) return null;

  // Group by parent session id.
  const byParent = new Map<string, AllSession[]>();
  for (const f of forks) {
    if (!f.forkedFrom) continue;
    const arr = byParent.get(f.forkedFrom.sessionId) ?? [];
    arr.push(f);
    byParent.set(f.forkedFrom.sessionId, arr);
  }
  const visibleParents = [...byParent.entries()].slice(0, 3);

  return (
    <div className="flex flex-col gap-3.5">
      <SectionHeader
        title="Active forks"
        meta={`${forks.length} fork session${forks.length === 1 ? "" : "s"} across ${byParent.size} parent${byParent.size === 1 ? "" : "s"}`}
        action="see all →"
        onAction={onOpenAll}
      />
      <div className="flex flex-col rounded-[14px] border border-border bg-cc-card px-6">
        {visibleParents.map(([parentId, children]) => {
          const parent = sessions.find((s) => s.id === parentId);
          return (
            <div key={parentId} className="flex flex-col gap-1.5 border-b border-border last:border-b-0 py-3.5">
              <div className="flex items-center gap-2">
                <GitFork className="h-3 w-3 text-cc-claude" />
                <span className="truncate text-[12.5px] font-medium text-foreground">
                  {cleanTitle(parent?.customTitle ?? parent?.title ?? `Parent ${parentId.slice(0, 8)}`)}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  · {children.length} child{children.length === 1 ? "" : "ren"}
                </span>
              </div>
              <div className="ml-[18px] flex flex-col gap-0.5">
                {children.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center gap-2 text-[11.5px]"
                  >
                    <CornerDownRight className="h-3 w-3 text-muted-foreground" />
                    <span className="truncate text-foreground">
                      {cleanTitle(c.customTitle ?? c.title ?? "(untitled fork)")}
                    </span>
                    <span className="text-muted-foreground">
                      · {basename(c.dominantCwd ?? "—")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Section header --------------------------------------------------

function SectionHeader({
  title,
  meta,
  action,
  onAction,
}: {
  title: string;
  meta: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="flex items-baseline gap-2.5 px-0.5">
      <h2 className="text-[14px] font-semibold text-foreground">{title}</h2>
      <span className="text-[11px] text-muted-foreground">{meta}</span>
      <span className="grow" />
      <button
        onClick={onAction}
        className="text-[11.5px] font-medium text-cc-accent-light hover:underline"
      >
        {action}
      </button>
    </div>
  );
}

// ---------- Helpers ---------------------------------------------------------

function formatWeekday(d: Date, short = false): string {
  return d.toLocaleDateString(undefined, { weekday: short ? "short" : "short" });
}

function formatMonthDay(d: Date, short = false): string {
  return d.toLocaleDateString(undefined, {
    month: short ? "short" : "short",
    day: "numeric",
  });
}

function formatClock(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function computeFocusHours(sessions: AllSession[]): number {
  // Sum duration of each session (capped at 4h to avoid one stale session
  // dominating the day's number).
  let total = 0;
  for (const s of sessions) {
    const dur = Math.max(0, s.lastActive - s.startedAt);
    total += Math.min(dur, 4 * 3600 * 1000);
  }
  return total / 3600 / 1000;
}

function topProjectNames(sessions: AllSession[], n: number): string[] {
  const freq = new Map<string, number>();
  for (const s of sessions) {
    const p = s.dominantCwd ?? s.launchedFrom;
    if (!p) continue;
    freq.set(p, (freq.get(p) ?? 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([p]) => basename(p));
}
