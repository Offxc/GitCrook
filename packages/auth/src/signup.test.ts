import { describe, expect, it } from "vitest";
import { parseAllowList } from "./signup";

describe("parseAllowList", () => {
  it("splits, trims and drops empties", () => {
    expect(parseAllowList(" 123 , 456,, 789 ,")).toEqual(["123", "456", "789"]);
  });

  it("is empty for nothing", () => {
    expect(parseAllowList(undefined)).toEqual([]);
    expect(parseAllowList("")).toEqual([]);
    expect(parseAllowList("  ,  ")).toEqual([]);
  });
});
