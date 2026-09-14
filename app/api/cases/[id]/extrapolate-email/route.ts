import { NextRequest, NextResponse } from "next/server";
import { getCase, getRow, updateRowCell, listRows } from "@/lib/db";
import { extrapolateEmails, smtpVerifyEmail, learnPatterns, derivePattern } from "@/lib/email-extrapolator";

export const runtime = "nodejs";

/**
 * POST /api/cases/[id]/extrapolate-email
 *
 * For a given row: generate email candidates from name+domain,
 * optionally verify via SMTP, store best guess + confidence.
 *
 * Body: { rowId, verify?: boolean }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: caseId } = await params;

  const caseData = await getCase(caseId);
  if (!caseData) return NextResponse.json({ error: "Case not found" }, { status: 404 });

  const { rowId, verify = false } = await req.json();
  if (!rowId) return NextResponse.json({ error: "rowId required" }, { status: 400 });

  const row = await getRow(rowId);
  if (!row) return NextResponse.json({ error: "Row not found" }, { status: 404 });

  const d = row.data as Record<string, string | null>;
  const firstName = d["first_name"]?.trim() ?? "";
  const lastName = d["last_name"]?.trim() ?? "";
  const domain = (d["domain"] ?? d["source_domain"] ?? "").trim();
  const existingPersonalEmail = d["contact_email"]?.trim() ?? "";

  if (!firstName || !lastName) {
    return NextResponse.json({ error: "No contact name in this row" }, { status: 400 });
  }
  if (!domain) {
    return NextResponse.json({ error: "No domain in this row" }, { status: 400 });
  }
  if (existingPersonalEmail) {
    return NextResponse.json({
      skipped: true,
      reason: "Row already has a personal email",
      email: existingPersonalEmail,
    });
  }

  // 1. Generate candidates
  const result = extrapolateEmails(firstName, lastName, domain, { maxCandidates: 5 });

  if (!result.bestGuess) {
    return NextResponse.json({
      success: false,
      reason: result.note ?? "Could not generate candidates",
      candidates: [],
    });
  }

  let bestEmail = result.bestGuess;
  let confidence = result.confidence;
  let verifyResults: Array<{ email: string; exists: boolean | null; code: number }> = [];

  // 2. Optional SMTP verification
  if (verify && result.candidates.length > 0) {
    // Check top 3 candidates
    const toVerify = result.candidates.slice(0, 3);
    for (const c of toVerify) {
      const v = await smtpVerifyEmail(c.email);
      verifyResults.push({ email: c.email, exists: v.exists, code: v.code });
      if (v.exists === true) {
        bestEmail = c.email;
        confidence = "high";
        break;
      }
    }
    // If SMTP says none exist definitively, keep best guess but lower confidence
    if (verifyResults.every(v => v.exists === false)) {
      confidence = "low";
    }
  }

  // 3. Store result in row
  await updateRowCell(rowId, "email_extrapolated", bestEmail, "done");
  await updateRowCell(rowId, "email_confidence", confidence, "done");
  if (confidence === "high" && verify) {
    // If verified, also write to contact_email
    await updateRowCell(rowId, "contact_email", bestEmail, "done");
  }

  return NextResponse.json({
    success: true,
    email: bestEmail,
    confidence,
    candidates: result.candidates,
    verified: verify,
    verifyResults: verify ? verifyResults : undefined,
  });
}

/**
 * POST /api/cases/[id]/extrapolate-email/batch
 * Run for all rows that have name+domain but no personal email
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: caseId } = await params;
  const caseData = await getCase(caseId);
  if (!caseData) return NextResponse.json({ error: "Case not found" }, { status: 404 });

  const { verify = false } = await req.json().catch(() => ({}));

  const rows = await listRows(caseId);

  // ── Step 1: Learn patterns from known personal emails in this case ──────
  const knownEmails = rows
    .map(r => {
      const d = r.data as Record<string, string | null>;
      const email = d["contact_email"]?.trim() ?? "";
      const first = d["first_name"]?.trim() ?? "";
      const last  = d["last_name"]?.trim() ?? "";
      if (!email || !first || !last) return null;
      if (/^(info|kontakt|mail|office|service|support|noreply)/i.test(email)) return null;
      return { firstName: first, lastName: last, email };
    })
    .filter(Boolean) as Array<{ firstName: string; lastName: string; email: string }>;

  const learnedPatterns = learnPatterns(knownEmails);
  console.log(`[extrapolate-email] Learned ${learnedPatterns.length} patterns from ${knownEmails.length} known emails:`, learnedPatterns.slice(0,3).map(p => `${p.pattern}(${p.count}x)`));

  // ── Step 2: For each row with name+domain but no personal email ──────────
  const results = { processed: 0, skipped: 0, generated: 0, verified: 0, confirmed: 0 };

  for (const row of rows) {
    const d = row.data as Record<string, string | null>;
    const first = d["first_name"]?.trim() ?? "";
    const last  = d["last_name"]?.trim() ?? "";
    const domain = (d["domain"] ?? d["source_domain"] ?? "").trim();
    const existing = d["contact_email"]?.trim() ?? "";

    if (!first || !last || !domain || existing) { results.skipped++; continue; }

    // Generate candidates using learned pattern order
    const result = extrapolateEmails(first, last, domain, {
      maxCandidates: 5,
      learnedPatterns,
    });

    if (!result.bestGuess) { results.skipped++; continue; }

    let bestEmail = result.bestGuess;
    let confidence = result.confidence;
    let verified = false;

    // ── Step 3: SMTP verify top candidates ────────────────────────────────
    if (verify && result.candidates.length > 0) {
      // Check catch-all first with fake email
      const fakeDomain = domain.replace(/^www\./, "");
      const fakeCheck = await smtpVerifyEmail(`xnoreply-${Math.random().toString(36).slice(2)}@${fakeDomain}`);

      if (!fakeCheck.catchAll) {
        // Not catch-all — verify each candidate until we find one that exists
        for (const c of result.candidates.slice(0, 4)) {
          const v = await smtpVerifyEmail(c.email);
          if (v.exists === true) {
            bestEmail = c.email;
            confidence = "high";
            verified = true;
            results.confirmed++;
            // Write to contact_email since it's confirmed
            await updateRowCell(row.id, "contact_email", bestEmail, "done");
            break;
          } else if (v.exists === false) {
            // Definitively doesn't exist — try next
            continue;
          }
          // null = inconclusive, try next
        }
        results.verified++;
      }
    }

    await updateRowCell(row.id, "email_extrapolated", bestEmail, "done");
    await updateRowCell(row.id, "email_confidence", verified ? "verified" : confidence, "done");
    results.generated++;
    results.processed++;
  }

  return NextResponse.json({
    ...results,
    learnedPatterns: learnedPatterns.map(p => `${p.pattern}(${p.count}x)`),
  });
}
