import { NextRequest, NextResponse } from "next/server";
import { getDb, initDb } from "@/lib/db";
import { rows } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

/**
 * POST /api/cases/[id]/dedupe
 *
 * Finds and removes duplicate rows within a case.
 * Keeps the row with the most filled data fields.
 * Deduplicates by: domain > source_domain > company_name
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: caseId } = await params;
  await initDb();
  const db = getDb();

  const allRows = await db.select().from(rows).where(eq(rows.caseId, caseId));

  // Group by domain key — but contact rows (with _parent_row_id) are NEVER the "keep" candidate
  const groups = new Map<string, typeof allRows>();
  for (const row of allRows) {
    const data = row.data as Record<string, string | null>;
    const isContact = !!data["_parent_row_id"];
    if (isContact) continue; // contact sub-rows are handled separately, skip from dedup
    const key = (data["domain"] ?? data["source_domain"] ?? data["company_name"] ?? row.id).toLowerCase().trim();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  const toDelete: string[] = [];
  for (const [, group] of groups) {
    if (group.length <= 1) continue;

    // Sort: non-contact rows first, then by number of filled fields (desc)
    group.sort((a, b) => {
      const aData = a.data as Record<string, string | null>;
      const bData = b.data as Record<string, string | null>;
      const aIsContact = !!aData["_parent_row_id"];
      const bIsContact = !!bData["_parent_row_id"];
      if (aIsContact !== bIsContact) return aIsContact ? 1 : -1;
      const aFilled = Object.values(aData).filter(v => v && !String(v).startsWith("_")).length;
      const bFilled = Object.values(bData).filter(v => v && !String(v).startsWith("_")).length;
      return bFilled - aFilled;
    });

    // Keep first, delete rest
    toDelete.push(...group.slice(1).map(r => r.id));
  }

  if (toDelete.length === 0) {
    return NextResponse.json({ removed: 0, message: "No duplicates found" });
  }

  // Delete in batches
  for (const id of toDelete) {
    await db.delete(rows).where(eq(rows.id, id));
  }

  return NextResponse.json({
    removed: toDelete.length,
    remaining: allRows.length - toDelete.length,
    message: `Removed ${toDelete.length} duplicate rows`,
  });
}
