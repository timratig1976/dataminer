import { NextRequest, NextResponse } from "next/server";
import { edenChatCompletion } from "@/lib/edenai";
import { getCase, getEffectiveApiKey } from "@/lib/db";
import { CANONICAL_FIELDS } from "@/lib/row-normalizer";

export const runtime = "nodejs";

interface LlmMapRequest {
  caseId: string;
  headers: string[];
  sampleRows: Record<string, string | null>[];
  existingColumns: string[];
}

/**
 * POST /api/import/llm-map
 *
 * LLM-powered column mapping: sends headers + sample data to LLM,
 * returns suggested canonical key for each header.
 *
 * Falls back gracefully if LLM fails — the caller can still use
 * the deterministic autoDetectMapping as baseline.
 */
export async function POST(req: NextRequest) {
  try {
    const body: LlmMapRequest = await req.json();
    const { caseId, headers, sampleRows, existingColumns } = body;

    if (!headers?.length) {
      return NextResponse.json({ error: "headers required" }, { status: 400 });
    }

    // Resolve API key
    const caseData = caseId ? await getCase(caseId).catch(() => null) : null;
    const apiKey = caseData ? getEffectiveApiKey(caseData) : process.env.EDEN_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "No API key configured" }, { status: 400 });
    }

    // Build candidate target fields: canonical + existing table columns
    const canonicalKeys = CANONICAL_FIELDS.map((f) => `${f.key} (${f.label})`);
    const existingKeys = (existingColumns ?? [])
      .filter((k) => !k.startsWith("_"))
      .map((k) => `${k} (bestehende Spalte)`);
    const allTargets = [...new Set([...canonicalKeys, ...existingKeys])];

    // Build sample data context (max 3 rows, truncate long values)
    const sampleContext = (sampleRows ?? []).slice(0, 3).map((row, i) => {
      const cells = headers.map((h) => {
        const val = (row[h] ?? "").slice(0, 80);
        return `  ${h}: "${val}"`;
      });
      return `Zeile ${i + 1}:\n${cells.join("\n")}`;
    }).join("\n\n");

    const system = `Du bist ein Daten-Mapping-Assistent. Ordne Spalten aus einer importierten Datei den richtigen Zielfeldern zu.

Verfügbare Zielfelder:
${allTargets.map((t) => `- ${t}`).join("\n")}

Regeln:
- Antworte NUR mit JSON: { "originalHeader": "ziel_key", ... }
- Verwende den key (nicht das Label) als Wert
- Wenn keine Zuordnung sinnvoll: verwende den Original-Header (lowercased, spaces → _)
- Berücksichtige die Beispieldaten, nicht nur die Spaltennamen
- Häufige Felder: company_name, domain, phone, email, city, zip, industry, address, first_name, last_name, position`;

    const prompt = `Spalten der Datei:
${headers.map((h) => `- "${h}"`).join("\n")}

Beispieldaten:
${sampleContext}

Ordne jede Spalte dem passenden Zielfeld zu.`;

    const resp = await edenChatCompletion({
      apiKey,
      region: "us",
      model: "openai/gpt-4o-mini",
      system,
      prompt,
      maxTokens: 800,
      temperature: 0,
    });

    // Parse LLM response
    let llmMapping: Record<string, string> = {};
    try {
      const raw = resp.raw?.trim() ?? "";
      const jsonStr = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
      llmMapping = JSON.parse(jsonStr);
    } catch {
      // Try to extract JSON from response
      try {
        const match = (resp.raw ?? "").match(/\{[\s\S]*\}/);
        if (match) llmMapping = JSON.parse(match[0]);
      } catch { /* empty */ }
    }

    return NextResponse.json({
      mapping: llmMapping,
      tokens: resp.tokens,
      costUsd: resp.costUsd,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
