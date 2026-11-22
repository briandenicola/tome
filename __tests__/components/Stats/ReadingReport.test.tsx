import { describe, test, expect, afterEach, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { ReadingReport, pageNumbers } from "@/components/Stats/ReadingReport";

const row = (i: number, over: Record<string, unknown> = {}) => ({
  bookId: i,
  title: `Book ${String(i).padStart(2, "0")}`,
  authors: ["Someone"],
  series: null,
  seriesIndex: null,
  tags: [],
  startedDate: "2026-01-01",
  finishedDate: `2026-02-${String(i).padStart(2, "0")}`,
  days: i,
  rating: (i % 5) + 1,
  pages: 100,
  reread: false,
  format: "ebook",
  lastSynced: null,
  ...over,
});

const report = (n: number) => ({
  year: 2026,
  books: Array.from({ length: n }, (_, i) => row(i + 1)),
  summary: { count: n, pages: n * 100, rated: n, averageRating: 3, averageDays: 10, formats: { ebook: n, audiobook: 0, print: 0, unknown: 0 } },
});

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(report(23)), { status: 200 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const titles = () => within(screen.getAllByRole("table")[0]!).getAllByRole("link").map((a) => a.textContent).filter((t) => t?.startsWith("Book"));

describe("pageNumbers", () => {
  test("all pages when few, else ends and neighbours with gaps", () => {
    expect(pageNumbers(1, 3)).toEqual([1, 2, 3]);
    expect(pageNumbers(1, 10)).toEqual([1, 2, null, 10]);
    expect(pageNumbers(5, 10)).toEqual([1, null, 4, 5, 6, null, 10]);
    expect(pageNumbers(10, 10)).toEqual([1, null, 9, 10]);
  });
});

describe("ReadingReport", () => {
  test("shows ten rows a page, and pages through the rest", async () => {
    render(<ReadingReport />);
    await waitFor(() => expect(screen.getByText("1–10 of 23")).toBeInTheDocument());
    expect(titles()).toHaveLength(10);
    expect(titles()[0]).toBe("Book 01");

    fireEvent.click(screen.getByRole("button", { name: "Page 3" }));
    expect(screen.getByText("21–23 of 23")).toBeInTheDocument();
    expect(titles()).toEqual(["Book 21", "Book 22", "Book 23"]);
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  test("sorts by a column, and a second click reverses it", async () => {
    render(<ReadingReport />);
    await waitFor(() => expect(screen.getByText("1–10 of 23")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Days/ }));
    expect(titles()[0]).toBe("Book 23");
    fireEvent.click(screen.getByRole("button", { name: /Days/ }));
    expect(titles()[0]).toBe("Book 01");
  });

  test("a bigger page size shows more rows", async () => {
    render(<ReadingReport />);
    await waitFor(() => expect(screen.getByText("1–10 of 23")).toBeInTheDocument());
    fireEvent.change(screen.getByDisplayValue("10"), { target: { value: "25" } });
    expect(screen.getByText("1–23 of 23")).toBeInTheDocument();
    expect(titles()).toHaveLength(23);
  });
});
