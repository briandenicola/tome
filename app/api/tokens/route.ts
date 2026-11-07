import { NextRequest, NextResponse } from "next/server";
import { apiTokenService, TokenInputError } from "@/lib/services/api-token.service";
import { getLogger } from "@/lib/logger";

const logger = getLogger();

export const dynamic = "force-dynamic";

const internalError = (error: unknown, what: string) => {
  const errorId = crypto.randomUUID();
  logger.error({ error, errorId }, what);
  return NextResponse.json(
    { success: false, error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred", errorId } },
    { status: 500 }
  );
};

/**
 * GET /api/tokens
 * Every API token, newest first: name, access, hint (last four characters), when made and last used. Never the
 * token itself. Signed-in people only; the proxy turns API tokens away.
 */
export async function GET() {
  try {
    return NextResponse.json({ success: true, data: await apiTokenService.list() });
  } catch (error) {
    return internalError(error, "Failed to list API tokens");
  }
}

/**
 * POST /api/tokens  { name, access: "read" | "write" }
 * Makes a token. The answer holds the token itself, this once: it can't be shown again.
 */
export async function POST(request: NextRequest) {
  let body: { name?: unknown; access?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_INPUT", message: "Send JSON: { name, access }." } },
      { status: 400 }
    );
  }
  try {
    const created = await apiTokenService.create(
      typeof body.name === "string" ? body.name : "",
      body.access as "read" | "write"
    );
    logger.info({ id: created.apiToken.id, access: created.apiToken.access }, "API token created");
    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (error) {
    if (error instanceof TokenInputError) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_INPUT", message: error.message } },
        { status: 400 }
      );
    }
    return internalError(error, "Failed to create API token");
  }
}
