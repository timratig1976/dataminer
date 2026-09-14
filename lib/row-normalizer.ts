/**
 * lib/row-normalizer.ts
 * Fuzzy field-name mapping for imported/discovered rows.
 *
 * Maps arbitrary column names (e.g. "Firmenname", "Company", "organisation")
 * to canonical internal field names (e.g. "company_name") without any LLM calls.
 *
 * Strategy:
 *   1. Exact canonical key match
 *   2. Known alias match (case-insensitive)
 *   3. Levenshtein similarity ≥ 0.75 against canonical keys + aliases
 *   4. Fallback: keep original key (lowercased, spaces→_)
 */

// ── Canonical field definitions ──────────────────────────────────────────────

export interface CanonicalField {
  key: string;             // internal field name
  label: string;           // human display label
  aliases: string[];       // known synonyms (lowercase)
  category: "identity" | "contact" | "location" | "social" | "meta";
}

export const CANONICAL_FIELDS: CanonicalField[] = [
  // Identity
  {
    key: "company_name",
    label: "Firmenname",
    category: "identity",
    aliases: [
      "firmenname", "firma", "company", "company name", "unternehmen",
      "unternehmensname", "organisation", "organization", "name", "betrieb",
      "geschäft", "handelsname", "bezeichnung",
    ],
  },
  {
    key: "domain",
    label: "Domain / Website",
    category: "identity",
    aliases: [
      "domain", "website", "url", "webseite", "homepage", "web", "internetseite",
      "internet", "site", "link", "webpage",
    ],
  },
  // Contact
  {
    key: "phone",
    label: "Telefon",
    category: "contact",
    aliases: [
      "telefon", "phone", "tel", "telefonnummer", "phone number", "rufnummer",
      "mobil", "mobile", "fon", "handynummer", "kontakt",
    ],
  },
  {
    key: "email",
    label: "E-Mail",
    category: "contact",
    aliases: [
      "email", "e-mail", "mail", "e mail", "emailadresse", "email address",
      "mailadresse",
    ],
  },
  {
    key: "contact_name",
    label: "Ansprechpartner",
    category: "contact",
    aliases: [
      "ansprechpartner", "contact", "contact name", "kontaktperson", "person",
      "name ansprechpartner", "geschäftsführer", "inhaber", "ceo", "owner",
    ],
  },
  // Location
  {
    key: "address",
    label: "Adresse",
    category: "location",
    aliases: [
      "adresse", "address", "straße", "street", "anschrift", "strasse",
      "postanschrift", "full address",
    ],
  },
  {
    key: "city",
    label: "Stadt",
    category: "location",
    aliases: [
      "stadt", "city", "ort", "gemeinde", "place", "location", "standort",
      "wohnort", "sitz",
    ],
  },
  {
    key: "zip",
    label: "PLZ",
    category: "location",
    aliases: [
      "plz", "zip", "postleitzahl", "postal code", "zip code", "postalcode",
      "postcode",
    ],
  },
  {
    key: "state",
    label: "Bundesland",
    category: "location",
    aliases: [
      "bundesland", "state", "land", "region", "province", "bundesstaat",
    ],
  },
  {
    key: "country",
    label: "Land",
    category: "location",
    aliases: [
      "country", "land", "country name", "nation", "staat",
    ],
  },
  // Social
  {
    key: "linkedin",
    label: "LinkedIn",
    category: "social",
    aliases: [
      "linkedin", "linkedin url", "linkedin profile", "linkedin link",
    ],
  },
  {
    key: "xing",
    label: "Xing",
    category: "social",
    aliases: ["xing", "xing url", "xing profil"],
  },
  // Meta
  {
    key: "industry",
    label: "Branche",
    category: "meta",
    aliases: [
      "branche", "industry", "sector", "sektor", "kategorie", "category",
      "geschäftsbereich", "tätigkeitsfeld",
    ],
  },
  {
    key: "description",
    label: "Beschreibung",
    category: "meta",
    aliases: [
      "beschreibung", "description", "text", "info", "information",
      "about", "über uns", "leistungen", "profil",
    ],
  },
  {
    key: "employees",
    label: "Mitarbeiter",
    category: "meta",
    aliases: [
      "mitarbeiter", "employees", "mitarbeiterzahl", "employee count",
      "size", "größe", "company size",
    ],
  },
  {
    key: "revenue",
    label: "Umsatz",
    category: "meta",
    aliases: [
      "umsatz", "revenue", "jahresumsatz", "annual revenue", "turnover",
      "einnahmen",
    ],
  },
  {
    key: "founded",
    label: "Gründungsjahr",
    category: "meta",
    aliases: [
      "gegründet", "founded", "gründungsjahr", "founding year", "year founded",
      "establishment year", "seit",
    ],
  },
  {
    key: "source_url",
    label: "Quell-URL",
    category: "meta",
    aliases: [
      "source_url", "source url", "quelle", "source", "quellseite",
      "gefunden auf",
    ],
  },
];

