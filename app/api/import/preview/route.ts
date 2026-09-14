import { NextRequest, NextResponse } from "next/server";
import { parseUploadedFile } from "@/lib/import-parser";
import { autoDetectMapping } from "@/lib/row-normalizer";
import { getCase, getExistingDomains } from "@/lib/db";
import { normalizeDomain } from "@/lib/discovery";

export const runtime = "nodejs";

/**
 * POST /api/import/preview
 * Accepts multipart/form-data: { file, caseId? }
 * Returns: parsed headers, auto field mapping, preview rows, duplicate count.
 */
export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const caseId = formData.get("caseId") as string | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const parsed = await parseUploadedFile(file);
  if (parsed.error) {
    return NextResponse.json({ error: parsed.error }, { status: 422 });
  }

  // Auto-detect field mapping
  const mapping = autoDetectMapping(parsed.headers);

  // Count potential duplicates (domain-based) if caseId given
  let duplicateCount = 0;
  if (caseId) {
    const caseData = await getCase(caseId).catch(() => null);
    if (caseData) {
      const existingDomains = await getExistingDomains(caseId);
      const existingSet = new Set(existingDomains.map((d) => d.toLowerCase()));

      // Find the domain column in mapping
      const domainOrigKey = Object.entries(mapping).find(
        ([, m]) => m.canonicalKey === "domain"
      )?.[0];

      if (domainOrigKey) {
        for (const row of parsed.rows) {
          const rawDomain = row[domainOrigKey];
          if (!rawDomain) continue;
          // Try parsing as URL first, then as bare domain
          const normalized =
            rawDomain.includes("://")
              ? normalizeDomain(rawDomain)
              : rawDomain.toLowerCase().replace(/^www\./, "").trim();
          if (normalized && existingSet.has(normalized)) duplicateCount++;
        }
      }
    }
  }

  return NextResponse.json({
    format: parsed.format,
    rowCount: parsed.rowCount,
    headers: parsed.headers,
    mapping: Object.fromEntries(
      Object.entries(mapping).map(([k, v]) => [k, v])
    ),
    previewRows: parsed.rows.slice(0, 5),
    duplicateCount,
  });
}
