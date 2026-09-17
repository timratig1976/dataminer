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
    recommendedColumns: ["company_name", "maps_url"],
    // Visible plain columns — pre-created so batch results show up in the table
    baseColumns: [
      { name: "Firmenname", outputKey: "company_name" },
      { name: "Domain", outputKey: "domain" },
      { name: "Telefon", outputKey: "phone" },
      { name: "E-Mail (Firma)", outputKey: "company_email" },
      { name: "Adresse", outputKey: "address" },
      { name: "Stadt", outputKey: "city" },
      { name: "PLZ", outputKey: "zip" },
      { name: "Branche", outputKey: "industry" },
      { name: "Beschreibung", outputKey: "description" },
      { name: "Mitarbeiter", outputKey: "employees" },
      { name: "Gegründet", outputKey: "founded" },
      // GMB fields
      { name: "Maps URL", outputKey: "maps_url" },
      { name: "★ Rating", outputKey: "maps_rating" },
      { name: "Kategorie", outputKey: "category" },
      { name: "Bewertungen", outputKey: "maps_reviews" },
      // Contact columns written by batch_contacts
      { name: "Vorname", outputKey: "first_name" },
      { name: "Nachname", outputKey: "last_name" },
      { name: "Position", outputKey: "position" },
      { name: "E-Mail (Kontakt)", outputKey: "contact_email" },
      { name: "LinkedIn", outputKey: "linkedin" },
    ],
    aiColumns: [
      {
        id: crypto.randomUUID(),
        name: "🏢 Firmendaten",
        outputKey: "_batch_firmendaten",
        prompt: "",
        model: "openai/gpt-4o-mini",
        outputMode: "text",
        tool: "batch_company",
        batchOutputFields: ["company_name", "domain", "phone", "company_email", "address", "city", "zip", "industry", "description", "employees", "founded"],
        batchSearchContacts: false,
        condition: "empty",
        conditionField: "_batch_firmendaten",
        columnGroup: "company",
      },
      {
        id: crypto.randomUUID(),
        name: "👤 Entscheider",
        outputKey: "_batch_kontakte",
        prompt: "",
        model: "openai/gpt-4o-mini",
        outputMode: "text",
        tool: "batch_contact",
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
  {
    id: "vilocal",
    name: "ViLocal Audit",
    description: "Google Business Profile Analyse für B2B-Kaltakquise. Apify holt Maps-Daten frisch, KI bewertet GBP-Qualität, erkennt Ketten-Standorte und generiert personalisierten Pitch-Hook.",
    icon: "📍",
    recommendedColumns: ["company_name", "maps_url"],
    baseColumns: [
      { name: "Domain", outputKey: "domain" },
      { name: "Firmenname", outputKey: "company_name" },
      { name: "Branche", outputKey: "industry" },
      { name: "Adresse", outputKey: "address" },
      { name: "PLZ", outputKey: "zip" },
      { name: "Stadt", outputKey: "city" },
      { name: "Beschreibung", outputKey: "description" },
      { name: "Telefon", outputKey: "phone" },
      { name: "E-Mail (Firma)", outputKey: "company_email" },
      { name: "Mitarbeiter", outputKey: "employees" },
      { name: "Gegründet", outputKey: "founded" },
      { name: "Maps URL", outputKey: "maps_url" },
      { name: "★ Rating", outputKey: "maps_rating" },
      { name: "Kategorie", outputKey: "category" },
      { name: "Bewertungen", outputKey: "maps_reviews" },
      { name: "Vorname", outputKey: "first_name" },
      { name: "Nachname", outputKey: "last_name" },
      { name: "Position", outputKey: "position" },
      { name: "E-Mail (Kontakt)", outputKey: "contact_email" },
      { name: "LinkedIn", outputKey: "linkedin" },
    ],
    aiColumns: [
      {
        id: crypto.randomUUID(),
        name: "🏢 Firmendaten",
        outputKey: "_batch_firmendaten",
        prompt: "",
        model: "openai/gpt-4o-mini",
        outputMode: "text",
        tool: "batch_company",
        batchOutputFields: ["company_name", "domain", "phone", "company_email", "address", "city", "zip", "industry", "description", "employees", "founded"],
        batchSearchContacts: false,
        condition: "empty",
        conditionField: "_batch_firmendaten",
        columnGroup: "company",
      },
      {
        id: crypto.randomUUID(),
        name: "📍 ViLocal Audit",
        outputKey: "vilocal_audit",
        model: "openai/gpt-4o-mini",
        outputMode: "json",
        crawlSources: ["maps_details", "maps_reviews"] as Array<"domain" | "maps_details" | "maps_reviews">,
        crawlReviewsMax: 10,
        condition: "empty",
        conditionField: "vilocal_audit",
        prompt: `Du bist ein Google Business Profile Experte. Analysiere den folgenden Google Maps Eintrag für einen B2B-Kaltakquise-Pitch (Produkt: ViLocal — Google Business Profile Optimierung).

Bewerte das Profil und gib ein JSON-Objekt zurück mit:
- "score": Gesamtqualitäts-Score 1-10 (10 = perfekt optimiertes Profil)
- "missing": Array von fehlenden Elementen (z.B. ["Beschreibung fehlt", "Keine Öffnungszeiten", "Wenige Fotos (<5)"])
- "inconsistent": Array von Inkonsistenzen (z.B. ["Telefon auf Website ≠ Maps", "Adresse veraltet"])
- "strengths": Array von Stärken (z.B. ["Viele Bewertungen", "Inhaber antwortet"])
- "potential": Kurzer Satz: konkret was ViLocal verbessern würde (für den Pitch)
- "pitch_hook": 1 packender Satz für die Erstansprache (personalisiert, auf Deutsch)
- "priority": "hoch" | "mittel" | "niedrig" (Lead-Priorität für ViLocal)
- "is_chain": true | false — Ist das ein Filial-/Kettenunternehmen mit mehreren Standorten?
- "chain_note": (nur wenn is_chain=true) Kurzer Hinweis für den Pitch

Verfügbare Daten aus dem Google Maps Eintrag stehen oben als Kontext-Blöcke.`,
      },
      {
        id: crypto.randomUUID(),
        name: "👤 Entscheider",
        outputKey: "_batch_kontakte",
        prompt: "",
        model: "openai/gpt-4o-mini",
        outputMode: "text",
        tool: "batch_contact",
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