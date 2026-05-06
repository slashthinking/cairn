import {
  Clipboard,
  Folder,
  GitBranch,
  GitFork,
  Sparkles,
  Terminal,
  User,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useApp } from "../store/AppStore";
import { toast } from "./Toast";
import { formatRelativeTime } from "../lib/path";
import type { SessionPreview } from "../types/cairn-api";

export function PreviewPane() {
  const app = useApp();
  const sessions: import("../types/cairn-api").Session[] = app.selectedProject
    ? app.sessionsByProject[app.selectedProject] ?? []
    : [];
  const session = sessions.find((s) => s.id === app.selectedSession) ?? null;

  // Per-session preview cache, keyed by session id. Re-fetches when the user
  // switches sessions; remembers previous fetches for the duration of the
  // mount so flipping back and forth doesn't re-hit IPC.
  const [previews, setPreviews] = useState<Record<string, SessionPreview | "loading">>({});
  const sessionKey = session ? `${session.projectPath}::${session.id}` : null;

  useEffect(() => {
    if (!sessionKey || !session) return;
    if (previews[sessionKey] !== undefined) return;
    setPreviews((p) => ({ ...p, [sessionKey]: "loading" }));
    void window.cairn
      .getSessionPreview(session.projectPath, session.id)
      .then((preview) => {
        setPreviews((p) => ({ ...p, [sessionKey]: preview }));
      })
      .catch((err) => {
        console.error("getSessionPreview", err);
        setPreviews((p) => ({
          ...p,
          [sessionKey]: { lastMessages: [] },
        }));
      });
  }, [sessionKey, session, previews]);

  if (!session) {
    return (
      <main className="flex flex-1 items-center justify-center bg-background">
        <p className="text-[13px] text-muted-foreground">
          Select a session to preview.
        </p>
      </main>
    );
  }

  const preview = sessionKey ? previews[sessionKey] : undefined;

  async function handleResume() {
    if (!session) return;
    try {
      await window.cairn.resumeInTerminal({
        terminal: app.terminalPref,
        cwd: session.projectPath,
        sessionId: session.id,
      });
      toast.success(
        `Resumed in ${app.terminalPref}`,
        `${session.projectPath}${session.gitBranch ? `  ·  ${session.gitBranch}` : ""}`,
      );
    } catch (err) {
      toast.error(
        "Couldn't launch terminal",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  async function handleCopyCommand() {
    if (!session) return;
    const cmd = `cd "${session.projectPath}" && claude --resume ${session.id}`;
    await navigator.clipboard.writeText(cmd);
    toast.success("Resume command copied", cmd);
  }

  return (
    <main className="flex flex-1 flex-col bg-background">
      <header className="flex flex-col gap-2.5 border-b border-border px-6 py-4">
        <h1 className="flex items-center gap-2 text-[18px] font-bold leading-snug text-foreground">
          {session.forkedFrom && (
            <GitFork className="h-4 w-4 shrink-0 text-cc-claude" />
          )}
          <span className="truncate">
            {session.title ?? "(untitled session)"}
          </span>
        </h1>
        {session.forkedFrom && (
          <button
            onClick={() => app.selectSession(session.forkedFrom!.sessionId)}
            className="flex w-fit items-center gap-1.5 rounded-cc-xs px-2 py-1 font-mono text-[10.5px] font-medium text-cc-claude hover:opacity-80"
            style={{ backgroundColor: "#F0934026" }}
            title="Jump to parent session"
          >
            <GitFork className="h-3 w-3" />
            forked from {session.forkedFrom.sessionId.slice(0, 8)}
          </button>
        )}
        <div className="flex flex-wrap items-center gap-2.5 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5 font-mono">
            <Folder className="h-3 w-3" />
            {session.projectPath}
          </span>
          <span>·</span>
          <span>Started {formatRelativeTime(session.startedAt)} ago</span>
          <span>·</span>
          <span>{session.messageCount} messages</span>
          {session.model && (
            <>
              <span>·</span>
              <span>{session.model}</span>
            </>
          )}
        </div>
      </header>

      <div className="cc-scroll-thin flex flex-1 flex-col gap-6 overflow-y-auto px-6 py-5">
        <div className="flex items-center gap-2.5 rounded-cc-md border border-border bg-cc-surface-hover px-3 py-2.5">
          <span className="h-1.5 w-1.5 rounded-full bg-cc-success" />
          <span className="text-[13px] font-medium text-foreground">
            Resumable
          </span>
          {session.gitBranch && (
            <>
              <GitBranch className="h-3 w-3 text-muted-foreground" />
              <span className="flex-1 truncate font-mono text-[12px] font-medium text-muted-foreground">
                {session.gitBranch}
              </span>
            </>
          )}
        </div>

        {preview === "loading" ? (
          <p className="text-[12px] text-muted-foreground">Loading transcript…</p>
        ) : preview && preview.lastMessages.length > 0 ? (
          <Section title={`Last ${preview.lastMessages.length} messages`}>
            <div className="flex flex-col gap-2.5">
              {preview.lastMessages.map((m, i) => (
                <Bubble
                  key={`l-${i}`}
                  role={m.role}
                  text={m.text}
                  timestamp={m.timestamp}
                />
              ))}
            </div>
          </Section>
        ) : (
          <Section title="Activity">
            <p className="text-[13px] text-foreground">
              {session.messageCount} messages · last active{" "}
              {formatRelativeTime(session.lastActive)} ago
            </p>
          </Section>
        )}
      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-border bg-cc-surface-elevated px-5 py-3">
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-cc-success" />
          <span className="text-[12px] text-muted-foreground">
            Resumable · {session.messageCount} messages
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopyCommand}
            className="flex items-center gap-1.5 rounded-cc-sm border border-border bg-cc-surface-hover px-4 py-2 text-[12px] font-medium text-muted-foreground hover:bg-cc-surface-press"
          >
            <Clipboard className="h-3 w-3" />
            Copy
          </button>
          <button
            onClick={handleResume}
            className="flex items-center gap-1.5 rounded-cc-sm bg-cc-accent px-4 py-2 text-[13px] font-semibold text-cc-accent-fg hover:opacity-90"
          >
            <Terminal className="h-3.5 w-3.5" />
            Resume
          </button>
        </div>
      </footer>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Bubble({
  role,
  text,
  timestamp,
}: {
  role: "user" | "assistant";
  text: string;
  timestamp?: number;
}) {
  const isUser = role === "user";
  return (
    <div className="flex flex-col gap-1.5 rounded-cc-md border border-border bg-cc-surface-elevated px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        {isUser ? (
          <User className="h-3 w-3" />
        ) : (
          <Sparkles className="h-3 w-3 text-cc-claude" />
        )}
        <span className={isUser ? "text-foreground" : "text-cc-claude"}>
          {isUser ? "You" : "Claude"}
        </span>
        {timestamp ? (
          <>
            <span className="text-muted-foreground">·</span>
            <span className="font-normal normal-case text-muted-foreground">
              {formatRelativeTime(timestamp)} ago
            </span>
          </>
        ) : null}
      </div>
      <p className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-foreground">
        {text.length >= 1200 ? text.slice(0, 1200) + "…" : text}
      </p>
    </div>
  );
}
