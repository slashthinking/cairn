import { FolderPlus } from "lucide-react";
import { useApp } from "../store/AppStore";
import { toast } from "../components/Toast";

function CairnLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-label="Cairn">
      <defs>
        <linearGradient id="cairn-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1A1A1F" />
          <stop offset="1" stopColor="#08080C" />
        </linearGradient>
      </defs>
      <rect width="100" height="100" rx="22.5" ry="22.5" fill="url(#cairn-bg)" />
      <rect x="0.5" y="0.5" width="99" height="99" rx="22" ry="22" fill="none" stroke="rgba(255,255,255,0.08)" />
      <path
        d="M 69.51 32.44 A 26.25 26.25 0 1 0 69.51 67.56"
        stroke="#F5F5F8"
        strokeWidth="11.5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

export function EmptyState() {
  const app = useApp();

  async function handleChoose() {
    try {
      await app.registerWorkspace();
    } catch (err) {
      toast.error(
        "Couldn't register workspace",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      <div className="titlebar-drag h-12 border-b border-border bg-sidebar" />
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-10 py-10">
        <CairnLogo className="h-24 w-24" />
        <h1 className="text-[28px] font-bold text-foreground">Welcome to Cairn</h1>
        <p className="max-w-[480px] text-center text-[14px] leading-relaxed text-muted-foreground">
          Manage your Claude Code projects and sessions across workspaces. Add a folder, and Cairn
          scans its sub-projects automatically.
        </p>
        <button
          onClick={handleChoose}
          className="flex items-center gap-2 rounded-cc-md bg-cc-accent px-5 py-2.5 text-[14px] font-semibold text-cc-accent-fg hover:opacity-90"
        >
          <FolderPlus className="h-3.5 w-3.5" />
          Choose your first workspace
        </button>
        {!app.claudeAvailable && (
          <p className="text-[12px] text-stale-foreground">
            ⚠ Claude CLI not detected. Install Claude Code to use AI features.
          </p>
        )}
      </div>
    </div>
  );
}
