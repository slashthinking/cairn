import { Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { useApp } from "../store/AppStore";
import { toast } from "../components/Toast";
import { cn } from "../lib/cn";

type Target =
  | { kind: "project"; path: string; currentName: string }
  | { kind: "session"; id: string; currentTitle: string; projectPath: string };

interface Props {
  target: Target;
  onClose: () => void;
}

interface Suggestion {
  name: string;
  reasoning: string;
}

export function AIRenameModal({ target, onClose }: Props) {
  const app = useApp();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [picked, setPicked] = useState<number | "custom">(0);
  const [customName, setCustomName] = useState("");

  const currentName =
    target.kind === "project" ? target.currentName : target.currentTitle;

  // Build a real context blob from disk via IPC (folder listing + session
  // titles for projects, first user messages for sessions). The main process
  // can read filesystem; renderer can't.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!app.claudeAvailable) {
        setError("Claude CLI not detected. Install Claude Code first.");
        setLoading(false);
        return;
      }

      try {
        const context =
          target.kind === "project"
            ? await window.cairn.getProjectContext(target.path)
            : await window.cairn.getSessionContext(
                target.projectPath,
                target.id,
              );

        const res = await window.cairn.renameSuggestions({
          kind: target.kind,
          context,
        });
        if (cancelled) return;
        setSuggestions(res.suggestions ?? []);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [target, app.claudeAvailable]);

  const [applying, setApplying] = useState(false);

  async function handleApply() {
    const chosen: Suggestion | undefined =
      picked === "custom"
        ? customName.trim()
          ? { name: customName.trim(), reasoning: "" }
          : undefined
        : suggestions[picked];
    if (!chosen) return;

    setApplying(true);
    try {
      if (target.kind === "session") {
        await app.setSessionTitle(target.id, chosen.name);
        toast.success("Session renamed", `→ ${chosen.name}`);
      } else {
        // Real disk rename: mv folder + remap ~/.claude/projects/<encoded>.
        // Falls back to recording aiName as a label if the disk rename fails
        // (e.g. invalid chars, target collision) so the user still sees a result.
        try {
          const newPath = await app.renameProjectOnDisk(
            target.path,
            chosen.name,
          );
          toast.success("Project renamed", `→ ${newPath}`);
        } catch (err) {
          await app.setProjectMeta(target.path, { aiName: chosen.name });
          toast.error(
            "Disk rename failed — saved as label",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    } finally {
      setApplying(false);
    }
    onClose();
  }

  return (
    <Modal onClose={onClose} width={520}>
      <header className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-cc-claude" />
          <span className="text-[14px] font-semibold text-foreground">
            Rename with AI
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex flex-col gap-2 px-5 pb-2 pt-3.5">
        <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          Current {target.kind === "project" ? "name" : "title"}
        </div>
        <div className="inline-flex w-fit items-center rounded-cc-sm border border-border bg-cc-surface-base px-3 py-2 font-mono text-[13px] text-foreground">
          {currentName}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-5 pb-4 pt-2">
        <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          Suggestions
        </div>

        {loading && <LoadingState />}
        {error && <ErrorState message={error} />}

        {!loading && !error && suggestions.length === 0 && (
          <p className="py-4 text-center text-[12px] text-muted-foreground">
            No suggestions returned.
          </p>
        )}

        {suggestions.map((s, i) => (
          <button
            key={i}
            onClick={() => setPicked(i)}
            className={cn(
              "flex flex-col gap-1 rounded-cc-md p-3.5 text-left transition-colors",
              picked === i
                ? "border-[1.5px] border-cc-accent bg-cc-surface-press"
                : "border border-border hover:bg-cc-surface-hover",
            )}
          >
            <span className="font-mono text-[13px] font-semibold text-foreground">
              {s.name}
            </span>
            <span className="text-[12px] leading-relaxed text-muted-foreground">
              {s.reasoning}
            </span>
          </button>
        ))}

        {!loading && !error && (
          <div
            className={cn(
              "mt-1 flex flex-col gap-2 rounded-cc-md p-3.5 transition-colors",
              picked === "custom"
                ? "border-[1.5px] border-cc-accent bg-cc-surface-press"
                : "border border-border",
            )}
          >
            <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              Or write your own
            </span>
            <input
              value={customName}
              onChange={(e) => {
                setCustomName(e.target.value);
                setPicked("custom");
              }}
              onFocus={() => setPicked("custom")}
              placeholder={
                target.kind === "project"
                  ? "my-project-name"
                  : "Custom session title"
              }
              className="h-8 rounded-cc-sm border border-input bg-cc-surface-base px-2.5 font-mono text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-cc-accent"
            />
          </div>
        )}
      </div>

      <footer className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
        <button
          onClick={onClose}
          className="rounded-cc-sm border border-border bg-cc-surface-hover px-4 py-2 text-[13px] font-medium text-foreground hover:bg-cc-surface-press"
        >
          Cancel
        </button>
        <button
          onClick={handleApply}
          disabled={
            loading ||
            applying ||
            !!error ||
            (picked === "custom"
              ? !customName.trim()
              : suggestions.length === 0)
          }
          className="rounded-cc-sm bg-cc-accent px-4 py-2 text-[13px] font-semibold text-cc-accent-fg hover:opacity-90 disabled:opacity-40"
        >
          {applying ? "Applying…" : "Apply"}
        </button>
      </footer>
    </Modal>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col items-center gap-3 py-12">
      <div className="flex h-12 w-12 animate-pulse items-center justify-center rounded-full bg-cc-surface-press">
        <Sparkles className="h-5 w-5 text-cc-claude" />
      </div>
      <p className="text-[13px] font-semibold text-foreground">
        Asking Claude for suggestions…
      </p>
      <p className="text-[11px] text-muted-foreground">
        Reading folder structure + sessions
      </p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-cc-md border border-destructive/40 bg-destructive/10 p-3 text-[12px] text-destructive">
      {message}
    </div>
  );
}

