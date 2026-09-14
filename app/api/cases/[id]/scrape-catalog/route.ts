import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getCase, resolveEdenKey, appendDiscoveryRows, getExistingDomains } from "@/lib/db";
import { scrapeCatalog } from "@/lib/catalog-scraper";
import { normalizeDomain } from "@/lib/discovery";
import type { RowData } from "@/lib/types";

export const runtime = "nodejs";

/**
 * POST /api/cases/[id]/scrape-catalog
 *
 * Scrapes a catalog/directory page and adds all found companies as new rows.
 *
 * Body: { url, extractionPrompt?, maxPages?, dryRun? }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: caseId } = await params;

  const caseData = await getCase(caseId);
  if (!caseData) return NextResponse.json({ error: "Case not found" }, { status: 404 });

  const { url, extractionPrompt, maxPages = 5, dryRun = false } = await req.json();
  if (!url?.trim()) return NextResponse.json({ error: "url required" }, { status: 400 });

  const edenApiKey = await resolveEdenKey(caseData);
  if (!edenApiKey) return NextResponse.json({ error: "No Eden API key configured" }, { status: 400 });

  // Scrape the catalog
  const result = await scrapeCatalog({
    url,
    extractionPrompt: extractionPrompt ?? "",
    followPagination: true,
    maxPages,
    edenApiKey,
  });

  if (result.entries.length === 0) {
    return NextResponse.json({
      added: 0,
      skipped: 0,
      pagesScraped: result.pagesScraped,
      errors: result.errors,
      message: "No entries found on this catalog page",
    });
  }

  // Dedupe against existing rows
  const existingDomains = await getExistingDomains(caseId);
  const existingSet = new Set(existingDomains.map(d => d.toLowerCase()));

  const toInsert: RowData[] = [];
  let skipped = 0;

  for (const entry of result.entries) {
    const domain = entry.domain;
    if (domain && existingSet.has(domain.toLowerCase())) {
      skipped++;
      continue;
    }
    if (domain) existingSet.add(domain.toLowerCase());

    toInsert.push({
      id: randomUUID(),
      caseId,
      rowIndex: 0,
      data: {
        company_name: entry.company_name ?? "",
        domain: entry.domain ?? "",
        source_url: url,
        source_domain: domain ?? "",
        source_title: entry.company_name ?? "",
        source_snippet: entry.description ?? "",
        search_query: `catalog:${new URL(url).hostname}`,
        search_source: "catalog_scrape",
        is_catalog: "",
        // Direct fields from catalog
        phone: entry.phone ?? "",
        email: entry.email ?? "",
        address: entry.address ?? "",
        city: entry.city ?? "",
        zip: entry.zip ?? "",
      },
      cellStatuses: {},
      cellErrors: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  if (!dryRun && toInsert.length > 0) {
    await appendDiscoveryRows(caseId, toInsert);
  }

  return NextResponse.json({
    added: toInsert.length,
    skipped,
    pagesScraped: result.pagesScraped,
    errors: result.errors,
    preview: dryRun ? toInsert.slice(0, 5).map(r => r.data) : undefined,
  });
}
