import { Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "./Modal";
import { useApp } from "../store/AppStore";
import { toast } from "../components/Toast";
import { basename } from "../lib/path";

interface Props {
  onClose: () => void;
}

export function QuickStartModal({ onClose }: Props) {
  const app = useApp();
  const [workspace, setWorkspace] = useState(
    app.selectedWorkspace ?? app.workspaces[0] ?? "",
  );
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const stamp = useMemo(formatStamp, []);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [aiPending, setAiPending] = useState(false);
  const aiTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce AI folder-name generation. Fires ~600ms after user stops typing,
  // calls the local `claude` CLI via renameSuggestions, picks the top suggestion
  // (≤32 chars, slug-safe per SCHEMA_RENAME). Falls back to plain slugify on
  // failure / empty prompt.
  useEffect(() => {
    if (aiTimer.current) clearTimeout(aiTimer.current);
    const trimmed = prompt.trim();
    if (trimmed.length < 8) {
      setAiSuggestion(null);
      setAiPending(false);
      return;
    }
    aiTimer.current = setTimeout(async () => {
      setAiPending(true);
      try {
        const r = await window.cairn.renameSuggestions({
          kind: "project",
          context: trimmed,
        });
        const top = r.suggestions[0]?.name?.trim();
        // Only accept names matching the slug constraint we asked claude for.
        if (top && /^[a-z0-9_-]+$/.test(top) && top.length <= 32) {
          setAiSuggestion(top);
        } else {
          setAiSuggestion(null);
        }
      } catch {
        setAiSuggestion(null);
      } finally {
        setAiPending(false);
      }
    }, 600);
    return () => {
      if (aiTimer.current) clearTimeout(aiTimer.current);
    };
  }, [prompt]);

  const folderName = useMemo(() => {
    if (aiSuggestion) return aiSuggestion;
    const slug = slugify(prompt);
    return slug || `scratch-${stamp}`;
  }, [aiSuggestion, prompt, stamp]);
  const projectPath = workspace
    ? `${workspace.replace(/\/$/, "")}/${folderName}`
    : "";

  async function handleStart() {
    if (!workspace) return toast.error("Pick a workspace first");
    setSubmitting(true);
    try {
      const finalPath = await window.cairn.startNewProject({
        workspace,
        initialPrompt: prompt.trim() || undefined,
        terminal: app.terminalPref,
      });
      toast.success(
        "Quick task started",
        `${finalPath} — terminal opening with claude…`,
      );
      await app.refreshAll();
      onClose();
    } catch (err) {
      toast.error(
        "Couldn't start task",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setSubmitting(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void handleStart();
    }
  }

  return (
    <Modal onClose={onClose} width={540}>
      <header className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <span className="text-[14px] font-semibold text-foreground">
          Start a quick task
        </span>
        <div className="flex items-center gap-3">
          <kbd className="font-mono text-[10.5px] text-muted-foreground">
            ⌘N
          </kbd>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="flex flex-col gap-3.5 px-5 py-4">
        <textarea
          autoFocus
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={6}
          placeholder="What do you want claude to start with? Leave blank to open a clean session."
          className="rounded-cc-md border border-input bg-cc-surface-base px-3.5 py-3 text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-cc-accent"
        />

        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Workspace
          </span>
          <select
            value={workspace}
            onChange={(e) => setWorkspace(e.target.value)}
            className="h-9 rounded-cc-sm border border-input bg-cc-surface-base px-3 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-cc-accent"
          >
            {app.workspaces.map((w) => (
              <option key={w} value={w}>
                {basename(w)}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-1.5 px-1 font-mono text-[11px] text-muted-foreground">
          <span>→</span>
          <span className="truncate">
            {projectPath || "(pick a workspace)"}
          </span>
          {aiPending ? (
            <span className="flex items-center gap-1 font-sans text-cc-claude opacity-80">
              <Sparkles className="h-3 w-3 animate-pulse" />
              naming…
            </span>
          ) : aiSuggestion ? (
            <span className="flex items-center gap-1 font-sans text-cc-claude opacity-80">
              <Sparkles className="h-3 w-3" />
              AI named
            </span>
          ) : (
            <span className="opacity-60">· folder will be created</span>
          )}
        </div>
      </div>

      <footer className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
        <button
          onClick={onClose}
          className="rounded-cc-sm border border-border bg-cc-surface-hover px-4 py-2 text-[13px] font-medium text-foreground hover:bg-cc-surface-press"
        >
          Cancel
        </button>
        <button
          onClick={handleStart}
          disabled={!workspace || submitting}
          className="flex items-center gap-1.5 rounded-cc-sm bg-cc-accent px-4 py-2 text-[13px] font-semibold text-cc-accent-fg hover:opacity-90 disabled:opacity-40"
        >
          <span>→</span>
          {submitting ? "Starting…" : "Start session"}
          <kbd className="text-[11px] opacity-70">⏎</kbd>
        </button>
      </footer>
    </Modal>
  );
}

function formatStamp(): string {
  const d = new Date();
  return `${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

// Convert "Refactor 3DS retry — wire idempotency keys" → "refactor-3ds-retry-wire"
// Lowercased ASCII slug capped at ~32 chars, first 5 word-tokens. CJK + non-ASCII
// chars collapse to dashes (matching the path-encoding rule used elsewhere).
function slugify(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  const tokens = lower
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return "";
  let slug = tokens.slice(0, 5).join("-");
  if (slug.length > 32) slug = slug.slice(0, 32).replace(/-+$/, "");
  return slug;
}
