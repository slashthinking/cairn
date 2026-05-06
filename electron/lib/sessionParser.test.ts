import { describe, expect, test } from "bun:test";
import {
  classifyLifecycle,
  encodeProjectPath,
  extractText,
  parseSessionContent,
  parseSessionMeta,
} from "./sessionParser";

describe("parseSessionContent", () => {
  test("empty input → empty session", () => {
    const r = parseSessionContent("");
    expect(r.messageCount).toBe(0);
    expect(r.title).toBeNull();
  });

  test("extracts title + cwd + branch from real-shape jsonl", () => {
    const jsonl = [
      JSON.stringify({
        type: "permission-mode",
        permissionMode: "default",
        sessionId: "abc",
      }),
      JSON.stringify({
        type: "user",
        timestamp: "2026-04-25T10:00:00Z",
        message: { role: "user", content: "Add a Pro tier toggle" },
        cwd: "/Users/alice/Coding/mira",
        gitBranch: "feat/billing",
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-04-25T10:00:30Z",
        message: { role: "assistant", model: "opus-4.7", content: "OK" },
      }),
    ].join("\n");
    const r = parseSessionContent(jsonl);
    expect(r.title).toBe("Add a Pro tier toggle");
    expect(r.cwd).toBe("/Users/alice/Coding/mira");
    expect(r.gitBranch).toBe("feat/billing");
    expect(r.model).toBe("opus-4.7");
    expect(r.messageCount).toBe(2); // permission-mode skipped
  });

  test("skips non-message types in count", () => {
    const jsonl = [
      JSON.stringify({ type: "permission-mode" }),
      JSON.stringify({ type: "file-history-snapshot" }),
      JSON.stringify({ type: "user", message: { content: "hi" } }),
    ].join("\n");
    const r = parseSessionContent(jsonl);
    expect(r.messageCount).toBe(1);
  });

  test("handles array content (assistant blocks)", () => {
    const jsonl = JSON.stringify({
      type: "user",
      message: {
        content: [
          { type: "text", text: "Look at the file" },
          { type: "image", source: {} },
        ],
      },
    });
    const r = parseSessionContent(jsonl);
    expect(r.title).toBe("Look at the file");
  });

  test("truncates long titles to 60 chars", () => {
    const jsonl = JSON.stringify({
      type: "user",
      message: { content: "x".repeat(100) },
    });
    const r = parseSessionContent(jsonl);
    expect(r.title?.length).toBe(60);
  });

  test("skips malformed lines", () => {
    const jsonl = [
      "not json",
      JSON.stringify({ type: "user", message: { content: "hi" } }),
      "{also not valid",
    ].join("\n");
    const r = parseSessionContent(jsonl);
    expect(r.messageCount).toBe(1);
    expect(r.title).toBe("hi");
  });

  test("startedAt is first timestamp, lastActive is final", () => {
    const jsonl = [
      JSON.stringify({
        type: "user",
        timestamp: "2026-04-25T10:00:00Z",
        message: {},
      }),
      JSON.stringify({
        type: "user",
        timestamp: "2026-04-25T11:00:00Z",
        message: {},
      }),
      JSON.stringify({
        type: "user",
        timestamp: "2026-04-25T12:00:00Z",
        message: {},
      }),
    ].join("\n");
    const r = parseSessionContent(jsonl);
    expect(r.startedAt).toBeLessThan(r.lastActive);
    expect(r.lastActive - r.startedAt).toBe(2 * 60 * 60 * 1000);
  });
});

describe("extractText", () => {
  test("string → returned as-is", () => {
    expect(extractText("hi")).toBe("hi");
  });
  test("array of text blocks → joined", () => {
    expect(
      extractText([
        { type: "text", text: "a" },
        { type: "text", text: "b" },
      ]),
    ).toBe("a b");
  });
  test("mixed array → only text blocks extracted", () => {
    expect(
      extractText([
        { type: "text", text: "a" },
        { type: "image", source: {} },
        { type: "tool_use", name: "x" },
      ]),
    ).toBe("a");
  });
  test("non-array non-string → null", () => {
    expect(extractText(42)).toBeNull();
    expect(extractText(null)).toBeNull();
    expect(extractText({})).toBeNull();
  });
  test("array with no text blocks → null", () => {
    expect(extractText([{ type: "image" }])).toBeNull();
  });
});

