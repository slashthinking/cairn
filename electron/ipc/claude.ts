// Local `claude` CLI integration (PRD §3.5, §7.3).
//
// Verified against real `claude --help` (2026-04-25):
//   - `-p` / `--print` for non-interactive
//   - `--output-format json` returns a wrapper with `result` and `structured_output`
//   - `--json-schema <json>` constrains output to a JSON schema → populates `structured_output`
//   - The model's structured response lives in `.structured_output`, NOT directly in stdout

import { ipcMain } from "electron";
import { spawn } from "node:child_process";
import os from "node:os";
import {
  buildClusterPrompt,
  buildRenamePrompt,
  extractStructured,
  SCHEMA_CLUSTERS,
  SCHEMA_RENAME,
  validateCluster,
  validateRename,
  type ClusterResponse,
  type SuggestionsResponse,
} from "../lib/promptBuilder";

export function registerClaudeIpc() {
  ipcMain.handle("claude:detect", detectClaude);
  ipcMain.handle("claude:rename-suggestions", (_e, payload: unknown) =>
    renameSuggestions(validateRename(payload)),
  );
  ipcMain.handle("claude:cluster", (_e, payload: unknown) =>
    clusterProjects(validateCluster(payload)),
  );
}

async function detectClaude(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("which", ["claude"], { stdio: "ignore" });
    proc.on("close", (code) => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });
}

async function renameSuggestions(payload: {
  kind: "project" | "session";
  context: string;
}): Promise<SuggestionsResponse> {
  const wrapper = await runClaude({
    prompt: buildRenamePrompt(payload),
    schema: SCHEMA_RENAME,
  });
  return extractStructured<SuggestionsResponse>(wrapper);
}

async function clusterProjects(payload: {
  workspace: string;
  projects: { id: string; name: string; firstPrompts: string[] }[];
}): Promise<ClusterResponse> {
  const wrapper = await runClaude({
    prompt: buildClusterPrompt(payload),
    schema: SCHEMA_CLUSTERS,
  });
  return extractStructured<ClusterResponse>(wrapper);
}

interface RunOptions {
  prompt: string;
  schema?: unknown;
}

/**
 * Spawn `claude -p --output-format json [--json-schema ...]`.
 *
 * We deliberately do NOT pass `--bare`: that flag disables OAuth + keychain
 * lookups and only honors ANTHROPIC_API_KEY. Most users authenticate via
 * `claude login` (OAuth), so --bare causes "Not logged in" + exit 1.
 *
 * The wrapper JSON has its own `is_error` flag — claude often returns
 * exit 0 with `{is_error: true, result: "<reason>"}`, so we surface the
 * `result` field as the error message in that case (better than just
 * "claude exited with code N").
 */
function runClaude({ prompt, schema }: RunOptions): Promise<unknown> {
  const args = ["-p", "--output-format", "json"];
  if (schema) args.push("--json-schema", JSON.stringify(schema));
  return new Promise((resolve, reject) => {
    // Run from homedir so claude doesn't auto-pick a CLAUDE.md from cwd.
    const proc = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: os.homedir(),
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (b) => (stdout += b.toString()));
    proc.stderr.on("data", (b) => (stderr += b.toString()));
    proc.on("close", (code) => {
      // Try to parse the wrapper even on non-zero exit — claude often emits
      // a structured error wrapper while still exiting 1.
      let wrapper: unknown = null;
      try {
        wrapper = JSON.parse(stdout);
      } catch {
        /* fall through */
      }
      if (
        wrapper &&
        typeof wrapper === "object" &&
        (wrapper as { is_error?: boolean }).is_error
      ) {
        const msg =
          (wrapper as { result?: string }).result ??
          stderr.trim() ??
          `claude exited with code ${code}`;
        return reject(new Error(msg));
      }
      if (code !== 0) {
        return reject(
          new Error(stderr.trim() || `claude exited with code ${code}`),
        );
      }
      if (!wrapper) {
        return reject(
          new Error(
            `Couldn't parse claude wrapper JSON.\n${stdout.slice(0, 200)}`,
          ),
        );
      }
      resolve(wrapper);
    });
    proc.on("error", reject);
    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}
