import { NextRequest, NextResponse } from "next/server";
import { getCase, listRows, upsertContactRows } from "@/lib/db";

/**
 * POST /api/contact-rows/extract
 * Extracts contact data already stored as flat fields in company rows
 * (first_name, last_name, contact_1_*, contact_2_* etc.) and upserts
 * them into the contact_rows table.
 */
export async function POST(req: NextRequest) {
  const { caseId } = await req.json();
  if (!caseId) return NextResponse.json({ error: "caseId required" }, { status: 400 });

  const caseData = await getCase(caseId);
  if (!caseData) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rows = await listRows(caseId);

  // Find the batch_contacts column prefix
  const batchCol = caseData.aiColumns.find(c => c.tool === "batch_contact");
  const prefix = batchCol?.batchContactsPrefix ?? "contact_";
  const contactsJsonKey = batchCol ? `_contacts_json_${batchCol.outputKey}` : null;

  let totalInserted = 0;
  let totalUpdated = 0;
  let rowsProcessed = 0;

  for (const row of rows) {
    const d = row.data as Record<string, string | null>;
    const contacts: Array<Record<string, string | null>> = [];

    // 1. Try JSON summary first (most reliable)
    if (contactsJsonKey && d[contactsJsonKey]) {
      try {
        const parsed = JSON.parse(d[contactsJsonKey] as string);
        if (Array.isArray(parsed) && parsed.length > 0) {
          for (const c of parsed) {
            contacts.push({
              first_name: c.first_name ?? null,
              last_name: c.last_name ?? null,
              position: c.position ?? null,
              email: c.email ?? null,
              email_extrapolated: c.email_extrapolated ?? null,
              phone: c.phone ?? null,
              linkedin: c.linkedin ?? null,
              source: c.source ?? null,
              company_name: d["company_name"] ?? d["Unternehmensname"] ?? null,
              domain: d["domain"] ?? d["source_domain"] ?? null,
              city: d["city"] ?? d["Stadt"] ?? null,
            });
          }
        }
      } catch { /* fall through to flat fields */ }
    }

    // 2. Fallback: indexed flat fields contact_1_*, contact_2_*, ...
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

    // 3. Fallback: legacy flat first_name/last_name directly on the row
    if (contacts.length === 0) {
      const fn = d["first_name"];
      const ln = d["last_name"];
      if (fn || ln) {
        contacts.push({
          first_name: fn ?? null,
          last_name: ln ?? null,
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
    }

    if (contacts.length === 0) continue;

    const { inserted, updated } = await upsertContactRows(caseId, row.id, contacts);
    totalInserted += inserted;
    totalUpdated += updated;
    rowsProcessed++;
  }

  return NextResponse.json({
    ok: true,
    rowsProcessed,
    inserted: totalInserted,
    updated: totalUpdated,
    total: totalInserted + totalUpdated,
  });
}
