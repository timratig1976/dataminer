import { NextRequest, NextResponse } from "next/server";
import { extrapolateAndVerifyAll } from "@/lib/email-extrapolator";
import { getRow, upsertRow } from "@/lib/db";
import { eq } from "drizzle-orm";

/**
 * POST /api/verify-email-all
 * Body: { firstName, lastName, domain, rowId?, fieldPrefix? }
 *
 * Generates all email pattern candidates, SMTP-verifies all in parallel,
 * and optionally writes the best verified email back to the row.
 *
 * Returns: { candidates, bestEmail, bestPattern, catchAll, verified }
 */
export async function POST(req: NextRequest) {
  try {
    const { firstName, lastName, domain, rowId, fieldPrefix = "contact_1" } = await req.json();

    if (!firstName || !lastName || !domain) {
      return NextResponse.json({ error: "firstName, lastName, domain required" }, { status: 400 });
    }

    const result = await extrapolateAndVerifyAll(firstName, lastName, domain);

    // Optionally write best email back to the row
    if (rowId && result.bestEmail) {
      const row = await getRow(rowId);
      if (row) {
        const data = (row.data as Record<string, string | null>) ?? {};
        const statuses = (row.cellStatuses as Record<string, string>) ?? {};
        const emailField = `${fieldPrefix}_email_verified`;
        const patternField = `${fieldPrefix}_email_pattern`;

        data[emailField] = result.bestEmail;
        data[patternField] = result.bestPattern ?? "";
        if (result.verified) {
          // Also write to the primary extrapolated field so it shows in the table
          data[`${fieldPrefix}_email_extrapolated`] = result.bestEmail;
          statuses[`${fieldPrefix}_email_verified`] = "done";
        }

        row.data = data;
        row.cellStatuses = statuses as Record<string, import("@/lib/types").CellStatus>;
        await upsertRow(row);
      }
    }

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
