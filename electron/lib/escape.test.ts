import { describe, expect, test } from "bun:test";
import {
  escapeAppleScriptString,
  escapeShellSingleQuote,
  validateAbsolutePath,
  validateSessionId,
} from "./escape";

describe("escapeAppleScriptString", () => {
  test("escapes double quotes", () => {
    expect(escapeAppleScriptString('hello "world"')).toBe('hello \\"world\\"');
  });
  test("escapes backslashes", () => {
    expect(escapeAppleScriptString("a\\b")).toBe("a\\\\b");
  });
  test("backslash before quote handled correctly", () => {
    // Order matters: backslashes first, then quotes
    expect(escapeAppleScriptString('\\"')).toBe('\\\\\\"');
  });
});

describe("escapeShellSingleQuote", () => {
  test("wraps simple string in quotes", () => {
    expect(escapeShellSingleQuote("hello")).toBe("'hello'");
  });
  test("escapes embedded single quotes via close-escape-reopen", () => {
    expect(escapeShellSingleQuote("it's")).toBe(`'it'\\''s'`);
  });
  test("preserves dangerous chars inside quotes", () => {
    expect(escapeShellSingleQuote("$(rm -rf /)")).toBe("'$(rm -rf /)'");
  });
});

describe("validateSessionId", () => {
  test("accepts uuid-shaped ids", () => {
    expect(() => validateSessionId("abc123-def-456")).not.toThrow();
  });
  test("rejects shell metachars", () => {
    expect(() => validateSessionId("$(whoami)")).toThrow();
    expect(() => validateSessionId("a;b")).toThrow();
    expect(() => validateSessionId("../../etc/passwd")).toThrow();
  });
  test("rejects empty string", () => {
    expect(() => validateSessionId("")).toThrow();
  });
});

describe("validateAbsolutePath", () => {
  test("accepts normal absolute paths", () => {
    expect(() => validateAbsolutePath("/Users/alice/works/proj")).not.toThrow();
  });
  test("rejects relative paths", () => {
    expect(() => validateAbsolutePath("works/proj")).toThrow();
  });
  test("rejects NUL bytes", () => {
    expect(() => validateAbsolutePath("/Users/alice/x\0y")).toThrow();
  });
  test("rejects control chars (newline injection)", () => {
    expect(() => validateAbsolutePath("/Users/alice/x\ny")).toThrow();
  });
  test("rejects empty", () => {
    expect(() => validateAbsolutePath("")).toThrow();
  });
});
