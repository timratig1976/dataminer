/**
 * lib/templates.ts
 * Project templates for new cases — pre-configured columns for common workflows.
 *
 * Each template defines:
 *   - recommendedColumns: plain text columns the user should import (e.g. via CSV)
 *   - aiColumns: AI enrichment columns pre-configured with prompts
 *
 * Applied when creating a case with ?template=<id>.
 */

import type { AiColumn } from "./types";

export interface BaseColumn {
  name: string;
  outputKey: string;
}

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  /** Plain text columns the user should have in their source data */
  recommendedColumns: string[];
  /** Plain (non-AI) columns to pre-create in the case so batch results are visible */
  baseColumns?: BaseColumn[];
  /** AI columns that get pre-configured on the case */
  aiColumns: AiColumn[];
}

// ── Template definitions ─────────────────────────────────────────────────────

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: "standard",
    name: "Standard",
    description:
      "Firmen- und Kontaktdaten anreichern. Startet mit Firmenname — zwei KI-Aktionen befüllen alle weiteren Felder.",
    icon: "⚡",
    recommendedColumns: ["company_name"],
    // Visible plain columns — pre-created so batch results show up in the table
    baseColumns: [
      { name: "Firmenname", outputKey: "company_name" },
      { name: "Domain", outputKey: "domain" },
      { name: "Telefon", outputKey: "phone" },
      { name: "E-Mail", outputKey: "email" },
      { name: "Stadt", outputKey: "city" },
      { name: "PLZ", outputKey: "zip" },
      { name: "Branche", outputKey: "industry" },
      { name: "Beschreibung", outputKey: "description" },
      { name: "Mitarbeiter", outputKey: "employees" },
      { name: "Gründungsjahr", outputKey: "founded" },
    ],
    aiColumns: [
      {
        id: crypto.randomUUID(),
        name: "🏢 Firmendaten recherchieren",
        outputKey: "_batch_firmendaten",
        prompt: "",
        model: "openai/gpt-4o-mini",
        outputMode: "text",
        tool: "batch_enrich",
        batchOutputFields: ["company_name", "domain", "phone", "email", "city", "zip", "industry", "description", "employees", "founded"],
        batchSearchContacts: false,
        condition: "empty",
        conditionField: "_batch_firmendaten",
        columnGroup: "company",
      },
      {
        id: crypto.randomUUID(),
        name: "👤 Entscheider finden",
        outputKey: "_batch_kontakte",
        prompt: "",
        model: "openai/gpt-4o-mini",
        outputMode: "text",
        tool: "batch_contacts",
        batchContactsMax: 3,
        batchContactsLinkedIn: true,
        batchContactsImpressum: true,
        batchContactsPrefix: "contact_",
        condition: "empty",
        conditionField: "_batch_kontakte",
        columnGroup: "contact",
      },
    ],
  },
  ];

/** Lookup a template by id. Returns undefined if not found. */
export function getTemplate(id: string): ProjectTemplate | undefined {
  return PROJECT_TEMPLATES.find((t) => t.id === id);
}