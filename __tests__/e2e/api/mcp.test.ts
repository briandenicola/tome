import { describe, test, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { setupTestDatabase, teardownTestDatabase, clearTestDatabase } from "../../helpers/db-setup";
import { bookRepository, sessionRepository, progressRepository } from "@/lib/repositories";
import { apiTokenService } from "@/lib/services/api-token.service";
import { POST, GET } from "@/app/api/mcp/route";
import { sameSite } from "@/lib/mcp/server";

/**
 * The MCP endpoint: JSON-RPC over POST, with the backlog tools. Agents find books, add them, and queue them; a read
 * token can only search and list.
 */

beforeAll(async () => {
  await setupTestDatabase(__filename);
});

afterAll(async () => {
  await teardownTestDatabase(__filename);
});

beforeEach(async () => {
  await clearTestDatabase(__filename);
});

let nextId = 1;

async function rpc(method: string, params?: unknown, headers: Record<string, string> = {}) {
  const res = await POST(
    new NextRequest("http://localhost/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", host: "localhost", ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, ...(params !== undefined && { params }) }),
    })
  );
  return { status: res.status, body: await res.json() };
}

async function call(name: string, args: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const { body } = await rpc("tools/call", { name, arguments: args }, headers);
  const r = body.result;
  return { isError: r.isError === true, text: r.content[0].text as string, data: r.structuredContent };
}

async function calibreBook(title: string, authors: string[], extra: Record<string, unknown> = {}) {
  const book = await bookRepository.create({ calibreId: Math.floor(Math.random() * 1e6), source: "calibre", path: "x", title, authors, totalPages: 300, ...extra });
  await sessionRepository.create({ bookId: book.id, status: "to-read", sessionNumber: 1, isActive: true });
  return book;
}

describe("the MCP handshake", () => {
  test("initialize names the server, agrees a protocol version and offers tools", async () => {
    const { status, body } = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(status).toBe(200);
    expect(body.result).toMatchObject({ protocolVersion: "2025-06-18", serverInfo: { name: "tome" }, capabilities: { tools: {} } });
    expect(body.result.instructions).toMatch(/backlog/);

    const unknown = await rpc("initialize", { protocolVersion: "1999-01-01" });
    expect(unknown.body.result.protocolVersion).toBe("2025-11-25");
  });

  test("a notification gets 202 and no body; ping answers", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/mcp", {
        method: "POST",
        body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      })
    );
    expect(res.status).toBe(202);
    expect((await rpc("ping")).body.result).toEqual({});
  });

  test("lists the backlog tools, marking which ones only read", async () => {
    const { body } = await rpc("tools/list");
    const tools = Object.fromEntries(body.result.tools.map((t: { name: string; annotations: { readOnlyHint: boolean } }) => [t.name, t.annotations.readOnlyHint]));
    expect(tools).toEqual({ search_books: true, list_backlog: true, lookup_isbn: true, add_book: false, queue_book: false });
  });

  test("unknown methods, bad JSON and GET are refused", async () => {
    expect((await rpc("resources/list")).body.error.code).toBe(-32601);
    const bad = await POST(new NextRequest("http://localhost/api/mcp", { method: "POST", body: "{" }));
    expect(bad.status).toBe(400);
    expect((await GET()).status).toBe(405);
  });

  test("only pages on Tome's own host may call it from a browser", () => {
    // The test environment drops Origin and Host from requests, so the check is tested on its own.
    expect(sameSite(null, "tome.lan")).toBe(true);
    expect(sameSite("https://tome.lan", "tome.lan")).toBe(true);
    expect(sameSite("https://tome.example.com", "tome:3000", "tome.example.com")).toBe(true);
    expect(sameSite("https://evil.example", "tome.lan")).toBe(false);
    expect(sameSite("null", "tome.lan")).toBe(false);
  });
});

