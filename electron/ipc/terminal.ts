// Terminal launcher (PRD §3.4).
//
// Security: every user-supplied path / id flows through validators in lib/escape.
// AppleScript is piped via stdin (no `osascript -e` injection surface).

import { ipcMain } from "electron";
import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from "node:fs";
import nodePath from "node:path";
import os from "node:os";
import {
  escapeAppleScriptString,
  validateAbsolutePath,
  validateSessionId,
} from "../lib/escape.js";

export function registerTerminalIpc() {
  ipcMain.handle("terminal:list", () => listInstalled());
  ipcMain.handle("terminal:resume", (_e, p: ResumePayload) => resume(p));
  ipcMain.handle("terminal:new-project", (_e, p: NewProjectPayload) =>
    startNewProject(p),
  );
  ipcMain.handle("terminal:new-session", (_e, p: NewSessionPayload) =>
    startNewSession(p),
  );
}

interface InstalledTerminals {
  iterm2: boolean;
  warp: boolean;
  ghostty: boolean;
  kitty: boolean;
  alacritty: boolean;
  terminalApp: true;
}

function listInstalled(): InstalledTerminals {
  return {
    iterm2: existsSync("/Applications/iTerm.app"),
    warp: existsSync("/Applications/Warp.app"),
    ghostty: existsSync("/Applications/Ghostty.app"),
    kitty: existsSync("/Applications/kitty.app"),
    alacritty: existsSync("/Applications/Alacritty.app"),
    terminalApp: true,
  };
}

const ALLOWED_TERMINALS = new Set([
  "iterm2",
  "terminal",
  "warp",
  "ghostty",
  "kitty",
  "alacritty",
  "custom",
]);

interface ResumePayload {
  terminal: string;
  cwd: string;
  sessionId?: string;
  customCommandTemplate?: string;
}

async function resume(p: ResumePayload): Promise<void> {
  if (!ALLOWED_TERMINALS.has(p.terminal)) {
    throw new Error(`unknown terminal: ${p.terminal}`);
  }
  const cwd = validateAbsolutePath(p.cwd);
  const id = p.sessionId ? validateSessionId(p.sessionId) : undefined;
  const cmd = id ? `cd "${cwd}" && claude --resume ${id}` : `cd "${cwd}" && claude`;
  return launch(p.terminal, cwd, cmd, p.customCommandTemplate);
}

interface NewProjectPayload {
  workspace: string;
  name?: string;
  initialPrompt?: string;
  terminal: string;
}

const SAFE_NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;

interface NewSessionPayload {
  projectPath: string;
  initialPrompt?: string;
  terminal: string;
}

async function startNewSession(p: NewSessionPayload): Promise<void> {
  if (!ALLOWED_TERMINALS.has(p.terminal)) {
    throw new Error(`unknown terminal: ${p.terminal}`);
  }
  const cwd = validateAbsolutePath(p.projectPath);
  const promptArg = p.initialPrompt
    ? ` "${escapeAppleScriptString(p.initialPrompt)}"`
    : "";
  const cmd = `cd "${cwd}" && claude${promptArg}`;
  return launch(p.terminal, cwd, cmd);
}

