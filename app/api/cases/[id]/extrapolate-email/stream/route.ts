import { NextRequest } from "next/server";
import { getCase, listRows, updateRowCell } from "@/lib/db";
import { extrapolateEmails, smtpVerifyEmail, learnPatterns } from "@/lib/email-extrapolator";

export const runtime = "nodejs";

/**
 * POST /api/cases/[id]/extrapolate-email/stream
 * SSE stream — processes rows in parallel batches, emits progress events.
 * Events: { type: "progress", rowId, email, status, confidence }
 *         { type: "done", processed, confirmed, skipped }
 *         { type: "error", message }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: caseId } = await params;
  const caseData = await getCase(caseId);
  if (!caseData) return new Response(JSON.stringify({ error: "Case not found" }), { status: 404 });

  const { verify = false, concurrency = 5, timeoutMs = 6000 } = await req.json().catch(() => ({}));

  const stream = new ReadableStream({
    async start(controller) {
      const push = (data: unknown) => {
        try { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)); }
        catch { /* closed */ }
      };

      try {
        const rows = await listRows(caseId);

        // Learn patterns from known personal emails
        const knownEmails = rows.flatMap(r => {
          const d = r.data as Record<string, string | null>;
          const email = d["contact_email"]?.trim() ?? "";
          const first = d["first_name"]?.trim() ?? "";
          const last  = d["last_name"]?.trim() ?? "";
          if (!email || !first || !last) return [];
          if (/^(info|kontakt|mail|office|service|support|noreply)/i.test(email)) return [];
          return [{ firstName: first, lastName: last, email }];
        });

        const learnedPatterns = learnPatterns(knownEmails);
        push({ type: "learned", patterns: learnedPatterns.map(p => `${p.pattern}(${p.count}x)`), known: knownEmails.length });

        // Filter candidates
        const candidates = rows.filter(r => {
          const d = r.data as Record<string, string | null>;
          return (d["first_name"]?.trim()) && (d["last_name"]?.trim()) &&
                 (d["domain"] ?? d["source_domain"])?.trim() && !d["contact_email"]?.trim();
        });

        push({ type: "start", total: candidates.length, verify });

        const stats = { processed: 0, confirmed: 0, skipped: 0, catchAll: 0 };

        // Process in batches of `concurrency`
        for (let i = 0; i < candidates.length; i += concurrency) {
          const batch = candidates.slice(i, i + concurrency);

          await Promise.all(batch.map(async row => {
            const d = row.data as Record<string, string | null>;
            const first = d["first_name"]!.trim();
            const last  = d["last_name"]!.trim();
            const domain = (d["domain"] ?? d["source_domain"] ?? "").trim();
            const company = d["company_name"] ?? "";

            const result = extrapolateEmails(first, last, domain, { maxCandidates: 5, learnedPatterns });
            if (!result.bestGuess) { stats.skipped++; return; }

            let bestEmail = result.bestGuess;
            let emailStatus: "extrapolated" | "confirmed" | "notfound" | "catchall" | "timeout" = "extrapolated";

            if (verify) {
              // Quick catch-all check with timeout
              const fakeResult = await Promise.race([
                smtpVerifyEmail(`xnouser${Math.random().toString(36).slice(2, 8)}@${domain}`),
                new Promise<{ exists: null; catchAll: null; code: 0; message: string }>(r =>
                  setTimeout(() => r({ exists: null, catchAll: null, code: 0, message: "timeout" }), timeoutMs)
                )
              ]);

              if (fakeResult.message === "timeout") {
                emailStatus = "timeout";
              } else if (fakeResult.catchAll === true || fakeResult.exists === true) {
                emailStatus = "catchall";
                stats.catchAll++;
              } else {
                // Not catch-all — try candidates
                let found = false;
                for (const c of result.candidates.slice(0, 3)) {
                  const v = await Promise.race([
                    smtpVerifyEmail(c.email),
                    new Promise<{ exists: null; catchAll: null; code: 0; message: string }>(r =>
                      setTimeout(() => r({ exists: null, catchAll: null, code: 0, message: "timeout" }), timeoutMs)
                    )
                  ]);
                  if (v.exists === true) {
                    bestEmail = c.email;
                    emailStatus = "confirmed";
                    stats.confirmed++;
                    found = true;
                    await updateRowCell(row.id, "contact_email", bestEmail, "done");
                    break;
                  } else if (v.exists === false) {
                    continue; // try next pattern
                  }
                }
                if (!found && emailStatus === "extrapolated") emailStatus = "extrapolated";
              }
            }

            await updateRowCell(row.id, "email_extrapolated", bestEmail, "done");
            await updateRowCell(row.id, "email_confidence", emailStatus === "confirmed" ? "verified" : result.confidence, "done");
            stats.processed++;

            push({ type: "progress", rowId: row.id, company: company.slice(0, 35), email: bestEmail, status: emailStatus, confidence: result.confidence });
          }));
        }

        push({ type: "done", ...stats, total: candidates.length });
      } catch (e) {
        push({ type: "error", message: (e as Error).message });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
