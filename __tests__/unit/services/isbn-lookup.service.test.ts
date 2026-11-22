import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { lookupIsbn } from "@/lib/services/isbn-lookup.service";
import { ManualBookError } from "@/lib/services/manual-book.service";

const ISBN = "9780593101131";
const found = { [`ISBN:${ISBN}`]: { title: "Some Book", authors: [{ name: "An Author" }], number_of_pages: 320 } };
const ok = () => new Response(JSON.stringify(found), { status: 200 });
const timeout = () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });

describe("lookupIsbn against an unreliable Open Library", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const run = async (p: Promise<unknown>) => {
    const settled = p.then((v) => ({ v }), (e) => ({ e }));
    await vi.runAllTimersAsync();
    return settled as Promise<{ v?: unknown; e?: unknown }>;
  };

  test("identifies itself to Open Library", async () => {
    fetchMock.mockResolvedValueOnce(ok());
    await run(lookupIsbn(ISBN));
    expect(fetchMock.mock.calls[0][1].headers["user-agent"]).toMatch(/Tome/);
  });

  test("retries once after a timeout and returns the book", async () => {
    fetchMock.mockRejectedValueOnce(timeout()).mockResolvedValueOnce(ok());
    const { v } = await run(lookupIsbn(ISBN));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(v).toMatchObject({ title: "Some Book", authors: ["An Author"], totalPages: 320 });
  });

  test("says Open Library was slow when both tries time out", async () => {
    fetchMock.mockRejectedValue(timeout());
    const { e } = await run(lookupIsbn(ISBN));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(e).toBeInstanceOf(ManualBookError);
    expect((e as ManualBookError).status).toBe(504);
    expect((e as Error).message).toMatch(/didn't answer in time/);
  });

  test("retries a 503 and reports the status", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 503 }));
    const { e } = await run(lookupIsbn(ISBN));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((e as Error).message).toMatch(/HTTP 503/);
  });

  test("does not retry a 404", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 404 }));
    const { e } = await run(lookupIsbn(ISBN));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((e as ManualBookError).status).toBe(502);
  });

  test("says it couldn't reach Open Library on a network error", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const { e } = await run(lookupIsbn(ISBN));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((e as Error).message).toMatch(/Couldn't reach Open Library/);
  });
});
