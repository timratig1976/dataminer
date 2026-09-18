import { NextRequest } from "next/server";
import { getCase, listRows, resolveSearchKeys, resolveEdenKey, getDb, initDb, appendLog } from "@/lib/db";
import { webSearch } from "@/lib/search";
import { scrapeCompanyProfile, WEBSITE_BLOCKLIST } from "@/lib/profile-scraper";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";

/**
 * POST /api/cases/[id]/resolve-domains
 *
 * Two-pass enrichment for rows without a domain:
 *
 * Pass 1 — Fast web search:
 *   "Firmenname Ort" → first non-directory result with name match = domain
 *
 * Pass 2 — Profile scraper (fallback):
 *   Finds catalog profile URL (dastelefonbuch.de, gelbeseiten.de…)
 *   → Firecrawl scrapes it → LLM extracts phone/email/address/website
 *   → Stores profile_url + enriched contact data + domain if found on profile
 *
 * Body: { limit?, sources?, skipProfileScrape? }
 * Returns: SSE stream
 */

function isConfidentMatch(
  companyName: string,
  result: { title: string; snippet: string }
): boolean {
  const tokens = companyName
    .toLowerCase()
    .replace(/gmbh|kg|ohg|ug|ag|co\.|[&.]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 3);
  if (tokens.length === 0) return true;
  const hay = `${result.title} ${result.snippet}`.toLowerCase();
  return tokens.filter(t => hay.includes(t)).length >= Math.ceil(tokens.length * 0.5);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: caseId } = await params;
  const caseData = await getCase(caseId);
  if (!caseData) return new Response(JSON.stringify({ error: "Case not found" }), { status: 404 });

  const { limit = 300, sources, skipProfileScrape = false } = await req.json().catch(() => ({}));

  const [searchKeys, edenApiKey] = await Promise.all([
    resolveSearchKeys().catch(() => ({ serperApiKey: undefined, serpApiKey: undefined, braveApiKey: undefined, apifyApiToken: undefined })),
    resolveEdenKey(caseData).catch(() => null),
  ]);
  const hasSearchKey = !!(searchKeys.serperApiKey || searchKeys.serpApiKey || searchKeys.braveApiKey);
  if (!hasSearchKey) {
    return new Response(JSON.stringify({ error: "Kein Such-API-Key konfiguriert (Serper/SerpApi/Brave)" }), { status: 400 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const push = (data: unknown) => {
        try { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)); }
        catch { /* closed */ }
      };

      await initDb();
      const db = getDb();

      const allRows = await listRows(caseId);
      const targets = allRows
        .filter(r => {
          const d = r.data as Record<string, string | null>;
          if ((d["domain"] ?? "").trim()) return false;
          if (!(d["company_name"] ?? "").trim()) return false;
          if (d["is_catalog"] === "true") return false;
          const src = d["search_source"] ?? "";
          if (src.startsWith("maps-")) return false;
          if (sources && !(sources as string[]).includes(src)) return false;
          return true;
        })
        .slice(0, limit);

      push({ type: "start", total: targets.length });
      await appendLog(caseId, `🔗 DOMAIN RESOLVE: ${targets.length} Zeilen — Pass 1 (Web-Suche) + Pass 2 (Profil-Scrape)`);

      let resolved = 0;
      let enriched = 0;
      let notFound = 0;

      const BATCH = 3;
      for (let b = 0; b < targets.length; b += BATCH) {
        const batch = targets.slice(b, b + BATCH);

        await Promise.all(batch.map(async (row) => {
          const d = row.data as Record<string, string | null>;
          const name = (d["company_name"] ?? "").trim();
          const city = (d["city"] ?? "").trim();
          const existingPhone = (d["phone"] ?? "").trim();

          // ── Pass 1: Fast web search for own website ──
          let ownDomain: string | null = null;
          try {
            const query = city ? `"${name}" ${city}` : `"${name}" Website`;
            const resp = await webSearch(query, {
              serperApiKey: searchKeys.serperApiKey,
              serpApiKey: searchKeys.serpApiKey,
              braveApiKey: searchKeys.braveApiKey,
              maxResults: 5,
              limitCap: 8,
            });
            for (const r of resp.results) {
              try {
                const h = new URL(r.url).hostname.replace(/^www\./, "").toLowerCase();
                if (!WEBSITE_BLOCKLIST.has(h) && h.includes(".") && isConfidentMatch(name, r)) {
                  ownDomain = h;
                  break;
                }
              } catch { /* skip */ }
            }
          } catch { /* ignore */ }

          if (ownDomain) {
            await db.execute(sql`
              UPDATE rows SET data = data || ${JSON.stringify({ domain: ownDomain, source_domain: ownDomain })}::jsonb,
              updated_at = NOW() WHERE id = ${row.id}
            `);
            resolved++;
            push({ type: "progress", rowId: row.id, name, city, domain: ownDomain, status: "resolved", pass: 1 });
            return;
          }

          // ── Pass 2: Profile scraper ──
          if (skipProfileScrape || !edenApiKey) {
            notFound++;
            push({ type: "progress", rowId: row.id, name, city, domain: null, status: "not_found", pass: 1 });
            return;
          }

          try {
            push({ type: "scraping", rowId: row.id, name, city });

            const profile = await scrapeCompanyProfile({
              companyName: name,
              city: city || null,
              phone: existingPhone || null,
              edenApiKey,
              serperApiKey: searchKeys.serperApiKey,
              serpApiKey: searchKeys.serpApiKey,
              braveApiKey: searchKeys.braveApiKey,
            });

            if (profile.confidence === "none" && !profile.profileUrl) {
              notFound++;
              push({ type: "progress", rowId: row.id, name, city, domain: null, status: "not_found", pass: 2 });
              return;
            }

            const patch: Record<string, string> = {};
            if (profile.profileUrl) patch["profile_url"] = profile.profileUrl;
            if (profile.profileSource) patch["profile_source"] = profile.profileSource;
            if (profile.domain) { patch["domain"] = profile.domain; patch["source_domain"] = profile.domain; }
            if (profile.phone && !existingPhone) patch["phone"] = profile.phone;
            if (profile.email && !(d["email"] ?? "").trim()) patch["email"] = profile.email;
            if (profile.address && !(d["address"] ?? "").trim()) patch["address"] = profile.address;
            if (profile.city && !city) patch["city"] = profile.city;
            if (profile.zip && !(d["zip"] ?? "").trim()) patch["zip"] = profile.zip;

            await db.execute(sql`
              UPDATE rows SET data = data || ${JSON.stringify(patch)}::jsonb,
              updated_at = NOW() WHERE id = ${row.id}
            `);

            if (profile.domain) {
              resolved++;
              push({ type: "progress", rowId: row.id, name, city, domain: profile.domain, profileUrl: profile.profileUrl, status: "resolved", pass: 2, confidence: profile.confidence });
            } else {
              enriched++;
              push({ type: "progress", rowId: row.id, name, city, domain: null, profileUrl: profile.profileUrl, status: "enriched", pass: 2, confidence: profile.confidence });
            }
          } catch (e) {
            notFound++;
            push({ type: "progress", rowId: row.id, name, city, domain: null, status: "error", error: (e as Error).message });
          }
        }));

        push({ type: "batch_done", processed: Math.min(b + BATCH, targets.length), total: targets.length, resolved, enriched, notFound });
      }

      await appendLog(caseId, `✅ DOMAIN RESOLVE DONE: ${resolved} Domains, ${enriched} Profile-Daten, ${notFound} nicht gefunden`);
      push({ type: "done", total: targets.length, resolved, enriched, notFound });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
