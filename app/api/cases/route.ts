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
          // Order: [Eingabe] → [🏢 Aktion] → [Firmen-Ergebnis] → [👤 Aktion] → [Kontakt-Ergebnis]
          const companyInputKeys = ["company_name", "domain"];
          const companyOutputKeys = ["phone", "company_email", "address", "city", "zip", "industry", "description", "employees", "founded"];
          const contactOutputKeys = ["first_name", "last_name", "position", "contact_email", "linkedin"];
          const batchCompany = aiColumns.find((c) => c.tool === "batch_enrich");
          const batchContacts = aiColumns.find((c) => c.tool === "batch_contacts");
          colOrder = [
            ...companyInputKeys,
            ...(batchCompany ? [batchCompany.outputKey] : []),
            ...companyOutputKeys,
            ...(batchContacts ? [batchContacts.outputKey] : []),
            ...contactOutputKeys,
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
