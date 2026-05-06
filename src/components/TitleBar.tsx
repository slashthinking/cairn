import {
  LayoutGrid,
  LifeBuoy,
  ListTree,
  Moon,
  RotateCw,
  Settings,
  Sun,
} from "lucide-react";
import { cn } from "../lib/cn";

interface Props {
  theme: "dark" | "light";
  onToggleTheme: () => void;
  onOpenSettings?: () => void;
  onOpenHelp?: () => void;
  onOpenHome?: () => void;
  onOpenAllSessions?: () => void;
  onOpenQuickStart?: () => void;
  onRefresh?: () => void;
  view: "main" | "home" | "all-sessions";
}

export function TitleBar({
  theme,
  onToggleTheme,
  onOpenSettings,
  onOpenHelp,
  onOpenHome,
  onOpenAllSessions,
  onRefresh,
  view,
}: Props) {
  return (
    <div className="titlebar-drag relative flex h-12 items-center border-b border-border bg-sidebar">
      <div className="flex items-center gap-3 pl-[78px]">
        <button className="titlebar-no-drag rounded-cc-sm p-1 text-muted-foreground hover:bg-cc-surface-hover">
          <PanelLeftIcon />
        </button>
      </div>

      <div className="titlebar-no-drag ml-auto flex items-center gap-1 pr-3">
        <IconButton
          active={view === "home"}
          onClick={onOpenHome}
          aria-label={view === "home" ? "Back to project" : "Workspaces home"}
        >
          <LayoutGrid className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton
          active={view === "all-sessions"}
          onClick={onOpenAllSessions}
          aria-label="All Claude Code sessions"
          title="All Claude Code sessions"
        >
          <ListTree className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton onClick={onToggleTheme} aria-label="Toggle theme">
          {theme === "dark" ? (
            <Moon className="h-3.5 w-3.5" />
          ) : (
            <Sun className="h-3.5 w-3.5" />
          )}
        </IconButton>
        <IconButton onClick={onRefresh} aria-label="Refresh">
          <RotateCw className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton onClick={onOpenHelp} aria-label="Help">
          <LifeBuoy className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton onClick={onOpenSettings} aria-label="Settings">
          <Settings className="h-3.5 w-3.5" />
        </IconButton>
      </div>
    </div>
  );
}

function IconButton({
  children,
  active,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      {...rest}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-cc-sm text-muted-foreground hover:bg-cc-surface-hover",
        active && "bg-cc-accent text-cc-accent-fg hover:bg-cc-accent",
        className,
      )}
    >
      {children}
    </button>
  );
}

function PanelLeftIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
    </svg>
  );
}
