import { describe, expect, test } from "bun:test";
import {
  buildClusterPrompt,
  buildRenamePrompt,
  extractStructured,
  parseLooseJson,
  SCHEMA_CLUSTERS,
  SCHEMA_RENAME,
  validateCluster,
  validateRename,
} from "./promptBuilder";

describe("extractStructured", () => {
  test("prefers structured_output when present", () => {
    const wrapper = {
      type: "result",
      subtype: "success",
      is_error: false,
      result: "should not be used",
      session_id: "abc",
      structured_output: { answer: 42 },
    };
    expect(extractStructured<{ answer: number }>(wrapper)).toEqual({ answer: 42 });
  });

  test("falls back to JSON-parsing .result", () => {
    const wrapper = {
      type: "result",
      subtype: "success",
      is_error: false,
      result: '{"answer": 42}',
      session_id: "abc",
    };
    expect(extractStructured<{ answer: number }>(wrapper)).toEqual({ answer: 42 });
  });

  test("extracts JSON block from prose in .result", () => {
    const wrapper = {
      type: "result",
      subtype: "success",
      is_error: false,
      result: 'Here is the answer:\n{"answer": 42}\nHope this helps!',
      session_id: "abc",
    };
    expect(extractStructured<{ answer: number }>(wrapper)).toEqual({ answer: 42 });
  });

  test("throws on is_error=true", () => {
    expect(() =>
      extractStructured({
        type: "result",
        is_error: true,
        result: "rate limit exceeded",
      }),
    ).toThrow();
  });

  test("throws on non-object", () => {
    expect(() => extractStructured(null)).toThrow();
    expect(() => extractStructured("string")).toThrow();
  });
});

describe("parseLooseJson", () => {
  test("parses clean JSON", () => {
    expect(parseLooseJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });
  test("extracts JSON block from prose", () => {
    expect(parseLooseJson<{ a: number }>("Hello\n{\"a\":1}\nbye")).toEqual({ a: 1 });
  });
  test("throws on no JSON block", () => {
    expect(() => parseLooseJson("nothing here")).toThrow();
  });
});

describe("buildRenamePrompt", () => {
  test("project mode mentions filename rules", () => {
    const p = buildRenamePrompt({ kind: "project", context: "x" });
    expect(p).toContain("folder names");
    expect(p).toContain("[a-z0-9_-]");
  });
  test("session mode mentions title rules", () => {
    const p = buildRenamePrompt({ kind: "session", context: "x" });
    expect(p).toContain("session titles");
    expect(p).toContain("60 chars");
  });
  test("includes context verbatim", () => {
    expect(buildRenamePrompt({ kind: "project", context: "ABC123" })).toContain(
      "ABC123",
    );
  });
});

describe("buildClusterPrompt", () => {
  test("includes workspace name and project list with prompts", () => {
    const p = buildClusterPrompt({
      workspace: "works",
      projects: [
        { id: "p1", name: "mira", firstPrompts: ["bill", "stripe"] },
      ],
    });
    expect(p).toContain("works");
    expect(p).toContain("p1");
    expect(p).toContain("mira");
    expect(p).toContain("bill");
  });
});

describe("schemas", () => {
  test("rename schema requires 4 suggestions", () => {
    expect(SCHEMA_RENAME.properties.suggestions.minItems).toBe(4);
    expect(SCHEMA_RENAME.properties.suggestions.maxItems).toBe(4);
  });
  test("cluster schema requires name + projectIds per cluster (no emoji)", () => {
    const props = SCHEMA_CLUSTERS.properties.clusters.items.properties;
    expect(props).toHaveProperty("name");
    expect(props).toHaveProperty("projectIds");
    expect(props).not.toHaveProperty("emoji");
  });
});

describe("validateRename", () => {
  test("accepts valid project payload", () => {
    expect(() =>
      validateRename({ kind: "project", context: "x" }),
    ).not.toThrow();
  });
  test("rejects bad kind", () => {
    expect(() => validateRename({ kind: "weird", context: "x" })).toThrow();
  });
  test("rejects empty context", () => {
    expect(() => validateRename({ kind: "project", context: "" })).toThrow();
  });
  test("rejects oversized context (>50KB)", () => {
    expect(() =>
      validateRename({ kind: "project", context: "x".repeat(50_001) }),
    ).toThrow();
  });
  test("rejects null", () => {
    expect(() => validateRename(null)).toThrow();
  });
});

describe("validateCluster", () => {
  test("accepts valid payload", () => {
    expect(() =>
      validateCluster({
        workspace: "works",
        projects: [{ id: "p1", name: "x", firstPrompts: [] }],
      }),
    ).not.toThrow();
  });
  test("rejects empty projects", () => {
    expect(() =>
      validateCluster({ workspace: "works", projects: [] }),
    ).toThrow();
  });
  test("rejects malformed project entry", () => {
    expect(() =>
      validateCluster({
        workspace: "works",
        projects: [{ id: 1, name: "x" }],
      }),
    ).toThrow();
  });
});
