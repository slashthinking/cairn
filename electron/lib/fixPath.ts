// Fix the PATH environment variable for macOS GUI launches.
//
// When a .app bundle is launched from Finder / Dock / `open` on macOS, it
// inherits a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin) — none of the
// common locations where users install dev tools (Homebrew, npm/bun globals,
// rustup, ~/.local/bin) are on it. The `claude` CLI is almost never on the
// default PATH, so child_process.spawn("claude") fails.
//
// We patch process.env.PATH twice:
//   1. Synchronously, by prepending a hardcoded list of well-known locations
//      so subsequent spawn() calls in this same tick already work.
//   2. Asynchronously, by asking the user's login shell what PATH it would
//      provide and merging that in. Catches custom installs (asdf, mise,
//      pyenv, custom dirs added in .zshrc).

import { spawn } from "node:child_process";
import os from "node:os";

const HOME = os.homedir();

const COMMON_PATHS = [
  `${HOME}/.local/bin`,
  `${HOME}/.bun/bin`,
  `${HOME}/.cargo/bin`,
  `${HOME}/.deno/bin`,
  `${HOME}/.npm-global/bin`,
  `${HOME}/.volta/bin`,
  `${HOME}/.nvm/versions/node/current/bin`,
  "/opt/homebrew/bin",
  "/opt/homebrew/sbin",
  "/usr/local/bin",
  "/usr/local/sbin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
];

function dedupe(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    if (!p) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

/** Synchronous step — run before any IPC handlers register. */
export function fixPathSync(): void {
  if (process.platform !== "darwin" && process.platform !== "linux") return;
  const current = (process.env.PATH ?? "").split(":").filter(Boolean);
  process.env.PATH = dedupe([...current, ...COMMON_PATHS]).join(":");
}

/**
 * Async step — best-effort PATH refinement via the user's login shell.
 * Tolerates failure: if the shell never returns or errors, we keep what
 * fixPathSync already gave us.
 */
export async function fixPathAsync(): Promise<void> {
  if (process.platform !== "darwin" && process.platform !== "linux") return;
  const shell = process.env.SHELL || "/bin/zsh";
  const remote = await new Promise<string | null>((resolve) => {
    const proc = spawn(shell, ["-ilc", "command echo $PATH"], {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
    });
    let buf = "";
    proc.stdout.on("data", (chunk) => {
      buf += chunk.toString();
    });
    proc.on("close", (code) => {
      if (code !== 0) return resolve(null);
      const lines = buf.trim().split("\n");
      // The last non-empty line is our PATH (shell may emit MOTD/banner first)
      const last = lines.reverse().find((l) => l.includes("/")) ?? null;
      resolve(last);
    });
    proc.on("error", () => resolve(null));
  });
  if (!remote) return;
  const current = (process.env.PATH ?? "").split(":").filter(Boolean);
  const fromShell = remote.split(":").filter(Boolean);
  process.env.PATH = dedupe([...fromShell, ...current]).join(":");
}
