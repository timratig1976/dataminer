/**
 * lib/templates.ts
 * Project templates for new cases — pre-configured columns for common workflows.
 *
 * Each template defines:
 *   - recommendedColumns: plain text columns the user should import (e.g. via CSV)
 *   - aiColumns: AI enrichment columns pre-configured with prompts
 *
 * Applied when creating a case with ?template=lead-research.
 */

import type { AiColumn } from "./types";

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  /** Plain text columns the user should have in their source data */
  recommendedColumns: string[];
  /** AI columns that get pre-configured on the case */
  aiColumns: AiColumn[];
}

function tplCol(
  name: string,
  outputKey: string,
  prompt: string,
  opts: Partial<AiColumn> = {},
): AiColumn {
  return {
    id: crypto.randomUUID(),
    name,
    outputKey,
    prompt,
    model: "openai/gpt-4o-mini",
    outputMode: "text",
    condition: "require_input",
    conditionField: "company_name",
    useWebSearch: true,
    searchQuery: `{company_name}`,
    searchMaxResults: 5,
    // evidenceMode: "auto",
    ...opts,
  };
}

// ── Template definitions ─────────────────────────────────────────────────────

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: "lead-research",
    name: "Lead-Recherche",
    description:
      "Firmen + Ansprechpartner recherchieren. 1 Zeile = 1 Kontakt. Mehrere Kontakte pro Firma über gleichen company_name.",
    icon: "🏢",
    recommendedColumns: ["company_name"],
    aiColumns: [
      // ── Company columns ────────────────────────────────────────────
      tplCol("Website", "website", "Offizielle Website von {company_name}. Nur die Domain zurückgeben, kein Markdown.", {
        columnGroup: "company",
        validateDomain: true,
        captureReasoning: true,
      }),
      tplCol("Telefon", "phone_company", "Haupt-Telefonnummer von {company_name}. Nur die Nummer im internationalen Format.", {
        columnGroup: "company",
        condition: "empty",
      }),
      tplCol("Stadt", "city", "Stadt / Hauptsitz von {company_name}. Nur Stadtname + ggf. PLZ.", {
        columnGroup: "company",
        condition: "empty",
      }),
      tplCol("Branche", "industry", "Branche/Schwerpunkt von {company_name}. 1–3 Stichworte.", {
        columnGroup: "company",
        condition: "empty",
      }),
      // ── Contact columns ────────────────────────────────────────────
      tplCol("Vorname", "first_name", "Vorname eines Entscheiders bei {company_name} (GF, CEO, Head of Sales, o.ä.).", {
        columnGroup: "contact",
        condition: "empty",
      }),
      tplCol("Nachname", "last_name", "Nachname eines Entscheiders bei {company_name} (GF, CEO, Head of Sales, o.ä.).", {
        columnGroup: "contact",
        condition: "empty",
      }),
      tplCol("Position", "position", "Position/Jobtitel des Entscheiders bei {company_name}.", {
        columnGroup: "contact",
        condition: "empty",
      }),
      tplCol("E-Mail", "email", "Business-E-Mail-Adresse des Kontakts bei {company_name}. Nur die Adresse.", {
        columnGroup: "contact",
        condition: "empty",
      }),
    ],
  },
];

/** Lookup a template by id. Returns undefined if not found. */
export function getTemplate(id: string): ProjectTemplate | undefined {
  return PROJECT_TEMPLATES.find((t) => t.id === id);
}