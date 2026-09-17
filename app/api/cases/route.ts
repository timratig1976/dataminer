import { NextRequest, NextResponse } from "next/server";
import { listCases, createCase } from "@/lib/db";
import { randomUUID } from "crypto";
import { getTemplate } from "@/lib/templates";
import type { Case } from "@/lib/types";

function sanitizeCase(c: Case) {
  return {
    ...c,
    edenApiKey: undefined,
  };
}

export async function GET() {
  try {
    const cases = await listCases();
    return NextResponse.json(cases.map(sanitizeCase));
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Resolve template if specified; default to "standard" unless explicitly
    // opted out via template: null or template: "none" (Leerer Case)
    let aiColumns: import("@/lib/types").AiColumn[] = body.aiColumns || [];
    let colOrder: string[] = [];
    if (!body.aiColumns) {
      const templateId = body.template === undefined ? "standard" : body.template;
      if (templateId && templateId !== "none") {
        const tpl = getTemplate(templateId);
        if (tpl) {
          aiColumns = tpl.aiColumns;
          // Optimal column order (proven in production):
          // domain → Firmendaten-KI → company_name → industry → address → zip → city
          // → description → phone → email → employees → founded
          // → maps_rating → category → maps_reviews → Entscheider-KI
          const batchCompany = aiColumns.find((c) => c.tool === "batch_company");
          const batchContacts = aiColumns.find((c) => c.tool === "batch_contact");
          const vilocalAudit = aiColumns.find((c) => c.outputKey === "vilocal_audit");
          colOrder = [
            "domain",
            ...(batchCompany ? [batchCompany.outputKey] : []),
            "company_name",
            "industry",
            "address",
            "zip",
            "city",
            "description",
            "phone",
            "email",
            "employees",
            "founded",
            "maps_rating",
            "category",
            "maps_reviews",
            "maps_url",
            ...(vilocalAudit ? [vilocalAudit.outputKey] : []),
            ...(batchContacts ? [batchContacts.outputKey] : []),
          ];
        }
      }
    }

    const c = await createCase({
      id: randomUUID(),
      name: body.name || "New Case",
      aiColumns,
      colOrder,
      edenApiKey: body.edenApiKey,
    });
    return NextResponse.json(sanitizeCase(c), { status: 201 });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
