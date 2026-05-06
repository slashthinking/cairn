import { LifeBuoy, Sparkles, LayoutGrid, X } from "lucide-react";
import { Modal } from "./Modal";

interface Props {
  onClose: () => void;
}

const SHORTCUTS = [
  { key: "⌘ N", desc: "New project (Quick Start)" },
  { key: "⌘ ⇧ N", desc: "New session in current project" },
  { key: "⌘ B", desc: "Toggle Workspaces Home (AI clusters)" },
  { key: "⌘ ,", desc: "Open Settings" },
  { key: "⌘ ?", desc: "Open Help" },
];

export function HelpModal({ onClose }: Props) {
  return (
    <Modal onClose={onClose} width={720}>
      <header className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <div className="flex items-center gap-2">
          <LifeBuoy className="h-3.5 w-3.5 text-foreground" />
          <span className="text-[14px] font-semibold text-foreground">Help</span>
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-7 py-5">
        <Section label="HOW CAIRN WORKS">
          <p className="text-[13px] leading-relaxed text-foreground">
            Cairn organizes your Claude Code work in three levels — register a folder as a
            workspace, and Cairn discovers projects and sessions inside automatically.
          </p>
          <div className="flex flex-col gap-2 pt-1">
            <Row label="Workspace" desc="A folder you register, e.g. ~/works/. The top of your tree." />
            <Row label="Project" desc="A sub-folder inside a workspace, usually a git repo or app." />
            <Row label="Session" desc="A single Claude Code conversation. Stored as jsonl." />
          </div>
        </Section>

        <Section label="AI FEATURES">
          <Feature
            icon={<Sparkles className="h-4 w-4 text-cc-claude" />}
            title="AI Rename"
            body="Forget what mira_new1 is? Right-click a project or session, and Cairn calls your local claude CLI for 4 candidate names with reasoning."
          />
          <Feature
            icon={<LayoutGrid className="h-4 w-4 text-cc-accent" />}
            title="AI Clusters"
            body="Open Workspaces Home (⌘B). Cairn auto-groups projects by topic — billing, auth, tooling — so you find them by what they do, not by their name."
          />
        </Section>

        <Section label="KEYBOARD SHORTCUTS">
          <div className="flex flex-col gap-1">
            {SHORTCUTS.map((s) => (
              <div
                key={s.key}
                className="flex items-center gap-3.5 px-2 py-1.5"
              >
                <kbd className="w-[88px] rounded-cc-xs border border-border bg-muted px-2 py-0.5 text-center font-mono text-[11px] font-semibold text-muted-foreground">
                  {s.key}
                </kbd>
                <span className="text-[13px] text-foreground">{s.desc}</span>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <footer className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
        <button
          onClick={onClose}
          className="rounded-cc-sm bg-cc-accent px-4 py-2 text-[13px] font-semibold text-cc-accent-fg"
        >
          Got it
        </button>
      </footer>
    </Modal>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </h3>
      {children}
    </section>
  );
}

function Row({ label, desc }: { label: string; desc: string }) {
  return (
    <div className="flex items-start gap-3.5 rounded-cc-md border border-border px-3.5 py-2.5">
      <span className="w-[88px] shrink-0 text-[13px] font-semibold text-foreground">
        {label}
      </span>
      <span className="text-[13px] leading-relaxed text-muted-foreground">
        {desc}
      </span>
    </div>
  );
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-cc-md border border-border px-3.5 py-2.5">
      <div className="pt-0.5">{icon}</div>
      <div className="flex flex-col gap-0.5">
        <div className="text-[13px] font-semibold text-foreground">{title}</div>
        <div className="text-[12px] leading-relaxed text-muted-foreground">
          {body}
        </div>
      </div>
    </div>
  );
}
