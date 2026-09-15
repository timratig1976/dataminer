import { NextRequest, NextResponse } from "next/server";
import { getRow, getDb, initDb } from "@/lib/db";
import { learnCatalogDomains } from "@/lib/catalog-registry";
import { rows } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

export const runtime = "nodejs";

/**
 * POST /api/cases/[id]/flag-catalog
 * Flags a single row as catalog (is_catalog=true) and learns its domain.
 * Body: { rowId, flag: true|false }
 *   flag=true  → mark as catalog, learn domain
 *   flag=false → remove catalog flag (promote back to lead)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: caseId } = await params;
  const { rowId, flag = true } = await req.json().catch(() => ({}));

  if (!rowId) return NextResponse.json({ error: "rowId required" }, { status: 400 });

  const row = await getRow(rowId);
  if (!row || row.caseId !== caseId) {
    return NextResponse.json({ error: "Row not found" }, { status: 404 });
  }

  await initDb();
  const db = getDb();

  if (flag) {
    // Set is_catalog=true
    await db.execute(sql`
      UPDATE rows
      SET data = data || '{"is_catalog":"true"}'::jsonb,
          updated_at = NOW()
      WHERE id = ${rowId}
    `);

    // Learn the domain
    const data = row.data as Record<string, string | null>;
    const url = data["source_url"] ?? data["domain"] ?? data["source_domain"] ?? "";
    if (url) {
      try {
        let domain = url.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
        if (domain) await learnCatalogDomains([domain]);
      } catch { /* non-fatal */ }
    }
  } else {
    // Remove is_catalog flag
    await db.execute(sql`
      UPDATE rows
      SET data = data - 'is_catalog',
          updated_at = NOW()
      WHERE id = ${rowId}
    `);
  }

  return NextResponse.json({ ok: true, flag });
}
