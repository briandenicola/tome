import { describe, test, expect } from "vitest";
import { estimatePagesFromDuration } from "@/lib/sources/page-estimate";

describe("estimating pages from an audiobook's length", () => {
  test("about 30 pages an hour", () => {
    expect(estimatePagesFromDuration(3600)).toBe(30);
    expect(estimatePagesFromDuration(13 * 3600 + 44 * 60)).toBe(412);
    expect(estimatePagesFromDuration(10)).toBe(1);
  });

  test("no length, no estimate", () => {
    for (const v of [undefined, null, 0, -5, Number.NaN]) expect(estimatePagesFromDuration(v)).toBeNull();
  });
});
