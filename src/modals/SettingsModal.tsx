import { CircleDot, Circle, Folder, Settings as SettingsIcon, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { useApp } from "../store/AppStore";
import { cn } from "../lib/cn";
import type { InstalledTerminals } from "../types/cairn-api";
import { basename } from "../lib/path";

interface Props {
  onClose: () => void;
}

const TAB_TERMINAL = "terminal" as const;
const TAB_WORKSPACES = "workspaces" as const;
type Tab = typeof TAB_TERMINAL | typeof TAB_WORKSPACES;

const TERMINAL_OPTIONS: { id: string; label: string; key: keyof InstalledTerminals }[] = [
  { id: "iterm2", label: "iTerm2", key: "iterm2" },
  { id: "terminal", label: "Terminal.app", key: "terminalApp" },
  { id: "warp", label: "Warp", key: "warp" },
  { id: "ghostty", label: "Ghostty", key: "ghostty" },
  { id: "kitty", label: "kitty", key: "kitty" },
  { id: "alacritty", label: "Alacritty", key: "alacritty" },
];

export function SettingsModal({ onClose }: Props) {
  const app = useApp();
  const [tab, setTab] = useState<Tab>(TAB_TERMINAL);
  const [installed, setInstalled] = useState<InstalledTerminals | null>(null);

  useEffect(() => {
    void window.cairn.listTerminals().then(setInstalled);
  }, []);

  return (
    <Modal onClose={onClose} width={720}>
      <header className="flex items-center justify-between px-5 py-3.5">
        <div className="flex items-center gap-2">
          <SettingsIcon className="h-3.5 w-3.5 text-foreground" />
          <span className="text-[14px] font-semibold text-foreground">
            Settings
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex border-b border-border px-5">
        <Tab active={tab === TAB_TERMINAL} onClick={() => setTab(TAB_TERMINAL)}>
          Terminal
        </Tab>
        <Tab active={tab === TAB_WORKSPACES} onClick={() => setTab(TAB_WORKSPACES)}>
          Workspaces
        </Tab>
      </div>

      <div className="flex-1 overflow-y-auto px-7 py-5">
        {tab === TAB_TERMINAL && (
          <TerminalTab
            current={app.terminalPref}
            installed={installed}
            onPick={(id) => app.setTerminalPref(id)}
          />
        )}
        {tab === TAB_WORKSPACES && <WorkspacesTab />}
      </div>

      <footer className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
        <button
          onClick={onClose}
          className="rounded-cc-sm bg-cc-accent px-4 py-2 text-[13px] font-semibold text-cc-accent-fg"
        >
          Done
        </button>
      </footer>
    </Modal>
  );
}

function Tab({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-3.5 py-2.5 text-[13px] font-medium",
        active
          ? "border-b-2 border-cc-accent text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function TerminalTab({
  current,
  installed,
  onPick,
}: {
  current: string;
  installed: InstalledTerminals | null;
  onPick: (id: string) => void;
}) {
  const [customTemplate, setCustomTemplate] = useState("");

  useEffect(() => {
    void window.cairn
      .storeGet("customTerminalCommand")
      .then((t) => setCustomTemplate(t ?? ""));
  }, []);

  return (
    <div className="flex flex-col gap-2.5">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          Default terminal
        </div>
        <div className="mt-1.5 text-[13px] text-muted-foreground">
          When you click Resume, open the session in this terminal.
        </div>
      </div>

      <div className="flex flex-col gap-1.5 pt-1">
        {TERMINAL_OPTIONS.map((opt) => {
          const isInstalled = installed ? installed[opt.key] : false;
          const selected = current === opt.id;
          return (
            <button
              key={opt.id}
              disabled={!isInstalled}
              onClick={() => onPick(opt.id)}
              className={cn(
                "flex items-center gap-3 rounded-cc-md px-3.5 py-2.5 text-left transition-colors",
                selected
                  ? "border-[1.5px] border-cc-accent bg-cc-surface-press"
                  : "border border-border hover:bg-cc-surface-hover",
                !isInstalled && "opacity-50",
              )}
            >
              {selected ? (
                <CircleDot className="h-4 w-4 text-cc-accent" />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="flex-1 text-[13px] font-medium text-foreground">
                {opt.label}
              </span>
              <span
                className={cn(
                  "text-[11px] font-medium",
                  isInstalled ? "text-cc-success" : "text-muted-foreground",
                )}
              >
                {isInstalled ? "detected" : "not installed"}
              </span>
            </button>
          );
        })}

        {/* Custom command template */}
        <button
          onClick={() => onPick("custom")}
          className={cn(
            "flex items-center gap-3 rounded-cc-md px-3.5 py-2.5 text-left",
            current === "custom"
              ? "border-[1.5px] border-cc-accent bg-cc-surface-press"
              : "border border-border hover:bg-cc-surface-hover",
          )}
        >
          {current === "custom" ? (
            <CircleDot className="h-4 w-4 text-cc-accent" />
          ) : (
            <Circle className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="flex-1 text-[13px] font-medium text-foreground">
            Custom command…
          </span>
        </button>

        {current === "custom" && (
          <div className="flex flex-col gap-2 rounded-cc-md border border-border bg-cc-surface-base p-3">
            <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              Command template
            </label>
            <textarea
              value={customTemplate}
              onChange={(e) => setCustomTemplate(e.target.value)}
              onBlur={() =>
                window.cairn.storeSet("customTerminalCommand", customTemplate)
              }
              spellCheck={false}
              rows={3}
              placeholder='e.g.  open -a "WezTerm" --args start --cwd {{cwd}} -- {{cmd}}'
              className="resize-none rounded-cc-sm border border-input bg-cc-surface-base p-2 font-mono text-[12px] text-foreground placeholder:text-muted-foreground focus:border-cc-accent focus:outline-none"
            />
            <p className="text-[11px] text-muted-foreground">
              {"Use "}
              <code className="rounded-cc-xs bg-cc-surface-hover px-1">{"{{cwd}}"}</code>
              {" and "}
              <code className="rounded-cc-xs bg-cc-surface-hover px-1">{"{{cmd}}"}</code>
              {" placeholders. Runs via "}
              <code className="rounded-cc-xs bg-cc-surface-hover px-1">sh -c</code>
              .
            </p>
          </div>
        )}
      </div>

    </div>
  );
}

function WorkspacesTab() {
  const app = useApp();
  return (
    <div className="flex flex-col gap-2.5">
      <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        Registered workspaces
      </div>
      <div className="flex flex-col gap-2">
        {app.workspaces.map((w) => (
          <div
            key={w}
            className="flex items-center gap-3 rounded-cc-md border border-border px-3.5 py-3"
          >
            <Folder className="h-4 w-4 text-muted-foreground" />
            <div className="flex flex-1 flex-col gap-0.5">
              <span className="text-[13px] font-semibold text-foreground">
                {basename(w)}
              </span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {w} · {(app.projectsByWorkspace[w] ?? []).length} projects
              </span>
            </div>
            <button
              onClick={() => app.removeWorkspace(w)}
              className="text-[12px] font-medium text-muted-foreground hover:text-destructive"
            >
              Forget
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={app.registerWorkspace}
        className="mt-1 flex items-center justify-center gap-2 rounded-cc-md border border-dashed border-cc-surface-strong bg-cc-surface-hover px-3.5 py-3 text-[13px] font-medium text-muted-foreground hover:bg-cc-surface-press"
      >
        <Folder className="h-3.5 w-3.5" />
        Register a workspace folder…
      </button>
    </div>
  );
}
