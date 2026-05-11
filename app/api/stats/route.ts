import { NextResponse } from "next/server";
import { listCases, listRows } from "@/lib/db";

export async function GET() {
  const cases = listCases();

  let totalRows = 0;
  let totalCells = 0;
  let doneCells = 0;
  let errorCells = 0;
  let totalCostUsd = 0;

  const caseStats = cases.map((c) => {
    const rows = listRows(c.id);
    const aiKeys = c.aiColumns.map((col) => col.outputKey);
    let caseDone = 0;
    let caseError = 0;
    let caseCost = 0;

    for (const row of rows) {
      for (const key of aiKeys) {
        const status = row.cellStatuses[key];
        if (status === "done") caseDone++;
        if (status === "error") caseError++;
        const costKey = `_llm_cost_${key}`;
        const costVal = row.data[costKey];
        if (costVal) caseCost += parseFloat(costVal) || 0;
      }
      // Sum costs from all _llm_cost_ keys in this row
    }

    totalRows += rows.length;
    totalCells += rows.length * aiKeys.length;
    doneCells += caseDone;
    errorCells += caseError;
    totalCostUsd += caseCost;

    return {
      id: c.id,
      name: c.name,
      rowCount: rows.length,
      aiColumnCount: c.aiColumns.length,
      doneCells: caseDone,
      errorCells: caseError,
      costUsd: caseCost,
      updatedAt: c.updatedAt,
    };
  });

  return NextResponse.json({
    totalCases: cases.length,
    totalRows,
    totalCells,
    doneCells,
    errorCells,
    totalCostUsd,
    cases: caseStats,
  });
}
