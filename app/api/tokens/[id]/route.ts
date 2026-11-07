import { NextRequest, NextResponse } from "next/server";
import { apiTokenService } from "@/lib/services/api-token.service";
import { getLogger } from "@/lib/logger";

const logger = getLogger();

export const dynamic = "force-dynamic";

/**
 * DELETE /api/tokens/:id
 * Revokes a token: anything using it is turned away from then on.
 */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_INPUT", message: "A token's id is a whole number." } },
      { status: 400 }
    );
  }
  try {
    if (!(await apiTokenService.revoke(id))) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "There's no API token with that id." } },
        { status: 404 }
      );
    }
    logger.info({ id }, "API token revoked");
    return NextResponse.json({ success: true });
  } catch (error) {
    const errorId = crypto.randomUUID();
    logger.error({ error, errorId }, "Failed to revoke API token");
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred", errorId } },
      { status: 500 }
    );
  }
}
