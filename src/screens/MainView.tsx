import { TitleBar } from "../components/TitleBar";
import { Sidebar } from "../components/Sidebar";
import { SessionsList } from "../components/SessionsList";
import { PreviewPane } from "../components/PreviewPane";
import { useApp } from "../store/AppStore";
import { toast } from "../components/Toast";

interface Props {
  onOpenSettings: () => void;
  onOpenHelp: () => void;
  onOpenQuickStart: () => void;
  onRequestRename: (
    target:
      | { kind: "project"; path: string; currentName: string }
      | { kind: "session"; id: string; currentTitle: string; projectPath: string },
  ) => void;
}

export function MainView({
  onOpenSettings,
  onOpenHelp,
  onOpenQuickStart,
  onRequestRename,
}: Props) {
  const app = useApp();

  async function handleRefresh() {
    if (!app.selectedProject) return;
    try {
      await app.refreshSessions(app.selectedProject);
      toast.success("Refreshed", app.selectedProject);
    } catch (err) {
      toast.error(
        "Refresh failed",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <TitleBar
        theme={app.theme}
        onToggleTheme={() => app.setTheme(app.theme === "dark" ? "light" : "dark")}
        onOpenSettings={onOpenSettings}
        onOpenHelp={onOpenHelp}
        onOpenHome={() => app.setView("home")}
        onOpenAllSessions={() => {
          app.setView("all-sessions");
          void app.loadAllSessions();
        }}
        onRefresh={handleRefresh}
        view="main"
      />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar onRequestRename={onRequestRename} />
        <SessionsList onRequestRename={onRequestRename} onOpenQuickStart={onOpenQuickStart} />
        <PreviewPane />
      </div>
    </div>
  );
}