describe("the backlog tools", () => {
  test("search_books finds Calibre books by title, author or ISBN, with their status", async () => {
    const dune = await calibreBook("Dune", ["Frank Herbert"], { isbn: "978-0-441-17271-9" });

    for (const query of ["dune", "Herbert", "9780441172719"]) {
      const { data } = await call("search_books", { query });
      expect(data.books).toEqual([expect.objectContaining({ id: dune.id, title: "Dune", source: "calibre", status: "to-read" })]);
    }
    expect((await call("search_books", { query: " " })).isError).toBe(true);
  });

  test("add_book adds a book to to-read, or to the end of read-next", async () => {
    const pile = await call("add_book", { title: "The Dispossessed", authors: ["Ursula K. Le Guin"], totalPages: 387 });
    expect(pile.data).toMatchObject({ added: true, book: { title: "The Dispossessed", status: "to-read", source: "manual" } });
    expect((await sessionRepository.findActiveByBookId(pile.data.book.id))?.status).toBe("to-read");

    await call("add_book", { title: "Piranesi", authors: ["Susanna Clarke"], status: "read-next" });
    await call("add_book", { title: "Hyperion", authors: ["Dan Simmons"], status: "read-next" });

    const { data } = await call("list_backlog");
    expect(data.books.map((b: { title: string; status: string; position?: number }) => [b.title, b.status, b.position])).toEqual([
      ["Piranesi", "read-next", 1],
      ["Hyperion", "read-next", 2],
      ["The Dispossessed", "to-read", undefined],
    ]);
    expect((await call("list_backlog", { status: "to-read" })).data.books).toHaveLength(1);
  });

  test("add_book won't copy a book Tome has, matching ISBN or title and author, unless told to", async () => {
    const dune = await calibreBook("Dune", ["Frank Herbert"], { isbn: "9780441172719" });

    const byTitle = await call("add_book", { title: "dune", authors: ["frank herbert"] });
    expect(byTitle.data).toMatchObject({ added: false, duplicates: [{ id: dune.id }] });
    const byIsbn = await call("add_book", { title: "Dune (40th anniversary)", isbn: "978-0441172719" });
    expect(byIsbn.data).toMatchObject({ added: false, duplicates: [{ id: dune.id }] });

    // Same title by someone else is a different book.
    expect((await call("add_book", { title: "Dune", authors: ["Someone Else"] })).data.added).toBe(true);
    expect((await call("add_book", { title: "Dune", authors: ["Frank Herbert"], allowDuplicate: true })).data.added).toBe(true);
  });

  test("add_book passes on what's wrong with the details", async () => {
    const r = await call("add_book", { title: "", authors: ["X"] });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/title/i);
    expect((await call("add_book", { title: "X", status: "reading" })).text).toMatch(/to-read.*read-next/);
  });

  test("queue_book moves a book Tome has into read-next and back, but leaves reading and finished books alone", async () => {
    const dune = await calibreBook("Dune", ["Frank Herbert"]);
    expect((await call("queue_book", { bookId: dune.id, status: "read-next" })).data.book.status).toBe("read-next");
    expect((await call("list_backlog", { status: "read-next" })).data.books.map((b: { id: number }) => b.id)).toEqual([dune.id]);
    expect((await call("queue_book", { bookId: dune.id })).data.book.status).toBe("to-read");

    const reading = await bookRepository.create({ calibreId: null, source: "manual", path: "", title: "Underway", totalPages: 100 });
    const session = await sessionRepository.create({ bookId: reading.id, status: "reading", sessionNumber: 1, isActive: true, startedDate: "2026-11-01" });
    await progressRepository.create({ bookId: reading.id, sessionId: session.id, currentPage: 10, currentPercentage: 10, progressDate: "2026-11-02", pagesRead: 10 });
    const refused = await call("queue_book", { bookId: reading.id, status: "to-read" });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/being read/);
    expect((await sessionRepository.findActiveByBookId(reading.id))?.status).toBe("reading");

    const done = await bookRepository.create({ calibreId: null, source: "manual", path: "", title: "Done", totalPages: 100 });
    await sessionRepository.create({ bookId: done.id, status: "read", sessionNumber: 1, isActive: false, completedDate: "2026-01-01" });
    expect((await call("queue_book", { bookId: done.id })).text).toMatch(/re-read/);

    expect((await call("queue_book", { bookId: 99999 })).text).toMatch(/no book/);
  });

  test("a read token can search and list but not add or queue", async () => {
    const { token } = await apiTokenService.create("agent", "read");
    const auth = { authorization: `Bearer ${token}` };
    const dune = await calibreBook("Dune", ["Frank Herbert"]);

    expect((await call("search_books", { query: "dune" }, auth)).isError).toBe(false);
    expect((await call("list_backlog", {}, auth)).isError).toBe(false);
    const add = await call("add_book", { title: "Nope" }, auth);
    expect(add.isError).toBe(true);
    expect(add.text).toMatch(/can only read/);
    expect((await call("queue_book", { bookId: dune.id, status: "read-next" }, auth)).isError).toBe(true);
    expect((await bookRepository.findWithFiltersAndRelations({ search: "Nope" }, 10, 0)).total).toBe(0);

    const { token: writer } = await apiTokenService.create("agent", "write");
    expect((await call("add_book", { title: "Yes" }, { authorization: `Bearer ${writer}` })).data.added).toBe(true);
  });

  test("an unknown tool is a JSON-RPC error", async () => {
    const { body } = await rpc("tools/call", { name: "delete_everything", arguments: {} });
    expect(body.error.code).toBe(-32602);
  });
});
