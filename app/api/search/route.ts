import { NextRequest, NextResponse } from "next/server";
import { webSearch, type SearchLayer } from "@/lib/search";

const VALID_LAYERS = new Set<string>(["serpapi", "duckduckgo", "playwright"]);

function parseLayer(raw: string | null | undefined): SearchLayer | undefined {
  if (!raw) return undefined;
  return VALID_LAYERS.has(raw) ? (raw as SearchLayer) : undefined;
}

function clampMaxResults(raw: unknown, fallback = 5): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(Math.floor(n), 10));
}

function getSerpApiKey(): string | undefined {
  return process.env.SERP_API_KEY?.trim() || undefined;
}

export async function POST(req: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (typeof body !== "object" || body === null) {
      return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
    }

    const { query, maxResults, forceLayer } = body as Record<string, unknown>;

    if (typeof query !== "string" || !query.trim()) {
      return NextResponse.json({ error: "query (string) required" }, { status: 400 });
    }

    const response = await webSearch(query.trim(), {
      serpApiKey: getSerpApiKey(),
      maxResults: clampMaxResults(maxResults),
      forceLayer: parseLayer(typeof forceLayer === "string" ? forceLayer : undefined),
    });

    return NextResponse.json(response);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/search POST] error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const query = sp.get("q");

    if (!query?.trim()) {
      return NextResponse.json({ error: "q (query string) required" }, { status: 400 });
    }

    const response = await webSearch(query.trim(), {
      serpApiKey: getSerpApiKey(),
      maxResults: clampMaxResults(sp.get("n")),
      forceLayer: parseLayer(sp.get("layer")),
    });

    return NextResponse.json(response);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/search GET] error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
