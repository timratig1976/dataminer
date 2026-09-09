import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import {
  getCase,
  appendDiscoveryRows,
  appendLog,
  getEffectiveApiKey,
  setCachedScrape,
} from "@/lib/db";
import { inferProviderFromModel } from "@/lib/ai";
import { edenChatCompletion, edenScrapeUrl } from "@/lib/edenai";
import { discoverySearch } from "@/lib/discovery";
import { hitToSeedRow, type DiscoveryHit, type DiscoverySource } from "@/lib/discovery";
import { placeToSeedExtras, type MapsPlace } from "@/lib/maps";
import type { RowData } from "@/lib/types";
import OpenAI from "openai";

const VALID_DISCOVERY_SOURCES = new Set<DiscoverySource>([
  "auto", "firecrawl", "serpapi", "brave", "duckduckgo", "scrapling",
]);

function parseDiscoverySource(raw: unknown): DiscoverySource {
  return typeof raw === "string" && VALID_DISCOVERY_SOURCES.has(raw as DiscoverySource)
    ? (raw as DiscoverySource)
    : "auto";
}

interface DiscoverBody {
  hits?: DiscoveryHit[];
  places?: MapsPlace[];
  extractNames?: boolean;
  extractModel?: string;
  scrapePages?: boolean;
  scrapeMax?: number;
  extendQueries?: { queries: string[]; source?: string; limit?: number };
}

/**
 * POST /api/cases/[id]/discover
 * Appends discovery seed rows to a case table.
 *
 * Body:
 *   hits:        DiscoveryHit[]        — accepted web-search hits
 *   places?:     MapsPlace[]           — accepted maps results (adds structured extras)
 *   extractNames?: boolean             — batch LLM extraction of company_name from title/snippet
 *   extractModel?: string              — model for extraction (default gpt-4o-mini)
 *   scrapePages?: boolean              — pre-fill scrape_cache with top pages (uses Eden/Firecrawl)
 *   scrapeMax?: number                 — max pages to scrape (default 10)
 *   extendQueries?: { queries: string[], source?: string, limit?: number }
 *                                      — server-side batch discovery ("extend existing" mode)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: caseId } = await params;

  let body: DiscoverBody;
  try {
    body = (await req.json()) as DiscoverBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const caseData = getCase(caseId);
  if (!caseData) return NextResponse.json({ error: "Case not found" }, { status: 404 });

  const hits: DiscoveryHit[] = Array.isArray(body?.hits) ? body.hits : [];
  const places: MapsPlace[] = Array.isArray(body?.places) ? body.places : [];
  const extractNames = body?.extractNames === true;
  const scrapePages = body?.scrapePages === true;
  const scrapeMax = Math.max(0, Math.min(Number(body?.scrapeMax ?? 10), 30));

  // ── Extend mode: run queued queries server-side, merge hits ──
  const extendErrors: string[] = [];
  if (body?.extendQueries && Array.isArray(body.extendQueries.queries) && body.extendQueries.queries.length > 0) {
    const seenUrls = new Set(hits.map((h) => h.url));
    for (const q of body.extendQueries.queries.slice(0, 100)) {
      try {
        const resp = await discoverySearch(String(q), {
          source: parseDiscoverySource(body.extendQueries.source),
          limit: Number(body.extendQueries.limit ?? 30),
          serpApiKey: process.env.SERP_API_KEY?.trim() || undefined,
          braveApiKey: process.env.BRAVE_API_KEY?.trim() || undefined,
          scraplingUrl: process.env.SCRAPLING_URL?.trim() || undefined,
          scraplingToken: process.env.SCRAPLING_TOKEN?.trim() || undefined,
          edenApiKey: caseData.edenApiKey || process.env.EDEN_API_KEY?.trim() || undefined,
        });
        for (const h of resp.hits) {
          if (!seenUrls.has(h.url)) {
            seenUrls.add(h.url);
            hits.push(h);
          }
        }
      } catch (e) {
        extendErrors.push(`${q}: ${(e as Error).message}`);
      }
    }
  }

  if (hits.length === 0 && places.length === 0) {
    return NextResponse.json({ error: "No hits or places to import" }, { status: 400 });
  }

  // Merge maps places into hits-shaped seeds (places carry structured extras)
  const placeByUrl = new Map(places.map((p) => [p.website || p.mapsUrl, p]));
  const seeds: { data: Record<string, string> }[] = hits.map((h) => {
    const seed = hitToSeedRow(h);
    const place = placeByUrl.get(h.url);
    const extras = place ? placeToSeedExtras(place) : {};
    const data: Record<string, string> = {
      ...seed,
      // maps results: company_name is authoritative from the place title
      ...(place ? { company_name: place.name } : {}),
      ...extras,
    };
    return { data };
  });
  // Maps places not represented in hits (e.g. no website → mapsUrl canonical)
  const seedUrls = new Set(hits.map((h) => h.url));
  for (const p of places) {
    const url = p.website || p.mapsUrl;
    if (!url || seedUrls.has(url)) continue;
    seeds.push({
      data: {
        company_name: p.name,
        source_url: url,
        source_title: p.name,
        source_snippet: [p.category, p.address].filter(Boolean).join(" · "),
        source_domain: p.website ? p.website.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase() : "",
        search_query: p.name,
        search_source: "google-maps",
        ...placeToSeedExtras(p),
      },
    });
  }

  // ── Optional: batch LLM extraction of company names from titles/snippets ──
  let extractedNames = 0;
  if (extractNames && seeds.length > 0) {
    try {
      const names = await extractCompanyNames(
        seeds.map((s) => ({ title: s.data.source_title || s.data.company_name || "", snippet: s.data.source_snippet || "" })),
        caseId,
        typeof body?.extractModel === "string" ? body.extractModel : "gpt-4o-mini"
      );
      names.forEach((name, i) => {
        if (name && seeds[i] && (!seeds[i].data.company_name || seeds[i].data.company_name === seeds[i].data.source_title)) {
          seeds[i].data.company_name = name;
          extractedNames++;
        }
      });
    } catch (e) {
      extendErrors.push(`name extraction: ${(e as Error).message}`);
    }
  }

  // ── Persist rows (dedupe by domain server-side) ──
  const rowData: RowData[] = seeds.map((s) => ({
    id: randomUUID(),
    caseId,
    rowIndex: 0, // appendDiscoveryRows assigns the real index
    data: s.data,
    cellStatuses: {},
    cellErrors: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));

  const { inserted, duplicates } = appendDiscoveryRows(caseId, rowData);
  appendLog(caseId, `Discovery: ${inserted} leads added (${duplicates} duplicates skipped)${extractedNames ? `, ${extractedNames} names extracted` : ""}`);

  // ── Optional: pre-fill scrape cache with top pages (Firecrawl) ──
  let scraped = 0;
  if (scrapePages && inserted > 0) {
    const edenKey = caseData.edenApiKey || process.env.EDEN_API_KEY?.trim() || "";
    if (edenKey) {
      const targets = seeds
        .map((s) => s.data.source_url)
        .filter((u) => u && u.startsWith("http"))
        .slice(0, scrapeMax);
      for (const url of targets) {
        try {
          const { markdown, title } = await edenScrapeUrl({ apiKey: edenKey, url });
          if (markdown && markdown.trim()) {
            setCachedScrape(url, markdown, title);
            scraped++;
          }
        } catch { /* keep going — cache pre-fill is best-effort */ }
      }
      if (scraped > 0) appendLog(caseId, `Discovery: pre-scraped ${scraped} page(s) into cache`);
    } else {
      extendErrors.push("scrapePages requested but no Eden AI key configured");
    }
  }

  return NextResponse.json({ inserted, duplicates, extractedNames, scraped, errors: extendErrors });
}

