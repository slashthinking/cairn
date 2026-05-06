import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { fixPathSync } from "./fixPath";

describe("fixPathSync", () => {
  let savedPath: string | undefined;
  let savedPlatform: NodeJS.Platform;

  beforeEach(() => {
    savedPath = process.env.PATH;
    savedPlatform = process.platform;
  });

  afterEach(() => {
    process.env.PATH = savedPath;
    Object.defineProperty(process, "platform", { value: savedPlatform });
  });

  test("prepends common locations on darwin", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    process.env.PATH = "/usr/bin:/bin";
    fixPathSync();
    expect(process.env.PATH).toContain("/opt/homebrew/bin");
    expect(process.env.PATH).toContain("/usr/local/bin");
    expect(process.env.PATH).toContain(".local/bin");
    // Original entries must still be present
    expect(process.env.PATH).toContain("/usr/bin");
    expect(process.env.PATH).toContain("/bin");
  });

  test("dedupes existing entries", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    process.env.PATH = "/opt/homebrew/bin:/usr/bin";
    fixPathSync();
    const matches = process.env.PATH!.match(/\/opt\/homebrew\/bin/g) ?? [];
    expect(matches.length).toBe(1);
  });

  test("no-op on win32", () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    const before = "C:\\Windows;C:\\Windows\\System32";
    process.env.PATH = before;
    fixPathSync();
    expect(process.env.PATH).toBe(before);
  });

  test("handles empty PATH gracefully", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    process.env.PATH = "";
    fixPathSync();
    expect(process.env.PATH).toContain("/opt/homebrew/bin");
  });
});
