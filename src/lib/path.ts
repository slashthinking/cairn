// Pure path helpers (renderer-safe — no node fs).

export function basename(absPath: string): string {
  const trimmed = absPath.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

export function dirname(absPath: string): string {
  const trimmed = absPath.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? "" : trimmed.slice(0, idx);
}

export function tildify(absPath: string, home: string): string {
  if (!home) return absPath;
  if (absPath === home) return "~";
  if (absPath.startsWith(home + "/")) return "~" + absPath.slice(home.length);
  return absPath;
}

export function formatRelativeTime(ms: number): string {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  if (diff < 0) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  const week = Math.floor(day / 7);
  if (week < 4) return `${week}w`;
  const month = Math.floor(day / 30);
  return `${month}mo`;
}