// ── Batch company-name extraction ────────────────────────────────────────────

async function extractCompanyNames(
  items: { title: string; snippet: string }[],
  caseId: string,
  model: string
): Promise<string[]> {
  const caseData = getCase(caseId);
  const provider = inferProviderFromModel(model);
  const apiKey = caseData ? getEffectiveApiKey(caseData, provider) : undefined;
  if (!apiKey) throw new Error(`No API key for provider ${provider}`);

  // Chunk to keep prompts small (50 items ≈ one call)
  const CHUNK = 50;
  const names: string[] = [];
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    const list = chunk
      .map((it, j) => `[${j + 1}] ${it.title}\n${it.snippet.slice(0, 200)}`)
      .join("\n");
    const system =
      "You extract company names from search result snippets. Return ONLY a JSON array of strings, same length and order as the input list. Use the official company name (keep legal form like GmbH). If no company name can be determined for an item, return an empty string for that item.";
    const prompt = `Extract the company name for each numbered item:\n\n${list}\n\nReturn JSON: ["name1", "name2", ...]`;

    let raw = "";
    if (provider === "edenai") {
      const r = await edenChatCompletion({ apiKey, model, system, prompt, maxTokens: 2048 });
      raw = r.raw;
    } else {
      const client = new OpenAI({
        apiKey,
        baseURL: provider === "cerebras" ? "https://api.cerebras.ai/v1" : undefined,
        timeout: 60000,
      });
      const r = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        max_tokens: 2048,
        temperature: 0,
      });
      raw = r.choices[0]?.message?.content?.trim() ?? "";
    }

    // Parse the JSON array (tolerate markdown fences)
    const cleaned = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const m = cleaned.match(/\[[\s\S]*\]/);
      parsed = m ? JSON.parse(m[0]) : [];
    }
    const arr = Array.isArray(parsed) ? parsed : [];
    for (let j = 0; j < chunk.length; j++) {
      const v = arr[j];
      names.push(typeof v === "string" ? v.trim() : "");
    }
  }
  return names;
}
