import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import {
  getCase,
  appendDiscoveryRows,
  resolveEdenKey,
  resolveEdenRegion,
  getExistingDomains,
  resolveSearchKeys,
} from "@/lib/db";
import { discoverySearch, hitToSeedRow, normalizeDomain, type DiscoverySource } from "@/lib/discovery";
import { expandQueryForRegion, detectRegion, getCitiesForRegion } from "@/lib/regions";
import { mapsSearch, placeToSeedExtras } from "@/lib/maps";
import type { RowData } from "@/lib/types";

export const runtime = "nodejs";

interface AppendBody {
  mode: "search" | "maps" | "file";
  // search mode
  queries?: string[];
  source?: DiscoverySource;
  limit?: number;
  queryTemplate?: string;
  region?: string;
  // maps mode
  mapQuery?: string;        // e.g. "Heizungsbauer"
  location?: string;        // e.g. "Mecklenburg-Vorpommern" or "Rostock"
  mapLocations?: string[];  // multiple cities — runs one search per city
  // shared
  dedupeField?: "domain" | "name" | "none";
  dryRun?: boolean;
}

interface AppendResult {
  added: number;
  skipped: number;
  steps: StepResult[];
  preview?: RowData[];
}

interface StepResult {
  query: string;
  source: string;
  hits: number;
  added: number;
  skipped: number;
  latencyMs: number;
  error?: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: caseId } = await params;

  const caseData = await getCase(caseId);
  if (!caseData) return NextResponse.json({ error: "Case not found" }, { status: 404 });

  const body: AppendBody = await req.json();
  const { mode = "search", dedupeField = "domain", dryRun = false } = body;

  if (mode === "maps") {
    const mapQuery = body.mapQuery ?? "";
    if (!mapQuery.trim()) return NextResponse.json({ error: "mapQuery required for maps mode" }, { status: 400 });

    const searchKeys = await resolveSearchKeys();
    const serpApiKey = searchKeys.serpApiKey;
    const serperApiKey = searchKeys.serperApiKey;
    const apifyApiToken = searchKeys.apifyApiToken;
    const scraplingUrl = process.env.SCRAPLING_URL ?? "http://127.0.0.1:8001";
    const scraplingToken = process.env.SCRAPLING_TOKEN ?? "";

    // Build location list — either explicit list, single location, or region cities
    let locations: string[] = body.mapLocations ?? [];
    if (locations.length === 0 && body.location) locations = [body.location];
    if (locations.length === 0 && body.region) {
      locations = getCitiesForRegion(body.region);
    }
    if (locations.length === 0) locations = ["Deutschland"];

    const steps: StepResult[] = [];
    const allNewRows: RowData[] = [];
    let totalSkipped = 0;

    const existingDomains = dedupeField !== "none" ? await getExistingDomains(caseId) : [];
    const existingSet = new Set(existingDomains.map(d => d.toLowerCase()));

    for (const loc of locations) {
      const query = `${mapQuery} ${loc}`;
      const t0 = Date.now();
      const resp = await mapsSearch({
        query,
        provider: serpApiKey ? "maps-serpapi" : serperApiKey ? "maps-serper" : apifyApiToken ? "maps-apify" : "maps-scrapling",
        limit: body.limit ?? 200,  // default to maximum
        serpApiKey,
        serperApiKey,
        apifyApiToken,
        scraplingUrl,
        scraplingToken,
        excludeDomains: [...existingSet],
      });

      let stepAdded = 0, stepSkipped = 0;
      for (const hit of resp.hits) {
        if (hit.isDuplicate) { stepSkipped++; totalSkipped++; continue; }
        const place = resp.places[resp.hits.indexOf(hit)];
        const seedRow = hitToSeedRow(hit);
        // Merge in Maps-specific extras (rating, reviews, category, address)
        const extras = place ? placeToSeedExtras(place) : {};
        const rowData: RowData = {
          id: randomUUID(), caseId, rowIndex: 0,
          data: { ...seedRow, ...extras },
          cellStatuses: {}, cellErrors: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        allNewRows.push(rowData);
        if (hit.domain) existingSet.add(hit.domain.toLowerCase());
        stepAdded++;
      }

      steps.push({ query, source: resp.provider, hits: resp.hits.length, added: stepAdded, skipped: stepSkipped, latencyMs: Date.now() - t0, error: resp.error });
    }

    if (!dryRun && allNewRows.length > 0) {
      await appendDiscoveryRows(caseId, allNewRows);
    }

    return NextResponse.json({
      added: allNewRows.length, skipped: totalSkipped, steps,
      ...(dryRun ? { preview: allNewRows.slice(0, 10) } : {}),
    });
  }

  if (mode !== "search") {
    return NextResponse.json({ error: `mode '${mode}' not yet supported via this route` }, { status: 400 });
  }

  // ── Resolve queries ───────────────────────────────────────────────────────

  let queries: string[] = body.queries ?? [];

  // Region-based query expansion
  if (body.queryTemplate) {
    const regionKey = body.region ?? detectRegion(body.queryTemplate) ?? detectRegion(queries.join(" "));
    if (regionKey) {
      const expanded = expandQueryForRegion(body.queryTemplate, regionKey);
      queries = [...new Set([...queries, ...expanded])];
    } else {
      queries.push(body.queryTemplate.replace(/\{city\}/g, "").trim());
    }
  }

  if (queries.length === 0) {
    return NextResponse.json({ error: "No queries provided" }, { status: 400 });
  }

  // ── Resolve API keys ──────────────────────────────────────────────────────

  const edenKey = await resolveEdenKey(caseData);
  const sk2 = await resolveSearchKeys();
  const serpApiKey = sk2.serpApiKey;
  const serperApiKey2 = sk2.serperApiKey;
  const braveApiKey = sk2.braveApiKey;
  const scraplingUrl = process.env.SCRAPLING_URL ?? "http://127.0.0.1:8001";

  // ── Load existing domains for dedupe ─────────────────────────────────────

  const existingDomains = dedupeField !== "none" ? await getExistingDomains(caseId) : [];
  const existingSet = new Set(existingDomains.map((d) => d.toLowerCase()));

  // ── Run queries ───────────────────────────────────────────────────────────

  const steps: StepResult[] = [];
  const allNewRows: RowData[] = [];
  let totalSkipped = 0;

  const source = body.source ?? "auto";
  const limit = Math.min(body.limit ?? 30, 100);

  for (const query of queries) {
    const resp = await discoverySearch(query, {
      source,
      limit,
      excludeDomains: [...existingSet],
      serpApiKey,
      braveApiKey,
      serperApiKey: serperApiKey2,
      edenApiKey: edenKey ?? undefined,
      scraplingUrl,
    });

    const step: StepResult = {
      query,
      source: resp.source,
      hits: resp.hits.length,
      added: 0,
      skipped: 0,
      latencyMs: resp.latencyMs,
      error: resp.error,
    };

    for (const hit of resp.hits) {
      if (hit.isDuplicate) {
        step.skipped++;
        totalSkipped++;
        continue;
      }

      const seedRow = hitToSeedRow(hit);
      const rowData: RowData = {
        id: randomUUID(),
        caseId,
        rowIndex: 0, // appendDiscoveryRows recalculates
        data: seedRow,
        cellStatuses: {},
        cellErrors: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      allNewRows.push(rowData);
      step.added++;

      // Track in existingSet to dedupe across queries in same run
      if (hit.domain) existingSet.add(hit.domain.toLowerCase());
    }

    steps.push(step);
  }

  // ── Write to DB (unless dryRun) ───────────────────────────────────────────

  if (!dryRun && allNewRows.length > 0) {
    await appendDiscoveryRows(caseId, allNewRows);
  }

  const result: AppendResult = {
    added: allNewRows.length,
    skipped: totalSkipped,
    steps,
    ...(dryRun ? { preview: allNewRows.slice(0, 20) } : {}),
  };

  return NextResponse.json(result);
}
