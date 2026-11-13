import { NextRequest, NextResponse } from "next/server";
import { handleMessage, sameSite } from "@/lib/mcp/server";
import { apiTokenService } from "@/lib/services/api-token.service";
import type { TokenAccess } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/mcp — Tome's MCP server (Streamable HTTP, JSON responses, no sessions). Point an MCP client here with an
 * API token as `Authorization: Bearer <token>`. The proxy has already checked who's asking; a read token gets here too,
 * and can only use the tools that read.
 */
export async function POST(request: NextRequest) {
  // Pages on other sites can't drive the server through someone's browser (DNS rebinding included).
  const { headers } = request;
  if (!sameSite(headers.get("origin"), headers.get("host"), headers.get("x-forwarded-host"))) {
    return NextResponse.json({ error: "Requests from other sites aren't allowed." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "The body isn't JSON." } }, { status: 400 });
  }

  const access = await accessOf(request);
  if (Array.isArray(body)) {
    const answers = (await Promise.all(body.map((m) => handleMessage(m, access)))).filter((a) => a !== null);
    return answers.length ? NextResponse.json(answers) : new NextResponse(null, { status: 202 });
  }
  const answer = await handleMessage(body as never, access);
  return answer ? NextResponse.json(answer) : new NextResponse(null, { status: 202 });
}

/** No server-sent events: everything comes back in the POST's answer. */
export async function GET() {
  return NextResponse.json({ error: "Tome's MCP server answers POSTs only." }, { status: 405, headers: { allow: "POST" } });
}

export const DELETE = GET;

/** What the caller may do: a read token reads; a signed-in person, a write token, or anyone when sign-in is off, writes. */
async function accessOf(request: NextRequest): Promise<TokenAccess> {
  const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization")?.trim() ?? "")?.[1];
  if (!bearer) return "write";
  return (await apiTokenService.verify(bearer)) === "read" ? "read" : "write";
}
