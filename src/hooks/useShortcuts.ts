import { useEffect } from "react";

interface Shortcuts {
  onNewProject?: () => void;
  onNewSession?: () => void;
  onToggleHome?: () => void;
  onSettings?: () => void;
  onHelp?: () => void;
}

export function useShortcuts(s: Shortcuts) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const cmd = e.metaKey || e.ctrlKey;
      if (!cmd) return;
      const target = e.target as HTMLElement | null;
      // Don't intercept when user is typing in an input/textarea
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }

      const key = e.key.toLowerCase();
      const shift = e.shiftKey;

      if (cmd && shift && key === "n" && s.onNewSession) {
        e.preventDefault();
        s.onNewSession();
      } else if (cmd && !shift && key === "n" && s.onNewProject) {
        e.preventDefault();
        s.onNewProject();
      } else if (cmd && key === "b" && s.onToggleHome) {
        e.preventDefault();
        s.onToggleHome();
      } else if (cmd && key === "," && s.onSettings) {
        e.preventDefault();
        s.onSettings();
      } else if (cmd && (key === "?" || (shift && key === "/")) && s.onHelp) {
        e.preventDefault();
        s.onHelp();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [s]);
}
