"use client";

/**
 * Client-safe helpers shared with the discovery UI.
 * Mirrors buildQueriesFromRows from lib/discovery.ts but without server-only
 * imports (psl, search) so client components can use it.
 */

export interface ClientTemplateRow {
  data: Record<string, string | null>;
}

/**
 * Render a query template ({column} placeholders, {a|b|c} fallback syntax)
 * against row data and collect unique, non-empty queries.
 */
export function buildQueriesFromRowsPublic(
  rows: ClientTemplateRow[],
  template: string,
  maxQueries = 50
): string[] {
  if (!template.trim() || rows.length === 0) return [];
  const seen = new Set<string>();
  const queries: string[] = [];

  for (const row of rows) {
    const q = template
      .replace(/\{([^}]+)\}/g, (_, key) => {
        const fields = String(key).split("|").map((s: string) => s.trim()).filter(Boolean);
        for (const f of fields) {
          const v = row.data[f];
          if (v != null && String(v).trim() !== "" && String(v).trim() !== "(not provided)") {
            return String(v).trim();
          }
        }
        return "";
      })
      .replace(/\s{2,}/g, " ")
      .replace(/[·|]\s*$/, "")
      .trim();

    if (!q) continue;
    if (seen.has(q.toLowerCase())) continue;
    seen.add(q.toLowerCase());
    queries.push(q);
    if (queries.length >= maxQueries) break;
  }

  return queries;
}
