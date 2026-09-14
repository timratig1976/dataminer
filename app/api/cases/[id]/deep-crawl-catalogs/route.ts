import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getCase, listRows, appendDiscoveryRows, getExistingDomains, resolveEdenKey, appendLog } from "@/lib/db";
import { scrapeCatalog } from "@/lib/catalog-scraper";
import { normalizeDomain } from "@/lib/discovery";
import type { RowData } from "@/lib/types";

export const runtime = "nodejs";

/**
 * POST /api/cases/[id]/deep-crawl-catalogs
 *
 * Finds all rows with is_catalog=true, scrapes each catalog page,
 * and appends found companies as new rows.
 *
 * Body: { maxPagesPerCatalog?, dryRun?, maxCatalogs? }
 * Returns: SSE stream with progress events
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: caseId } = await params;
  const caseData = await getCase(caseId);
  if (!caseData) return new Response(JSON.stringify({ error: "Case not found" }), { status: 404 });

  const { maxPagesPerCatalog = 5, dryRun = false, maxCatalogs = 20 } = await req.json().catch(() => ({}));

  const edenApiKey = await resolveEdenKey(caseData);
  if (!edenApiKey) return new Response(JSON.stringify({ error: "No Eden API key" }), { status: 400 });

  const stream = new ReadableStream({
    async start(controller) {
      const push = (data: unknown) => {
        try { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)); }
        catch { /* closed */ }
      };

      try {
        // Find all catalog rows
        const allRows = await listRows(caseId);
        const catalogRows = allRows
          .filter(r => {
            const d = r.data as Record<string, string | null>;
            return d["is_catalog"] === "true" && d["source_url"];
          })
          .slice(0, maxCatalogs);

        push({ type: "start", total: catalogRows.length, message: `${catalogRows.length} Katalog-Seiten gefunden` });
        await appendLog(caseId, `🔗 DEEP CRAWL START: ${catalogRows.length} Katalog-Seiten werden gescraped`);

        const existingDomains = await getExistingDomains(caseId);
        const existingSet = new Set(existingDomains.map(d => d.toLowerCase()));

        let totalAdded = 0;
        let totalSkipped = 0;

        for (let i = 0; i < catalogRows.length; i++) {
          const catalogRow = catalogRows[i];
          const d = catalogRow.data as Record<string, string | null>;
          const url = d["source_url"] ?? "";
          const name = d["company_name"] ?? url;

          push({ type: "catalog_start", index: i + 1, total: catalogRows.length, url, name });

          try {
            const result = await scrapeCatalog({
              url,
              extractionPrompt: "Firmen, Unternehmen, Betriebe — Name, Adresse, Telefon, Website",
              followPagination: true,
              maxPages: maxPagesPerCatalog,
              edenApiKey,
              onProgress: (page, found) => {
                push({ type: "page_progress", url, page, found });
              },
            });

            // Dedupe and collect
            const newRows: RowData[] = [];
            let added = 0, skipped = 0;

            for (const entry of result.entries) {
              const domain = entry.domain ?? "";
              if (domain && existingSet.has(domain.toLowerCase())) { skipped++; continue; }
              if (domain) existingSet.add(domain.toLowerCase());

              newRows.push({
                id: randomUUID(), caseId, rowIndex: 0,
                data: {
                  company_name: entry.company_name ?? "",
                  domain: domain,
                  source_url: url,
                  source_domain: domain,
                  source_title: entry.company_name ?? "",
                  source_snippet: entry.description ?? "",
                  search_query: `catalog:${new URL(url).hostname}`,
                  search_source: "catalog_scrape",
                  is_catalog: "",
                  phone: entry.phone ?? "",
                  email: entry.email ?? "",
                  address: entry.address ?? "",
                  city: entry.city ?? "",
                  zip: entry.zip ?? "",
                },
                cellStatuses: {}, cellErrors: {},
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              });
              added++;
            }

            if (!dryRun && newRows.length > 0) {
              await appendDiscoveryRows(caseId, newRows);
            }

            totalAdded += added;
            totalSkipped += skipped;

            await appendLog(caseId, `  📋 [${new URL(url).hostname}] ${added} neue Firmen, ${skipped} Duplikate (${result.pagesScraped} Seiten)`);
            push({ type: "catalog_done", url, name, added, skipped, pages: result.pagesScraped, errors: result.errors });

          } catch (e) {
            const msg = (e as Error).message;
            push({ type: "catalog_error", url, name, error: msg });
            await appendLog(caseId, `  ❌ [${new URL(url).hostname}] Fehler: ${msg}`);
          }
        }

        await appendLog(caseId, `🏁 DEEP CRAWL DONE: ${totalAdded} neue Firmen, ${totalSkipped} Duplikate`);
        push({ type: "done", totalAdded, totalSkipped, catalogs: catalogRows.length });

      } catch (e) {
        push({ type: "error", message: (e as Error).message });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