async function startNewProject(p: NewProjectPayload): Promise<string> {
  if (!ALLOWED_TERMINALS.has(p.terminal)) {
    throw new Error(`unknown terminal: ${p.terminal}`);
  }
  const workspace = validateAbsolutePath(p.workspace);
  let folderName: string;
  if (p.name?.trim()) {
    if (!SAFE_NAME_RE.test(p.name.trim())) {
      throw new Error(
        "project name must be 1–64 chars, [A-Za-z0-9._-] only",
      );
    }
    folderName = p.name.trim();
  } else {
    const ts = new Date();
    const stamp = `${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}`;
    folderName = `scratch-${stamp}`;
  }
  const projectPath = `${workspace.replace(/\/$/, "")}/${folderName}`;
  mkdirSync(projectPath, { recursive: true });
  const promptArg = p.initialPrompt
    ? ` "${escapeAppleScriptString(p.initialPrompt)}"`
    : "";
  const cmd = `cd "${projectPath}" && claude${promptArg}`;
  await launch(p.terminal, projectPath, cmd);
  return projectPath;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

async function launch(
  terminal: string,
  cwd: string,
  cmd: string,
  customTemplate?: string,
): Promise<void> {
  console.log(`[terminal] launch terminal=${terminal} cwd=${cwd}`);
  switch (terminal) {
    case "iterm2":
      // CRITICAL: don't pass `command "..."` — that REPLACES the default shell
      // with our command, so .zshrc is never sourced and `claude` ends up off
      // the PATH (session ends immediately, "session ended" warning).
      // Instead open a normal shell, THEN write our command into it.
      //
      // Use `application id "com.googlecode.iterm2"` instead of name "iTerm"
      // so macOS Launch Services targets the actual iTerm2 bundle by ID,
      // not whatever app happens to be registered under the name "iTerm"
      // (some users report Terminal.app being opened due to LS cache issues).
      return runOsascriptStdin(`tell application id "com.googlecode.iterm2"
        activate
        set newWindow to (create window with default profile)
        tell current session of newWindow
          write text "${escapeAppleScriptString(cmd)}"
        end tell
      end tell`);
    case "terminal":
      // `do script` already starts a login shell that sources .zshrc, so this
      // path doesn't have the same issue. Still verified locally.
      return runOsascriptStdin(`tell application "Terminal"
        activate
        do script "${escapeAppleScriptString(cmd)}"
      end tell`);
    case "warp":
      // Warp's URL scheme drops you in a fresh shell with the cwd; we have
      // no way to inject a command via the URL, so we just open the folder.
      // Right-click → Copy resume command remains the workaround.
      return openUrl(`warp://action/new_tab?path=${encodeURIComponent(cwd)}`);
    case "ghostty":
    case "kitty":
    case "alacritty":
      // For non-AppleScript terminals, write a temp script that does
      // `cd … && cmd; exec $SHELL` and tell the terminal to launch it.
      // Each terminal has a different way to spawn-with-command, so we use
      // its bundle's binary directly.
      return launchScriptTerminal(terminal, cwd, cmd);
    case "custom": {
      if (!customTemplate)
        throw new Error("customCommandTemplate required for custom terminal");
      return runCustom(customTemplate, cwd, cmd);
    }
    default:
      throw new Error(`unknown terminal: ${terminal}`);
  }
}

/**
 * Launch ghostty/kitty/alacritty via their .app bundle's binary, using each
 * terminal's correct CLI flags. We write a temp shell script to disk, make it
 * executable, and pass it to the terminal. The script runs the command in a
 * login shell (so .zshrc + PATH are sourced), then keeps the shell open so
 * the user can keep working after `claude` exits.
 */
async function launchScriptTerminal(
  terminal: "ghostty" | "kitty" | "alacritty",
  cwd: string,
  cmd: string,
): Promise<void> {
  const config: Record<typeof terminal, { app: string; bin: string; args: (script: string) => string[] }> = {
    ghostty: {
      app: "/Applications/Ghostty.app",
      bin: "/Applications/Ghostty.app/Contents/MacOS/ghostty",
      args: (s) => [`--command=${s}`],
    },
    kitty: {
      app: "/Applications/kitty.app",
      bin: "/Applications/kitty.app/Contents/MacOS/kitty",
      args: (s) => [s],
    },
    alacritty: {
      app: "/Applications/Alacritty.app",
      bin: "/Applications/Alacritty.app/Contents/MacOS/alacritty",
      args: (s) => ["-e", "/bin/sh", s],
    },
  };
  const c = config[terminal];
  if (!existsSync(c.bin)) {
    throw new Error(`${terminal} not found at ${c.bin} — install or pick a different terminal.`);
  }

  const scriptPath = writeLaunchScript(cwd, cmd);

  return new Promise((resolve, reject) => {
    const proc = spawn(c.bin, c.args(scriptPath), {
      detached: true,
      stdio: "ignore",
    });
    proc.on("error", reject);
    // Don't wait for close — terminals are long-running. Resolve once spawn
    // succeeded (no error within ~250ms).
    proc.unref();
    setTimeout(resolve, 250);
  });
}

/**
 * Write a one-shot bash script that cd's to cwd, runs `cmd`, then keeps the
 * shell alive (so the user can keep using the terminal after claude exits).
 * Each invocation gets a fresh script in the system tmp dir.
 */
function writeLaunchScript(cwd: string, cmd: string): string {
  const dir = mkdtempSync(nodePath.join(os.tmpdir(), "cairn-launch-"));
  const scriptPath = nodePath.join(dir, "launch.sh");
  const shell = process.env.SHELL || "/bin/zsh";
  // -i -l: interactive login shell so .zshrc is sourced (PATH includes claude).
  // After cmd exits, exec the shell so the window stays open.
  const body = `#!/bin/bash
exec ${shell} -i -l -c ${shellEscape(`cd ${shellEscape(cwd)} && ${cmd}; exec ${shell} -i -l`)}
`;
  writeFileSync(scriptPath, body, { mode: 0o755 });
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Run AppleScript by piping it to `osascript` stdin — avoids -e quoting bugs.
 */
function runOsascriptStdin(script: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("osascript", ["-"], {
      stdio: ["pipe", "ignore", "pipe"],
    });
    let stderr = "";
    proc.stderr?.on("data", (b) => (stderr += b.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`osascript exited ${code}: ${stderr}`));
    });
    proc.stdin.write(script);
    proc.stdin.end();
  });
}

function openUrl(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("open", [url], { detached: true, stdio: "ignore" });
    proc.on("error", reject);
    proc.unref();
    resolve();
  });
}

/**
 * Launch a GUI terminal app (Ghostty, kitty, Alacritty) with extra CLI args.
 * Uses `open -na <App> --args …` so each invocation gets a NEW window and
 * the child args are forwarded to the app binary.
 */
function openApp(appName: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("open", ["-na", appName, "--args", ...args], {
      detached: true,
      stdio: "ignore",
    });
    proc.on("error", reject);
    proc.unref();
    resolve();
  });
}

/**
 * Run a user-provided custom command template. The template is what the user
 * configured in Settings → Terminal, so we trust it. Substitution uses simple
 * placeholder replacement; cwd/cmd were already validated upstream.
 */
function runCustom(template: string, cwd: string, cmd: string): Promise<void> {
  const resolved = template
    .replaceAll("{{cwd}}", cwd)
    .replaceAll("{{cmd}}", cmd);
  return new Promise((resolve, reject) => {
    const proc = spawn("sh", ["-c", resolved], {
      detached: true,
      stdio: "ignore",
    });
    proc.on("error", reject);
    proc.unref();
    resolve();
  });
}

