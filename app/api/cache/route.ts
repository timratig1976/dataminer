import { NextRequest, NextResponse } from "next/server";
import { getDb, initDb, getCachedScrape } from "@/lib/db";
import { scrapeCache } from "@/lib/db/schema";
import { ilike, or } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const domain = req.nextUrl.searchParams.get("domain");
  if (!domain) return NextResponse.json({ error: "domain required" }, { status: 400 });

  await initDb();
  const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
  
  // Find all cache entries matching this domain (homepage, impressum, etc.)
  const entries = await getDb()
    .select({
      url: scrapeCache.url,
      markdown: scrapeCache.markdown,
      title: scrapeCache.title,
      fetchedAt: scrapeCache.fetchedAt,
    })
    .from(scrapeCache)
    .where(
      or(
        ilike(scrapeCache.url, `%${cleanDomain}%`)
      )
    );

  return NextResponse.json({
    domain: cleanDomain,
    entries: entries.map((e) => ({
      url: e.url,
      title: e.title,
      length: e.markdown?.length ?? 0,
      markdown: e.markdown,
      fetchedAt: e.fetchedAt,
    })),
  });
}