describe("encodeProjectPath", () => {
  test("plain path: slashes only", () => {
    expect(encodeProjectPath("/Users/alice/Coding/mira")).toBe(
      "-Users-alice-Coding-mira",
    );
  });
  test("path with underscore: replaces underscore", () => {
    expect(encodeProjectPath("/Users/alice/Coding/mira_auto")).toBe(
      "-Users-alice-Coding-mira-auto",
    );
  });
  test("path with space: replaces space", () => {
    expect(encodeProjectPath("/Users/alice/Coding/AI SDK")).toBe(
      "-Users-alice-Coding-AI-SDK",
    );
  });
  test("path with combined special chars", () => {
    expect(encodeProjectPath("/a/b c/d_e")).toBe("-a-b-c-d-e");
  });
  test("preserves dashes in original path", () => {
    expect(encodeProjectPath("/Users/alice/Algorithm/colqwen3-5")).toBe(
      "-Users-alice-Algorithm-colqwen3-5",
    );
  });
  test("path with dot: replaces dot", () => {
    // /Users/alice/Algorithm/colqwen3.5 → -Users-alice-Algorithm-colqwen3-5
    // Verified against real ~/.claude/projects/ directory.
    expect(encodeProjectPath("/Users/alice/Algorithm/colqwen3.5")).toBe(
      "-Users-alice-Algorithm-colqwen3-5",
    );
  });
  test("multiple dots in filename", () => {
    expect(encodeProjectPath("/foo/bar.baz.qux")).toBe("-foo-bar-baz-qux");
  });
  test("path with parens / colons → also dashed", () => {
    // Belt-and-suspenders: any non-alphanumeric, non-dash char becomes -
    expect(encodeProjectPath("/foo/bar (baz):qux")).toBe("-foo-bar--baz--qux");
  });
  test("non-ASCII (Chinese) characters → dashed per char", () => {
    // /Users/alice/Mira/分析 → -Users-alice-Mira--- (each Chinese char = 1 dash)
    // Verified against real ~/.claude/projects/-Users-alice-Mira--- on disk.
    expect(encodeProjectPath("/Users/alice/Mira/分析")).toBe(
      "-Users-alice-Mira---",
    );
  });
});

describe("parseSessionMeta", () => {
  test("parses real ~/.claude/usage-data/session-meta payload", () => {
    const meta = {
      session_id: "11432245-8aaa-4343-be17-0aac20b34aef",
      project_path: "/Users/alice/Coding/mira",
      start_time: "2026-03-13T16:43:25.085Z",
      duration_minutes: 3,
      user_message_count: 1,
      assistant_message_count: 6,
      first_prompt: "Build a TypeScript test suite for ECMAScript features",
      user_message_timestamps: ["2026-03-13T16:43:25.085Z"],
    };
    const r = parseSessionMeta(meta)!;
    expect(r).not.toBeNull();
    expect(r.title).toBe(
      "Build a TypeScript test suite for ECMAScript features",
    );
    expect(r.messageCount).toBe(7);
    expect(r.cwd).toBe("/Users/alice/Coding/mira");
    expect(r.startedAt).toBe(Date.parse("2026-03-13T16:43:25.085Z"));
    // duration_minutes = 3 → lastActive should be at least 3min after start
    expect(r.lastActive).toBeGreaterThanOrEqual(
      r.startedAt + 3 * 60_000 - 1,
    );
  });

  test("uses last user_message_timestamp when later than duration end", () => {
    const meta = {
      start_time: "2026-03-13T16:00:00.000Z",
      duration_minutes: 1,
      user_message_timestamps: [
        "2026-03-13T16:00:00.000Z",
        "2026-03-13T16:30:00.000Z", // 30 min later, beats duration
      ],
    };
    const r = parseSessionMeta(meta)!;
    expect(r.lastActive).toBe(Date.parse("2026-03-13T16:30:00.000Z"));
  });

  test("title truncated to 60 chars", () => {
    const meta = {
      start_time: "2026-03-13T16:00:00.000Z",
      first_prompt: "x".repeat(200),
    };
    expect(parseSessionMeta(meta)!.title!.length).toBe(60);
  });

  test("returns null on missing/invalid start_time", () => {
    expect(parseSessionMeta({ first_prompt: "no start" })).toBeNull();
    expect(parseSessionMeta({ start_time: "not-a-date" })).toBeNull();
  });

  test("returns null on non-object input", () => {
    expect(parseSessionMeta(null)).toBeNull();
    expect(parseSessionMeta("string")).toBeNull();
    expect(parseSessionMeta(42)).toBeNull();
  });

  test("missing message counts → 0", () => {
    const r = parseSessionMeta({
      start_time: "2026-03-13T16:00:00.000Z",
    })!;
    expect(r.messageCount).toBe(0);
  });
});

describe("classifyLifecycle", () => {
  test("≤5 msg + ≤5min = temp", () => {
    expect(
      classifyLifecycle({
        messageCount: 3,
        startedAt: 0,
        lastActive: 60_000,
      }),
    ).toBe("temp");
  });
  test("many messages → persistent", () => {
    expect(
      classifyLifecycle({
        messageCount: 20,
        startedAt: 0,
        lastActive: 60_000,
      }),
    ).toBe("persistent");
  });
  test("long duration → persistent", () => {
    expect(
      classifyLifecycle({
        messageCount: 3,
        startedAt: 0,
        lastActive: 30 * 60 * 1000,
      }),
    ).toBe("persistent");
  });
});
