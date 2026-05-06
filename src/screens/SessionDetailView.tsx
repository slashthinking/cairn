// Session detail rendered as a right-side drawer, overlaying the home page.
// Driven by Shell-level state (selectedSession + selectedProject + visible).

import {
  ChevronUp,
  Copy,
  GitBranch,
  GitFork,
  Play,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useApp } from "../store/AppStore";
import { toast } from "../components/Toast";
import { basename, formatRelativeTime } from "../lib/path";
import { cn } from "../lib/cn";
import type { SessionPreview } from "../types/cairn-api";

interface Props {
  open: boolean;
  onClose: () => void;
  onRequestRename: (target: {
    kind: "session";
    id: string;
    currentTitle: string;
    projectPath: string;
  }) => void;
}

export function SessionDetailView({ open, onClose, onRequestRename }: Props) {
  const app = useApp();
  const projectPath = app.selectedProject;
  const sessionId = app.selectedSession;
  const session =
    projectPath && sessionId
      ? (app.sessionsByProject[projectPath] ?? []).find((s) => s.id === sessionId)
      : null;

  const [preview, setPreview] = useState<SessionPreview | "loading" | null>(null);

  // Load preview on open / session change.
  useEffect(() => {
    if (!open || !projectPath || !sessionId) return;
    setPreview("loading");
    let cancelled = false;
    window.cairn
      .getSessionPreview(projectPath, sessionId)
      .then((p) => {
        if (!cancelled) setPreview(p);
      })
      .catch(() => {
        if (!cancelled) setPreview({ lastMessages: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectPath, sessionId]);

  // ESC key to close.
  useEffect(() => {
    if (!open) return;
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40">
      {/* Backdrop — click to dismiss */}
      <button
        aria-label="Close session detail"
        onClick={onClose}
        className="absolute inset-0 bg-black/40 transition-opacity"
      />
      {/* Drawer panel */}
      <aside
        role="dialog"
        aria-modal="true"
        className="absolute right-0 top-0 flex h-full w-[640px] max-w-[92vw] flex-col bg-background shadow-2xl"
        style={{ borderLeft: "1px solid var(--border)" }}
      >
        {!session || !projectPath ? (
          <DrawerEmpty onClose={onClose} />
        ) : (
          <DrawerBody
            session={session}
            projectPath={projectPath}
            preview={preview}
            customTitle={
              app.sessionTitles[session.id] ?? session.title ?? "(untitled)"
            }
            isAiNamed={!!app.sessionTitles[session.id]}
            terminalPref={app.terminalPref}
            onClose={onClose}
            onRequestRename={onRequestRename}
          />
        )}
      </aside>
    </div>
  );
}

function DrawerEmpty({ onClose }: { onClose: () => void }) {
  return (
    <>
      <DrawerHeader title="Session" onClose={onClose} />
      <div className="flex flex-1 items-center justify-center text-[13px] text-muted-foreground">
        No session selected.
      </div>
    </>
  );
}

function DrawerBody({
  session,
  projectPath,
  preview,
  customTitle,
  isAiNamed,
  terminalPref,
  onClose,
  onRequestRename,
}: {
  session: import("../types/cairn-api").Session;
  projectPath: string;
  preview: SessionPreview | "loading" | null;
  customTitle: string;
  isAiNamed: boolean;
  terminalPref: string;
  onClose: () => void;
  onRequestRename: Props["onRequestRename"];
}) {
  const projectName = basename(projectPath);
  const sessionShortId = session.id.slice(0, 8);
  const isActive = Date.now() - session.lastActive < 5 * 60 * 1000;

  async function handleResume() {
    try {
      await window.cairn.resumeInTerminal({
        terminal: terminalPref,
        cwd: projectPath,
        sessionId: session.id,
      });
      toast.success("Resuming");
    } catch (err) {
      toast.error(
        "Couldn't resume",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  async function handleCopyId() {
    try {
      await navigator.clipboard.writeText(session.id);
      toast.success("Session ID copied");
    } catch (err) {
      toast.error("Couldn't copy", err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      <DrawerHeader
        title={`${projectName} / `}
        suffix={<span className="font-mono text-foreground">{sessionShortId}</span>}
        onClose={onClose}
      />

      <div className="cc-scroll-thin flex-1 overflow-y-auto px-5 pb-24 pt-3">
        <div className="flex flex-col gap-4">
          {/* Hero */}
          <div className="flex flex-col gap-2.5">
            {isAiNamed && (
              <div className="flex items-center gap-1.5">
                <Sparkles className="h-3 w-3 text-cc-claude" />
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-cc-claude">
                  AI named
                </span>
                <button
                  onClick={() =>
                    onRequestRename({
                      kind: "session",
                      id: session.id,
                      currentTitle: customTitle,
                      projectPath,
                    })
                  }
                  className="text-[10.5px] font-medium text-muted-foreground hover:text-foreground"
                >
                  rename
                </button>
              </div>
            )}
            <h1
              className="text-[22px] font-semibold leading-[1.2] tracking-[-0.2px] text-foreground"
              style={{ fontFamily: "Source Serif 4, Newsreader, ui-serif, serif" }}
            >
              {customTitle}
            </h1>
            <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
              <span>
                {session.messageCount} message
                {session.messageCount === 1 ? "" : "s"}
              </span>
              <span>·</span>
              <span>started {formatRelativeTime(session.startedAt)} ago</span>
              <span>·</span>
              <span>
                {isActive
                  ? "active now"
                  : `${formatRelativeTime(session.lastActive)} ago`}
              </span>
            </div>
          </div>

          {/* Facts strip */}
          <FactsStrip
            cwd={projectPath}
            branch={session.gitBranch}
            forkedFrom={session.forkedFrom}
            model={session.model}
            isActive={isActive}
          />

          {/* "Show earlier messages" */}
          {session.messageCount > 10 && (
            <button className="flex w-fit items-center gap-1.5 px-1 text-[11px] text-cc-accent-light hover:underline">
              <ChevronUp className="h-3 w-3" />
              Show {Math.max(0, session.messageCount - 10)} earlier messages
            </button>
          )}

          {/* Chat transcript */}
          {preview === "loading" && (
            <p className="text-center text-[12px] text-muted-foreground">
              Loading transcript…
            </p>
          )}
          {preview &&
            preview !== "loading" &&
            preview.lastMessages.length === 0 && (
              <p className="text-center text-[12px] text-muted-foreground">
                No messages yet.
              </p>
            )}
          {preview &&
            preview !== "loading" &&
            preview.lastMessages.length > 0 && (
              <div className="flex flex-col gap-2.5">
                {preview.lastMessages.map((m, i) => (
                  <Message
                    key={i}
                    role={m.role}
                    text={m.text}
                    timestamp={m.timestamp}
                  />
                ))}
              </div>
            )}

          {isActive && (
            <div
              className="flex items-center gap-2 self-center rounded-full px-3 py-1.5 text-[11.5px] font-medium text-cc-success"
              style={{
                backgroundColor: "#22C55E1A",
                border: "1px solid #22C55E4D",
              }}
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cc-success" />
              Active now · Claude is working on your task
            </div>
          )}
        </div>
      </div>

      {/* Sticky bottom actions */}
      <div className="absolute bottom-0 left-0 right-0 border-t border-border bg-cc-surface-elevated px-5 py-2.5">
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopyId}
            className="flex items-center gap-1 rounded-cc-sm border border-border bg-cc-surface-elevated px-2.5 py-1.5 text-[11.5px] font-medium text-foreground hover:bg-cc-surface-press"
          >
            <Copy className="h-3 w-3" />
            Copy ID
          </button>
          <button
            className="flex items-center gap-1.5 rounded-cc-sm border border-border bg-cc-surface-elevated px-2.5 py-1.5 text-[11.5px] font-medium text-foreground hover:bg-cc-surface-press"
            onClick={() =>
              toast.info("Fork", "Coming soon — paste prompt to fork from this point.")
            }
          >
            <GitFork className="h-3 w-3" />
            Fork
          </button>
          <span className="grow" />
          <button
            onClick={handleResume}
            className="flex items-center gap-1.5 rounded-cc-sm bg-cc-accent px-3.5 py-1.5 text-[12px] font-semibold text-cc-accent-fg hover:opacity-90"
          >
            <Play className="h-3 w-3" />
            Resume in terminal
          </button>
        </div>
      </div>
    </>
  );
}

function DrawerHeader({
  title,
  suffix,
  onClose,
}: {
  title: string;
  suffix?: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-5 py-3">
      <span className="text-[11.5px] text-muted-foreground">{title}</span>
      {suffix}
      <span className="grow" />
      <button
        onClick={onClose}
        aria-label="Close"
        className="flex h-7 w-7 items-center justify-center rounded-cc-sm text-muted-foreground hover:bg-cc-surface-hover"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function FactsStrip({
  cwd,
  branch,
  forkedFrom,
  model,
  isActive,
}: {
  cwd: string;
  branch: string | null;
  forkedFrom: { sessionId: string; messageUuid: string } | null;
  model: string | null;
  isActive: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-border bg-cc-surface-elevated px-3.5 py-2">
      <Fact icon={null} label="cwd" value={cwd} mono />
      {branch && (
        <Fact icon={<GitBranch className="h-3 w-3" />} label="branch" value={branch} mono />
      )}
      {forkedFrom && (
        <Fact
          icon={<GitFork className="h-3 w-3 text-cc-claude" />}
          label="forked from"
          value={forkedFrom.sessionId.slice(0, 8)}
          mono
        />
      )}
      {model && <Fact icon={null} label="model" value={model} mono />}
      <span className="grow" />
      {isActive && (
        <span className="flex items-center gap-1.5 text-[10.5px] font-medium text-cc-success">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cc-success" />
          Active now
        </span>
      )}
    </div>
  );
}

function Fact({
  icon,
  label,
  value,
  mono,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
      {icon}
      <span className="opacity-70">{label}</span>
      <span className={cn("text-foreground", mono && "font-mono")}>{value}</span>
    </div>
  );
}

function Message({
  role,
  text,
  timestamp,
}: {
  role: "user" | "assistant";
  text: string;
  timestamp: number;
}) {
  const time = new Date(timestamp).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-[10px] border border-border px-3.5 py-2.5",
        role === "user" ? "bg-cc-surface-elevated" : "bg-cc-card",
      )}
    >
      <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.06em]">
        <span className={role === "user" ? "text-cc-accent-light" : "text-cc-claude"}>
          {role === "user" ? "You" : "Claude"}
        </span>
        <span className="font-mono font-normal text-muted-foreground">{time}</span>
      </div>
      <p className="whitespace-pre-wrap text-[12px] leading-[1.55] text-foreground">
        {text}
      </p>
    </div>
  );
}
