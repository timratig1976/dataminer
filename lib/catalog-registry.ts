/**
 * lib/catalog-registry.ts
 * Persistent catalog domain registry stored in the global settings row.
 *
 * Newly discovered catalog domains (from any run) are saved here so future
 * runs and the isCatalogUrl() check can benefit without code changes.
 *
 * Schema: settings.catalog_domains (JSONB array of lowercase domain strings)
 * Falls back to the hardcoded CATALOG_DOMAINS set in search.ts when no DB entry.
 */

import { getDb, initDb } from "./db";
import { settings } from "./db/schema";
import { eq, sql } from "drizzle-orm";
import { isCatalogUrl } from "./search";

const SETTINGS_ID = "global";

// ── Read ─────────────────────────────────────────────────────────────────────

export async function getLearnedCatalogDomains(): Promise<Set<string>> {
  await initDb();
  const result = await getDb()
    .select({ catalogDomains: settings.catalogDomains })
    .from(settings)
    .where(eq(settings.id, SETTINGS_ID))
    .limit(1);
  const arr = (result[0]?.catalogDomains as string[] | null) ?? [];
  return new Set(arr.map((d) => d.toLowerCase()));
}

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * Add one or more domains to the persistent registry.
 * Silently ignores duplicates and invalid strings.
 */
export async function learnCatalogDomains(domains: string[]): Promise<void> {
  const clean = domains
    .map((d) => d.toLowerCase().replace(/^www\./, "").trim())
    .filter((d) => d.includes(".") && d.length > 3);
  if (clean.length === 0) return;

  await initDb();
  const db = getDb();

  // Merge into existing array via PG jsonb array concatenation + distinct
  await db.execute(sql`
    INSERT INTO ${settings} (id, catalog_domains, eden_region, updated_at)
    VALUES (
      ${SETTINGS_ID},
      ${JSON.stringify(clean)}::jsonb,
      'us',
      NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      catalog_domains = (
        SELECT jsonb_agg(DISTINCT val)
        FROM jsonb_array_elements_text(
          COALESCE(${settings.catalogDomains}, '[]'::jsonb) || ${JSON.stringify(clean)}::jsonb
        ) AS val
      ),
      updated_at = NOW()
  `);
}

// ── Classify ─────────────────────────────────────────────────────────────────

/**
 * Returns true if a URL is a catalog page — checks both the hardcoded list
 * (isCatalogUrl from search.ts) and the learned registry.
 */
export async function isCatalogUrlExtended(
  url: string,
  learnedDomains?: Set<string>
): Promise<boolean> {
  if (isCatalogUrl(url)) return true;

  const learned = learnedDomains ?? await getLearnedCatalogDomains();
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return learned.has(hostname) || Array.from(learned).some((d) => hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

// ── Bulk scan + flag ──────────────────────────────────────────────────────────

export interface ReflagResult {
  flagged: number;
  promoted: number; // catalog rows that got own domain → promoted to data rows
  learnedDomains: string[];
}

/**
 * Scan all rows in a case:
 * - If source_url matches catalog pattern → set is_catalog="true"
 * - If is_catalog="true" but url no longer matches → clear flag (promote)
 * - Collect all catalog domains encountered → save to registry
 */
export async function reflagCatalogRows(caseId: string): Promise<ReflagResult> {
  const { listRows, getDb: _getDb, initDb: _initDb } = await import("./db");
  await _initDb();
  const db = _getDb();

  const allRows = await listRows(caseId);
  const learned = await getLearnedCatalogDomains();

  let flagged = 0;
  let promoted = 0;
  const newCatalogDomains: string[] = [];

  for (const row of allRows) {
    const data = row.data as Record<string, string | null>;

    // Rows discovered via Maps are always real companies — never catalogs
    const searchSource = data["search_source"] ?? "";
    if (searchSource.startsWith("maps-") || searchSource === "maps") {
      // Clear any stale is_catalog flag if present
      if (data["is_catalog"] === "true") {
        await db.execute(sql`
          UPDATE rows SET data = data - 'is_catalog', updated_at = NOW() WHERE id = ${row.id}
        `);
        promoted++;
      }
      continue;
    }

    // For non-Maps rows: check source_domain (company's own site) first,
    // fall back to source_url only if it's not a Maps/Google URL
    const rawSourceUrl = data["source_url"] ?? "";
    const isMapsUrl = rawSourceUrl.includes("google.com/maps") || rawSourceUrl.includes("maps.google.com");
    const url = data["source_domain"] ?? data["domain"] ?? (isMapsUrl ? "" : rawSourceUrl);
    const currentFlag = data["is_catalog"];

    const isCat = url ? await isCatalogUrlExtended(url, learned) : false;

    if (isCat && currentFlag !== "true") {
      // Flag it
      await db.execute(sql`
        UPDATE rows
        SET data = data || '{"is_catalog":"true"}'::jsonb,
            updated_at = NOW()
        WHERE id = ${row.id}
      `);
      flagged++;

      // Learn the domain
      try {
        const d = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
        if (d && !learned.has(d)) {
          newCatalogDomains.push(d);
          learned.add(d);
        }
      } catch { /* ignore */ }
    } else if (!isCat && currentFlag === "true" && data["domain"]) {
      // Has own domain now → promote to data row
      await db.execute(sql`
        UPDATE rows
        SET data = data - 'is_catalog',
            updated_at = NOW()
        WHERE id = ${row.id}
      `);
      promoted++;
    }
  }

  if (newCatalogDomains.length > 0) {
    await learnCatalogDomains(newCatalogDomains);
  }

  return { flagged, promoted, learnedDomains: newCatalogDomains };
}
