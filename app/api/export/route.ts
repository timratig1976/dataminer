import { NextRequest, NextResponse } from "next/server";
import { getCase, listRows, listContactRows } from "@/lib/db";
import { isHiddenColumn, buildVisibleColOrder, getColumnLabel } from "@/lib/columns";

export async function GET(req: NextRequest) {
  const caseId = req.nextUrl.searchParams.get("caseId");
  const exportType = req.nextUrl.searchParams.get("type"); // "contacts" or default companies
  const colsParam = req.nextUrl.searchParams.get("cols");
  const requestedCols = colsParam ? colsParam.split(",") : null;
  if (!caseId) return NextResponse.json({ error: "caseId required" }, { status: 400 });

  const caseData = await getCase(caseId);
  if (!caseData) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const escape = (v: string | null) => {
    const s = v == null ? "" : String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };

  // ── Contacts CSV ──────────────────────────────────────────────────────────
  if (exportType === "contacts") {
    const contacts = await listContactRows(caseId);
    if (contacts.length === 0) {
      return new NextResponse("", {
        headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="${caseData.name}_contacts.csv"` },
      });
    }
    const CONTACT_CORE = ["company_name","first_name","last_name","position","email","email_extrapolated","phone","linkedin","domain","city","source"];
    const allDataKeys = new Set<string>();
    for (const c of contacts) Object.keys(c.data).forEach((k) => allDataKeys.add(k));
    const availableCols = [...CONTACT_CORE, ...[...allDataKeys].filter((k) => !k.startsWith("_") && !CONTACT_CORE.includes(k))]
      .filter((k) => contacts.some((c) => c.data[k] != null && c.data[k] !== ""));

    const headers = requestedCols && requestedCols.length > 0
      ? requestedCols.filter((k) => availableCols.includes(k))
      : availableCols;

    const lines = [
      headers.join(","),
      ...contacts.map((c) => headers.map((h) => escape(c.data[h] ?? null)).join(",")),
    ];
    return new NextResponse(lines.join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${caseData.name.replace(/[^a-z0-9]/gi, "_")}_contacts.csv"`,
      },
    });
  }

  // ── Companies CSV ──────────────────────────────────────────────────────────
  const rows = await listRows(caseId);
  if (rows.length === 0) {
    return new NextResponse("", {
      headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="${caseData.name}.csv"` },
    });
  }

  // Determine visible column order the same way the table does
  const allDataKeys = new Set<string>();
  for (const row of rows) {
    for (const k of Object.keys(row.data)) allDataKeys.add(k);
  }
  // Start from saved column order, fallback to source + AI keys
  const baseOrder = (caseData.colOrder?.length ? caseData.colOrder : [
    ...[...allDataKeys].filter((k) => !caseData.aiColumns.some((c) => c.outputKey === k) && !isHiddenColumn(k, caseData.aiColumns)),
    ...caseData.aiColumns.map((c) => c.outputKey),
  ]);
  const visibleOrder = buildVisibleColOrder(caseData, baseOrder);
  // Ensure any visible source/AI keys not in colOrder are still present at the end
  const visibleSet = new Set(visibleOrder);
  const fallbackKeys = [...allDataKeys]
    .filter((k) => !isHiddenColumn(k, caseData.aiColumns) && !visibleSet.has(k));
  const finalOrder = [...visibleOrder, ...fallbackKeys];

  const headers = requestedCols && requestedCols.length > 0
    ? requestedCols.filter((k) => finalOrder.includes(k))
    : finalOrder;

  if (headers.length === 0) {
    return new NextResponse("", {
      headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="${caseData.name}.csv"` },
    });
  }

  const lines = [
    headers.map((h) => getColumnLabel(h, caseData)).join(","),
    ...rows.map((r) => headers.map((h) => escape(r.data[h] ?? null)).join(",")),
  ];
  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${caseData.name.replace(/[^a-z0-9]/gi, "_")}.csv"`,
    },
  });
}
