import { NextRequest, NextResponse } from "next/server";
import { getCase } from "@/lib/db";
import { reflagCatalogRows } from "@/lib/catalog-registry";

export const runtime = "nodejs";

/**
 * POST /api/cases/[id]/reflag-catalogs
 * Scans all rows and flags/unflags catalog pages based on URL patterns + learned registry.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: caseId } = await params;
  const caseData = await getCase(caseId);
  if (!caseData) return NextResponse.json({ error: "Case not found" }, { status: 404 });

  try {
    const result = await reflagCatalogRows(caseId);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
