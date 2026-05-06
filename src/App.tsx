import { useCallback, useState } from "react";
import { AppProvider, useApp } from "./store/AppStore";
import { SessionDetailView } from "./screens/SessionDetailView";
import { EmptyState } from "./screens/EmptyState";
import { WorkspacesHome } from "./screens/WorkspacesHome";
import { AllSessionsView } from "./screens/AllSessionsView";
import { HelpModal } from "./modals/HelpModal";
import { SettingsModal } from "./modals/SettingsModal";
import { AIRenameModal } from "./modals/AIRenameModal";
import { QuickStartModal } from "./modals/QuickStartModal";
import { ToastHost, toast } from "./components/Toast";
import { ContextMenuProvider } from "./components/ContextMenu";
import { useShortcuts } from "./hooks/useShortcuts";

export function App() {
  return (
    <AppProvider>
      <ContextMenuProvider>
        <Shell />
      </ContextMenuProvider>
    </AppProvider>
  );
}

function Shell() {
  const app = useApp();
  const [openSettings, setOpenSettings] = useState(false);
  const [openHelp, setOpenHelp] = useState(false);
  const [openQuickStart, setOpenQuickStart] = useState(false);
  const [sessionDrawerOpen, setSessionDrawerOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<
    | { kind: "project"; path: string; currentName: string }
    | { kind: "session"; id: string; currentTitle: string; projectPath: string }
    | null
  >(null);

  const openSessionDrawer = useCallback(
    (projectPath: string, sessionId: string) => {
      app.selectProject(projectPath);
      app.selectSession(sessionId);
      setSessionDrawerOpen(true);
    },
    [app],
  );

  useShortcuts({
    onNewProject: () => app.workspaces.length > 0 && setOpenQuickStart(true),
    onNewSession: async () => {
      if (!app.selectedProject) {
        toast.info("No project selected", "Pick a project first.");
        return;
      }
      try {
        await window.cairn.startNewSession({
          projectPath: app.selectedProject,
          terminal: app.terminalPref,
        });
        toast.success("New session started", app.selectedProject);
      } catch (err) {
        toast.error(
          "Couldn't start session",
          err instanceof Error ? err.message : String(err),
        );
      }
    },
    onToggleHome: () => app.setView("home"),
    onSettings: () => setOpenSettings(true),
    onHelp: () => setOpenHelp(true),
  });

  if (!app.ready) return <BootScreen />;

  if (app.workspaces.length === 0) {
    return (
      <>
        <EmptyState />
        <ToastHost />
      </>
    );
  }

  return (
    <>
      {app.view === "all-sessions" ? (
        <AllSessionsView
          onOpenSettings={() => setOpenSettings(true)}
          onOpenHelp={() => setOpenHelp(true)}
        />
      ) : (
        <WorkspacesHome
          onOpenSettings={() => setOpenSettings(true)}
          onOpenQuickStart={() => setOpenQuickStart(true)}
          onOpenHelp={() => setOpenHelp(true)}
          onOpenSession={openSessionDrawer}
        />
      )}

      {/* Session detail = right-side drawer overlaying any view. */}
      <SessionDetailView
        open={sessionDrawerOpen}
        onClose={() => setSessionDrawerOpen(false)}
        onRequestRename={setRenameTarget}
      />

      {openSettings && <SettingsModal onClose={() => setOpenSettings(false)} />}
      {openHelp && <HelpModal onClose={() => setOpenHelp(false)} />}
      {openQuickStart && (
        <QuickStartModal onClose={() => setOpenQuickStart(false)} />
      )}
      {renameTarget && (
        <AIRenameModal
          target={renameTarget}
          onClose={() => setRenameTarget(null)}
        />
      )}

      <ToastHost />
    </>
  );
}

function BootScreen() {
  return (
    <div className="flex h-screen items-center justify-center bg-cc-surface-base text-muted-foreground">
      <span className="text-[13px]">Loading…</span>
    </div>
  );
}
