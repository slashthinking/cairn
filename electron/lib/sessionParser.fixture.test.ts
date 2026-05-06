// Integration test: parse jsonl fixtures shaped exactly like real Claude Code data.
// Schema verified against ~/.claude/projects/<encoded>/*.jsonl on 2026-04-25.

import { describe, expect, test } from "bun:test";
import { parseSessionContent } from "./sessionParser";

describe("real-shape fixture", () => {
  test("parses a typical session opening", () => {
    const jsonl = [
      // Session opens with permission-mode envelope
      JSON.stringify({
        type: "permission-mode",
        permissionMode: "default",
        sessionId: "0c658372-e5bf-4cf1-bb5f-38cfba84ec1a",
      }),
      // file-history-snapshot also non-message
      JSON.stringify({
        type: "file-history-snapshot",
        messageId: "ec9bd30d-c2b9-4bd9-9f85-d74d2b9b0079",
        snapshot: { messageId: "x", trackedFileBackups: {}, timestamp: "2026-04-25T10:00:00Z" },
        isSnapshotUpdate: false,
      }),
      // First user message — title source
      JSON.stringify({
        parentUuid: null,
        isSidechain: false,
        promptId: "6db00b5e-042f-4628-aee9-b29ff54b497b",
        type: "user",
        message: {
          role: "user",
          content: "Help me extract this into a SKILLS.md file",
        },
        uuid: "ec9bd30d-c2b9-4bd9-9f85-d74d2b9b0079",
        timestamp: "2026-04-25T10:00:00Z",
        permissionMode: "default",
        userType: "external",
        entrypoint: "cli",
        cwd: "/Users/alice/Coding/AI SDK",
        sessionId: "0c658372",
        version: "2.1.91",
        gitBranch: "HEAD",
      }),
      // Assistant — model lives at message.model
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          model: "claude-opus-4-6",
          content: [
            { type: "thinking", thinking: "..." },
            { type: "text", text: "I'll read the docs first." },
          ],
        },
        timestamp: "2026-04-25T10:00:30Z",
        cwd: "/Users/alice/Coding/AI SDK",
        gitBranch: "HEAD",
      }),
    ].join("\n");

    const r = parseSessionContent(jsonl);

    expect(r.title).toBe("Help me extract this into a SKILLS.md file");
    expect(r.cwd).toBe("/Users/alice/Coding/AI SDK");
    expect(r.gitBranch).toBe("HEAD");
    expect(r.model).toBe("claude-opus-4-6");
    expect(r.messageCount).toBe(2); // permission-mode + file-history-snapshot skipped
    expect(r.startedAt).toBeGreaterThan(0);
    expect(r.lastActive).toBeGreaterThan(r.startedAt);
  });

  test("ignores 'thinking' blocks when extracting title", () => {
    const jsonl = JSON.stringify({
      type: "user",
      message: {
        content: [
          { type: "thinking", thinking: "should not appear" },
          { type: "text", text: "the actual visible prompt" },
        ],
      },
    });
    const r = parseSessionContent(jsonl);
    expect(r.title).toBe("the actual visible prompt");
  });
});
