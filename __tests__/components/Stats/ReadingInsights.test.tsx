import { describe, test, expect } from "vitest";
import { heatLevels, yearWeeks } from "@/components/Stats/ReadingInsights";

describe("heat levels", () => {
  test("no reading is level 0; reading days split into four even groups", () => {
    const level = heatLevels([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map(level)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
    expect(heatLevels([])(10)).toBe(0);
  });
});

describe("the year's weeks", () => {
  test("Sunday-first weeks covering every day of the year once", () => {
    const weeks = yearWeeks(2026); // Jan 1 2026 is a Thursday
    expect(weeks[0]).toEqual([null, null, null, null, "2026-01-01", "2026-01-02", "2026-01-03"]);
    const days = weeks.flat().filter(Boolean);
    expect(days).toHaveLength(365);
    expect(days[days.length - 1]).toBe("2026-12-31");
    expect(yearWeeks(2024).flat().filter(Boolean)).toHaveLength(366);
  });
});