// Build lookup map for O(1) matching
const aliasMap = new Map<string, string>(); // alias → canonical key
for (const field of CANONICAL_FIELDS) {
  aliasMap.set(field.key, field.key);
  for (const alias of field.aliases) {
    aliasMap.set(alias.toLowerCase(), field.key);
  }
}

// ── Levenshtein distance ──────────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface MappingResult {
  originalKey: string;
  canonicalKey: string;
  confidence: "exact" | "alias" | "fuzzy" | "fallback";
  label: string;
}

/**
 * Map a single column name to a canonical key.
 */
export function mapColumnName(rawKey: string): MappingResult {
  const lower = rawKey.toLowerCase().trim();
  const normalized = lower.replace(/[\s\-_]+/g, " ");

  // 1. Exact canonical key
  const exactField = CANONICAL_FIELDS.find((f) => f.key === lower);
  if (exactField) {
    return { originalKey: rawKey, canonicalKey: exactField.key, confidence: "exact", label: exactField.label };
  }

  // 2. Alias map lookup (fastest path)
  const fromAlias = aliasMap.get(normalized) ?? aliasMap.get(lower);
  if (fromAlias) {
    const field = CANONICAL_FIELDS.find((f) => f.key === fromAlias)!;
    return { originalKey: rawKey, canonicalKey: fromAlias, confidence: "alias", label: field.label };
  }

  // 3. Fuzzy Levenshtein match
  let bestKey = "";
  let bestScore = 0;
  for (const [alias, key] of aliasMap.entries()) {
    const score = similarity(normalized, alias);
    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }

  if (bestScore >= 0.75 && bestKey) {
    const field = CANONICAL_FIELDS.find((f) => f.key === bestKey)!;
    return { originalKey: rawKey, canonicalKey: bestKey, confidence: "fuzzy", label: field.label };
  }

  // 4. Fallback: sanitize original key
  const fallback = lower.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return { originalKey: rawKey, canonicalKey: fallback, confidence: "fallback", label: rawKey };
}

/**
 * Auto-detect field mappings for a list of raw column names.
 * Returns a map: rawKey → canonicalKey
 */
export function autoDetectMapping(rawKeys: string[]): Record<string, MappingResult> {
  const result: Record<string, MappingResult> = {};
  const usedCanonical = new Set<string>();

  for (const key of rawKeys) {
    const mapping = mapColumnName(key);
    // Avoid duplicate canonical assignments — if already taken, use fallback
    if (usedCanonical.has(mapping.canonicalKey) && mapping.confidence !== "fallback") {
      const fallback = key.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
      result[key] = { originalKey: key, canonicalKey: fallback, confidence: "fallback", label: key };
    } else {
      result[key] = mapping;
      if (mapping.confidence !== "fallback") usedCanonical.add(mapping.canonicalKey);
    }
  }

  return result;
}

/**
 * Apply a field mapping to a row object.
 * Unmapped keys are kept with their (sanitized) fallback name.
 */
export function normalizeRow(
  row: Record<string, string | null | undefined>,
  mapping: Record<string, MappingResult>
): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  for (const [origKey, value] of Object.entries(row)) {
    const m = mapping[origKey];
    const targetKey = m?.canonicalKey ?? origKey.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    result[targetKey] = value != null ? String(value) : null;
  }
  return result;
}

/**
 * Normalize multiple rows with the same mapping.
 */
export function normalizeRows(
  rows: Record<string, string | null | undefined>[],
  mapping: Record<string, MappingResult>
): Record<string, string | null>[] {
  return rows.map((r) => normalizeRow(r, mapping));
}
