import { NextRequest, NextResponse } from "next/server";
import { getCase, listRows, upsertContactRows, getDb, rows as rowsTable, initDb } from "@/lib/db";
import { eq } from "drizzle-orm";

/**
 * POST /api/contact-rows/cleanup
 *
 * Two operations in one:
 * 1. Extract: migrate existing flat contact fields from company rows → contact_rows
 * 2. Strip: remove all contact-related fields from company rows (keeping only company data)
 *
 * Fields removed from company rows after migration:
 *   - contact_N_* (indexed flat fields)
 *   - first_name, last_name, position, contact_email, contact_phone, linkedin
 *   - email_extrapolated, email_fallback, company_email
 *   - _contacts_json_*, _contacts_impressum_md_*, _contacts_google_snip_*,
 *     _contacts_linkedin_snip_*, _contacts_source_urls_*, _contacts_sources_*
 *   - _llm_system_*, _llm_prompt__batch_kontakte, _llm_raw__batch_kontakte
 *     (large debug blobs from the contacts run)
 */
export async function POST(req: NextRequest) {
  const { caseId, extractOnly } = await req.json() as { caseId: string; extractOnly?: boolean };
  if (!caseId) return NextResponse.json({ error: "caseId required" }, { status: 400 });

  const caseData = await getCase(caseId);
  if (!caseData) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const companyRows = await listRows(caseId);

  const batchCol = caseData.aiColumns.find(c => c.tool === "batch_contact");
  const prefix = batchCol?.batchContactsPrefix ?? "contact_";
  const contactsJsonKey = batchCol ? `_contacts_json_${batchCol.outputKey}` : null;

  let totalInserted = 0;
  let totalUpdated = 0;
  let rowsProcessed = 0;
  let rowsCleaned = 0;

  await initDb();
  const db = getDb();

  for (const row of companyRows) {
    const d = row.data as Record<string, string | null>;
    const contacts: Array<Record<string, string | null>> = [];

    // 1. Parse from JSON summary (most reliable, has all contacts)
    if (contactsJsonKey && d[contactsJsonKey]) {
      try {
        const parsed = JSON.parse(d[contactsJsonKey] as string);
        if (Array.isArray(parsed) && parsed.length > 0) {
          for (const c of parsed) {
            // Find email_extrapolated from indexed fields
            const idx = parsed.indexOf(c) + 1;
            contacts.push({
              first_name: c.first_name ?? null,
              last_name: c.last_name ?? null,
              position: c.position ?? null,
              email: c.email ?? null,
              email_extrapolated: c.email_extrapolated ?? d[`${prefix}${idx}_email_extrapolated`] ?? null,
              phone: c.phone ?? null,
              linkedin: c.linkedin ?? null,
              source: c.source ?? null,
              company_name: d["company_name"] ?? d["Unternehmensname"] ?? null,
              domain: d["domain"] ?? d["source_domain"] ?? null,
              city: d["city"] ?? d["Stadt"] ?? null,
            });
          }
        }
      } catch { /* fall through */ }
    }

    // 2. Fallback: indexed flat fields
    if (contacts.length === 0) {
      for (let n = 1; n <= 10; n++) {
        const fn = d[`${prefix}${n}_first_name`];
        const ln = d[`${prefix}${n}_last_name`];
        if (!fn && !ln) break;
        contacts.push({
          first_name: fn ?? null,
          last_name: ln ?? null,
          position: d[`${prefix}${n}_position`] ?? null,
          email: d[`${prefix}${n}_email`] ?? null,
          email_extrapolated: d[`${prefix}${n}_email_extrapolated`] ?? null,
          phone: d[`${prefix}${n}_phone`] ?? null,
          linkedin: d[`${prefix}${n}_linkedin`] ?? null,
          source: "extracted_from_row",
          company_name: d["company_name"] ?? d["Unternehmensname"] ?? null,
          domain: d["domain"] ?? d["source_domain"] ?? null,
          city: d["city"] ?? d["Stadt"] ?? null,
        });
      }
    }

    // 3. Final fallback: legacy flat first_name directly on row
    if (contacts.length === 0 && (d["first_name"] || d["last_name"])) {
      contacts.push({
        first_name: d["first_name"] ?? null,
        last_name: d["last_name"] ?? null,
        position: d["position"] ?? null,
        email: d["contact_email"] ?? d["email"] ?? null,
        email_extrapolated: d["email_extrapolated"] ?? null,
        phone: d["contact_phone"] ?? d["phone"] ?? null,
        linkedin: d["linkedin"] ?? null,
        source: "extracted_from_row",
        company_name: d["company_name"] ?? d["Unternehmensname"] ?? null,
        domain: d["domain"] ?? d["source_domain"] ?? null,
        city: d["city"] ?? d["Stadt"] ?? null,
      });
    }

    if (contacts.length > 0) {
      const { inserted, updated } = await upsertContactRows(caseId, row.id, contacts);
      totalInserted += inserted;
      totalUpdated += updated;
      rowsProcessed++;
    }

    // Strip contact fields from company row
    if (!extractOnly) {
      const STRIP_PREFIXES = [
        `${prefix}`,               // contact_1_*, contact_2_*, ...
        `_contacts_json_`,
        `_contacts_impressum_md_`,
        `_contacts_google_snip_`,
        `_contacts_linkedin_snip_`,
        `_contacts_source_urls_`,
        `_contacts_sources_`,
        `_llm_system_`,
        // Large debug blobs from batch_contacts run
        ...(batchCol ? [`_llm_prompt_${batchCol.outputKey}`, `_llm_raw_${batchCol.outputKey}`, `_batch_scrape_md_${batchCol.outputKey}`, `_batch_search_snip_${batchCol.outputKey}`] : []),
      ];
      const STRIP_EXACT = new Set([
        "first_name", "last_name", "position",
        "contact_email", "contact_phone", "linkedin",
        "email_extrapolated", "email_fallback", "company_email",
        "email",   // generic email written by batch_contacts
        "phone",   // generic phone written by batch_contacts
      ]);

      const hasContactFields = Object.keys(d).some(k =>
        STRIP_EXACT.has(k) || STRIP_PREFIXES.some(p => k.startsWith(p))
      );

      if (hasContactFields) {
        const cleaned: Record<string, string | null> = {};
        for (const [k, v] of Object.entries(d)) {
          const strip = STRIP_EXACT.has(k) || STRIP_PREFIXES.some(p => k.startsWith(p));
          if (!strip) cleaned[k] = v;
        }
        await db.update(rowsTable)
          .set({ data: cleaned, updatedAt: new Date() })
          .where(eq(rowsTable.id, row.id));
        rowsCleaned++;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    rowsProcessed,
    inserted: totalInserted,
    updated: totalUpdated,
    rowsCleaned,
  });
}
