import { NextRequest, NextResponse } from "next/server";
import { getApolloAdapter, shutdownApolloAdapter, lookupApolloContacts, ApolloBudget } from "@/lib/apollo";

/**
 * GET  /api/apollo/smoke — check transport health + list available tools
 * POST /api/apollo/smoke — additionally run a test people search
 *   body: { companyName?, domain?, limit? , shutdown?: boolean }
 */
export async function GET() {
  try {
    if (!process.env.APOLLO_API_KEY?.trim()) {
      return NextResponse.json({ ok: false, error: "APOLLO_API_KEY not configured" }, { status: 200 });
    }
    const adapter = await getApolloAdapter();
    const health = await adapter.smoke();
    return NextResponse.json(health);
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.APOLLO_API_KEY?.trim()) {
      return NextResponse.json({ ok: false, error: "APOLLO_API_KEY not configured" }, { status: 200 });
    }
    const body = (await req.json().catch(() => ({}))) as {
      companyName?: string;
      domain?: string;
      limit?: number;
      shutdown?: boolean;
    };

    const adapter = await getApolloAdapter();
    const health = await adapter.smoke();
    if (!health.ok) return NextResponse.json(health);

    let test = undefined;
    if (body.companyName || body.domain) {
      try {
        const result = await lookupApolloContacts(
          { companyName: body.companyName, domain: body.domain, limit: body.limit ?? 3 },
          new ApolloBudget(5)
        );
        test = {
          ok: true,
          fromCache: result.fromCache,
          transport: result.transport,
          contacts: result.contacts.slice(0, 5).map((c) => ({
            name: c.name,
            title: c.title,
            organisation: c.organisation,
            emailStatus: c.emailStatus,
          })),
          count: result.contacts.length,
        };
      } catch (e) {
        test = { ok: false, error: (e as Error).message };
      }
    }

    if (body.shutdown) await shutdownApolloAdapter();
    return NextResponse.json({ ...health, test });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
