import type { Case, AiColumn } from "../types";

/** Hidden field patterns — matches the logic in app/cases/[id]/page.tsx */
export const HIDDEN_PATTERNS = [
  /^contact_\d+_/, // contact_1_first_name, contact_2_email, etc.
  /^email_extrapolated$/,
  /^email_fallback$/,
  /^company_email$/,
  /^data_quality$/,
  /^is_catalog$/, // internal flag
  /^profile_source$/,
  /^profile_url$/,
  /^search_query$/, // discovery meta
  /^search_source$/,
  /^source_domain$/,
  /^source_snippet$/,
  /^source_title$/,
  /^source_url$/,
];

const FLAT_CONTACT_KEYS = new Set([
  "first_name",
  "last_name",
  "position",
  "contact_email",
  "contact_phone",
  "linkedin",
  "email_extrapolated",
  "email_fallback",
]);

/** Check if a key should be hidden from the visible table/export */
export function isHiddenColumn(key: string, aiColumns: AiColumn[]): boolean {
  if (key === "_scrape_cached_ts") return false;
  const aiOutputKeySet = new Set(aiColumns.map((c) => c.outputKey));
  if (aiOutputKeySet.has(key)) return false;
  if (key.startsWith("_")) return true;
  if (HIDDEN_PATTERNS.some((p) => p.test(key))) return true;
  const hasBatchContacts = aiColumns.some((c) => c.tool === "batch_contact");
  if (hasBatchContacts && FLAT_CONTACT_KEYS.has(key)) return true;
  return false;
}

/** Build visible column order matching the table view */
export function buildVisibleColOrder(
  caseData: Case,
  colOrder: string[],
  hiddenOverride: Set<string> = new Set()
): string[] {
  const aiKeys = caseData.aiColumns.map((c) => c.outputKey);
  const seen = new Set<string>();
  return colOrder
    .filter((k) => !isHiddenColumn(k, caseData.aiColumns) && !hiddenOverride.has(k) && !seen.has(k) && seen.add(k));
}

/** Determine if a key represents source data (not AI output, not hidden) */
export function isSourceColumn(key: string, caseData: Case): boolean {
  if (isHiddenColumn(key, caseData.aiColumns)) return false;
  return !caseData.aiColumns.some((c) => c.outputKey === key);
}

/** Get display label for a column key */
export function getColumnLabel(key: string, caseData: Case): string {
  const aiCol = caseData.aiColumns.find((c) => c.outputKey === key);
  if (aiCol) return aiCol.name;
  const labels: Record<string, string> = {
    company_name: "Firma",
    contacts: "Kontakt",
    domain: "Domain",
    phone: "Telefon",
    email: "E-Mail",
    company_email: "E-Mail (Firma)",
    contact_email: "E-Mail (Kontakt)",
    address: "Adresse",
    city: "Stadt",
    zip: "PLZ",
    industry: "Branche",
    description: "Beschreibung",
    employees: "Mitarbeiter",
    founded: "Gründungsjahr",
    first_name: "Vorname",
    last_name: "Nachname",
    position: "Position",
    linkedin: "LinkedIn",
    maps_url: "🗺 Maps-Link",
    maps_rating: "★ Rating",
    maps_reviews: "Bewertungen",
    category: "Kategorie",
    _scrape_cached_ts: "⚡ Cache-Status",
  };
  return labels[key] ?? key;
}
