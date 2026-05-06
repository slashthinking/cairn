import { describe, expect, test } from "bun:test";
import { cn } from "./cn";

describe("cn", () => {
  test("merges class strings", () => {
    expect(cn("a", "b")).toBe("a b");
  });
  test("handles falsy", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });
  test("twMerge resolves conflicting tailwind classes", () => {
    // px-4 px-8 → only px-8 remains
    expect(cn("px-4 py-2", "px-8")).toBe("py-2 px-8");
  });
  test("conditional classes via object/array shapes", () => {
    expect(cn("a", { b: true, c: false })).toBe("a b");
    expect(cn(["a", "b"])).toBe("a b");
  });
});
