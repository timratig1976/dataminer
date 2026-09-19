import { NextRequest, NextResponse } from "next/server";
import { listRows, upsertRow, deleteRowsBulk, getScrapeCacheMap } from "@/lib/db";
import { randomUUID } from "crypto";
import type { RowData } from "@/lib/types";

export async function GET(req: NextRequest) {
  const caseId = req.nextUrl.searchParams.get("caseId");
  if (!caseId) return NextResponse.json({ error: "caseId required" }, { status: 400 });

  const rows = await listRows(caseId);
  const domains = rows.map(r => r.data["domain"] ?? r.data["source_domain"]).filter(Boolean) as string[];
  const cacheMap = await getScrapeCacheMap(domains).catch(() => new Map());

  // Attach cache info to each row's data so the UI can display it immediately
  const enrichedRows = rows.map(r => {
    const domain = r.data["domain"] ?? r.data["source_domain"] ?? "";
    const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
    
    // Check if cache map has this domain
    let matchedFetchAt: string | undefined;
    if (cleanDomain) {
      for (const [url, item] of cacheMap.entries()) {
        const uLower = url.toLowerCase();
        if (uLower.includes(cleanDomain)) {
          matchedFetchAt = item.fetchedAt;
          break;
        }
      }
    }

    const rowCacheTs = r.data["_scrape_cached_ts"];
    const effectiveTs = matchedFetchAt || rowCacheTs || (r.data["_scrape_cached"] === "true" ? r.updatedAt : undefined);

    if (effectiveTs && !r.data["_scrape_cached_ts"]) {
      return {
        ...r,
        data: {
          ...r.data,
          _scrape_cached: "true",
          _scrape_cached_ts: effectiveTs,
        }
      };
    }
    return r;
  });

  return NextResponse.json(enrichedRows);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const row: RowData = {
    id: body.id || randomUUID(),
    caseId: body.caseId,
    rowIndex: body.rowIndex ?? 0,
    data: body.data || {},
    cellStatuses: {},
    cellErrors: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return NextResponse.json(await upsertRow(row), { status: 201 });
}

/** DELETE /api/rows — bulk delete rows + cascade contact_rows */
export async function DELETE(req: NextRequest) {
  const body = await req.json();
  const ids: string[] = body.ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids (non-empty array) required" }, { status: 400 });
  }
  const result = await deleteRowsBulk(ids);
  return NextResponse.json({ ok: true, ...result });
}
