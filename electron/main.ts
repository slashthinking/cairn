// Cairn — Electron main process (TypeScript)
// PRD §7 — Frontend renders via React + Vite, all native ops happen here.

import { app, BrowserWindow } from "electron";
import path from "node:path";
import { registerWorkspaceIpc } from "./ipc/workspace";
import { registerClaudeIpc } from "./ipc/claude";
import { registerTerminalIpc } from "./ipc/terminal";
import { registerStoreIpc } from "./ipc/store";
import { registerLancedbIpc } from "./ipc/lancedb";
import { fixPathSync, fixPathAsync } from "./lib/fixPath";
import { ipcMain } from "electron";
import os from "node:os";

// In CJS, __dirname is provided by Node automatically — no need to derive from import.meta
const isDev = process.env.NODE_ENV === "development";

// Patch PATH so spawn("claude", …) works when launched from Finder/Dock.
// macOS GUI launches inherit a minimal PATH that excludes Homebrew, npm/bun
// globals, ~/.local/bin, etc — exactly where claude is usually installed.
fixPathSync();

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 880,
    minHeight: 600,
    center: true,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: "#1a1a1a",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());

  if (isDev) {
    mainWindow.loadURL("http://localhost:1420");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(async () => {
  registerStoreIpc();
  registerWorkspaceIpc();
  registerClaudeIpc();
  registerTerminalIpc();
  registerLancedbIpc();
  // Tiny system-info handler — used by the dashboard hero to greet the user.
  ipcMain.handle("system:username", () => {
    try {
      const u = os.userInfo();
      return u.username || null;
    } catch {
      return null;
    }
  });
  createWindow();
  // Refine PATH from the user's login shell in the background — catches
  // custom installs (asdf, mise, pyenv) that aren't in COMMON_PATHS.
  void fixPathAsync();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
