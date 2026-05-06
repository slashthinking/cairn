// Shell + AppleScript escaping utilities.
//
// Security: all user-supplied strings (cwd, sessionId, prompt) MUST flow through
// these before being embedded in scripts/commands.

/**
 * Escape a string for safe embedding inside a double-quoted AppleScript string literal.
 * AppleScript double-quoted strings interpret \\ and \" — escape both.
 */
export function escapeAppleScriptString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Escape a string for safe embedding inside a POSIX shell single-quoted string.
 * Single quotes are the strongest quoting in sh — only ' itself needs special handling
 * (close, escape with \', reopen).
 */
export function escapeShellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Validate a session id matches the expected uuid-ish shape `[a-f0-9-]+`.
 * Throws if it doesn't — defensive against IPC tampering.
 */
export function validateSessionId(id: string): string {
  if (!/^[a-f0-9-]{1,64}$/i.test(id)) {
    throw new Error(`invalid session id: ${id}`);
  }
  return id;
}

/**
 * Validate a filesystem path:
 *   - Non-empty
 *   - No NUL bytes
 *   - No control chars
 *   - Absolute (starts with /)
 */
export function validateAbsolutePath(p: string): string {
  if (typeof p !== "string" || p.length === 0) {
    throw new Error("path must be a non-empty string");
  }
  if (p.includes("\0")) throw new Error("path contains NUL byte");
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(p)) {
    throw new Error("path contains control characters");
  }
  if (!p.startsWith("/")) throw new Error("path must be absolute");
  return p;
}
