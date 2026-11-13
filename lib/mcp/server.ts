import type { TokenAccess } from "@/lib/auth";
import { backlogService, BacklogError, ManualBookError } from "@/lib/services/backlog.service";
import { lookupIsbn } from "@/lib/services/isbn-lookup.service";
import { getLogger } from "@/lib/logger";

/**
 * Tome's MCP server: the backlog tools, spoken over JSON-RPC as the Model Context Protocol's Streamable HTTP transport
 * describes, without sessions or streaming (every answer is a single JSON response). Tools that change anything need
 * write access; a read API token can search and list.
 */

export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
const SERVER_INFO = { name: "tome", title: "Tome", version: process.env.npm_package_version || "0.7.0" };

const INSTRUCTIONS =
  "Tome tracks the books a person reads. Use these tools to manage their backlog: books waiting to be read, either " +
  '"to-read" (the pile) or "read-next" (the ordered queue of what is next). Before adding a book, search_books to see ' +
  "whether Tome already has it (Calibre books are in Tome already); if it does, queue_book it instead of adding a copy. " +
  "lookup_isbn fills in a book's details from Open Library.";

type Json = Record<string, unknown>;

interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Json;
  write: boolean;
  run(args: Json): Promise<unknown>;
}

const status = {
  type: "string",
  enum: ["to-read", "read-next"],
  description: '"to-read" puts the book on the pile; "read-next" puts it at the end of the read-next queue.',
};

const TOOLS: Tool[] = [
  {
    name: "search_books",
    title: "Search books",
    description:
      "Finds books already in Tome, from Calibre or added by hand, by title, author or ISBN. Shows each book's id and reading status.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Part of a title or an author's name, or an ISBN." },
        limit: { type: "integer", minimum: 1, maximum: 50, description: "How many books at most (default 10)." },
      },
      required: ["query"],
    },
    write: false,
    run: async (a) => ({ books: await backlogService.search(a.query, a.limit) }),
  },
  {
    name: "list_backlog",
    title: "List the backlog",
    description: "Lists the backlog: the read-next queue in order, then the to-read pile, newest first.",
    inputSchema: {
      type: "object",
      properties: {
        status: { ...status, description: "Only this part of the backlog. Leave out for both." },
        limit: { type: "integer", minimum: 1, maximum: 200, description: "How many books at most (default 50)." },
      },
    },
    write: false,
    run: async (a) => ({ books: await backlogService.list(a.status, a.limit) }),
  },
  {
    name: "lookup_isbn",
    title: "Look up an ISBN",
    description:
      "Gets a book's details (title, authors, pages, publisher, date, description, cover URL) from Open Library by ISBN, ready to pass to add_book. Adds nothing.",
    inputSchema: {
      type: "object",
      properties: { isbn: { type: "string", description: "A 10- or 13-digit ISBN; hyphens are fine." } },
      required: ["isbn"],
    },
    write: false,
    run: async (a) => lookupIsbn(a.isbn),
  },
  {
    name: "add_book",
    title: "Add a book to the backlog",
    description:
      "Adds a book that isn't in Tome yet to the backlog. If Tome already has a book with the same ISBN, or the same title by the same author, nothing is added and the matches are returned instead.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        authors: { type: "array", items: { type: "string" } },
        totalPages: { type: "integer", minimum: 1, description: "Tome needs it before the book can be started." },
        isbn: { type: "string" },
        publisher: { type: "string" },
        pubDate: { type: "string", description: "YYYY, YYYY-MM or YYYY-MM-DD." },
        series: { type: "string" },
        seriesIndex: { type: "number" },
        description: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        coverUrl: { type: "string", description: "An image URL to use as the cover, like lookup_isbn's coverUrl." },
        status: { ...status, description: `${status.description} Default "to-read".` },
        allowDuplicate: { type: "boolean", description: "Add it even if Tome seems to have it already." },
      },
      required: ["title"],
    },
    write: true,
    run: (a) => backlogService.add(a),
  },
  {
    name: "queue_book",
    title: "Queue a book",
    description:
      'Puts a book Tome already has into the backlog, or moves it between "to-read" and "read-next". Books being read, finished or dropped are left alone.',
    inputSchema: {
      type: "object",
      properties: {
        bookId: { type: "integer", description: "The book's id, from search_books." },
        status: { ...status, description: `${status.description} Default "to-read".` },
      },
      required: ["bookId"],
    },
    write: true,
    run: async (a) => ({ book: await backlogService.queue(a.bookId, a.status) }),
  },
];

/** A JSON-RPC message, as far as this server reads one. */
interface Message {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

const result = (id: unknown, value: unknown) => ({ jsonrpc: "2.0", id, result: value });
const failure = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

const toolResult = (value: unknown, isError = false) => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
  ...(isError ? { isError: true } : { structuredContent: value as Json }),
});

async function callTool(params: Json, access: TokenAccess) {
  const tool = TOOLS.find((t) => t.name === params.name);
  if (!tool) return { error: [-32602, `There's no tool called "${String(params.name)}".`] as const };
  if (tool.write && access !== "write") {
    return { value: toolResult(`${tool.name} changes Tome, and this API token can only read. Use a token with write access.`, true) };
  }
  const args = params.arguments && typeof params.arguments === "object" ? (params.arguments as Json) : {};
  try {
    return { value: toolResult(await tool.run(args)) };
  } catch (error) {
    if (error instanceof BacklogError || error instanceof ManualBookError) return { value: toolResult(error.message, true) };
    getLogger().error({ err: error, tool: tool.name }, "MCP tool failed");
    return { value: toolResult(`${tool.name} failed. Tome's log says why.`, true) };
  }
}

/** The answer to one JSON-RPC message, or null for a notification (which gets none). */
export async function handleMessage(message: Message, access: TokenAccess): Promise<Json | null> {
  if (!message || typeof message !== "object" || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return failure(message?.id, -32600, "Not a JSON-RPC 2.0 request.");
  }
  const isNotification = !("id" in message) || message.id === undefined;
  if (isNotification) return null;
  const { id } = message;
  const params = (message.params && typeof message.params === "object" ? message.params : {}) as Json;

  switch (message.method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      return result(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return result(id, {});
    case "tools/list":
      return result(id, {
        tools: TOOLS.map(({ name, title, description, inputSchema, write }) => ({
          name,
          title,
          description,
          inputSchema,
          annotations: { readOnlyHint: !write, destructiveHint: false, idempotentHint: name === "queue_book" || !write, openWorldHint: name === "lookup_isbn" },
        })),
      });
    case "tools/call": {
      const called = await callTool(params, access);
      return "error" in called && called.error ? failure(id, called.error[0], called.error[1]) : result(id, called.value);
    }
    default:
      return failure(id, -32601, `Tome's MCP server doesn't do "${message.method}".`);
  }
}

/**
 * Whether a request may come from where it says: no Origin (not a browser) or an Origin on this host. Browsers send
 * Origin on cross-site POSTs, so a page elsewhere can't use a signed-in person's cookie, or a rebound DNS name, to
 * reach the server.
 */
export function sameSite(origin: string | null, host: string | null, forwardedHost: string | null = null): boolean {
  if (!origin) return true;
  try {
    const { host: from } = new URL(origin);
    return from === host || from === forwardedHost;
  } catch {
    return false;
  }
}

export const TOOL_NAMES = TOOLS.map((t) => t.name);
