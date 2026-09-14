/**
 * lib/email-extrapolator.ts
 * Extrapolates likely email addresses from contact name + domain.
 *
 * Strategy:
 *   1. Generate all common patterns (firstname.lastname@, f.lastname@, etc.)
 *   2. Handle German special chars (ä→ae, ö→oe, ü→ue, ß→ss)
 *   3. Optional: SMTP RCPT TO verify (no email sent, just handshake)
 *   4. Return ranked candidates with confidence scores
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EmailCandidate {
  email: string;
  pattern: string;       // e.g. "firstname.lastname"
  confidence: "high" | "medium" | "low";
  verified?: boolean;    // true if SMTP confirmed
}

export interface ExtrapolationResult {
  candidates: EmailCandidate[];
  bestGuess: string | null;
  confidence: "high" | "medium" | "low" | "none";
  note?: string;
}

// ── German char normalization ─────────────────────────────────────────────────

function normalizeGerman(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9.-]/g, "");   // strip anything non-ASCII
}

function normalizeSimple(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9.-]/g, "");
}

// ── Pattern definitions — ordered by priority (overridden by learned patterns) ──

interface PatternDef {
  name: string;
  confidence: "high" | "medium" | "low";
  build: (fi: string, fn: string, ln: string) => string;
}

// Default order — will be re-ranked by learnedPatternOrder if available
const PATTERNS: PatternDef[] = [
  { name: "firstname.lastname",   confidence: "high",   build: (_,fn,ln) => `${fn}.${ln}` },
  { name: "f.lastname",           confidence: "high",   build: (fi,_,ln) => `${fi}.${ln}` },
  { name: "lastname",             confidence: "medium", build: (_,__,ln) => ln },
  { name: "firstname",            confidence: "medium", build: (_,fn)    => fn },
  { name: "firstnamelastname",    confidence: "medium", build: (_,fn,ln) => `${fn}${ln}` },
  { name: "f_lastname",           confidence: "low",    build: (fi,_,ln) => `${fi}_${ln}` },
  { name: "flastname",            confidence: "low",    build: (fi,_,ln) => `${fi}${ln}` },
  { name: "firstname_lastname",   confidence: "low",    build: (_,fn,ln) => `${fn}_${ln}` },
  { name: "lastname.firstname",   confidence: "low",    build: (_,fn,ln) => `${ln}.${fn}` },
];

// ── Pattern learning ──────────────────────────────────────────────────────────

export interface LearnedPattern {
  pattern: string;
  count: number;
  examples: string[];
}

/**
 * Derive the email pattern from a known email + contact name.
 * Returns pattern name like "f.lastname", "firstname.lastname", etc.
 */
export function derivePattern(firstName: string, lastName: string, email: string): string | null {
  const local = email.split("@")[0].toLowerCase();
  const fn = normalizeSimple(firstName.trim());
  const ln = normalizeSimple(lastName.trim());
  const fnDe = normalizeGerman(firstName.trim());
  const lnDe = normalizeGerman(lastName.trim());
  const fi = fn[0] ?? "";
  const fiDe = fnDe[0] ?? "";

  // Check all variants (regular + german)
  for (const [fnV, lnV, fiV] of [[fn, ln, fi], [fnDe, lnDe, fiDe]]) {
    if (local === `${fnV}.${lnV}`) return "firstname.lastname";
    if (local === `${fiV}.${lnV}`) return "f.lastname";
    if (local === lnV) return "lastname";
    if (local === fnV) return "firstname";
    if (local === `${fnV}${lnV}`) return "firstnamelastname";
    if (local === `${fiV}${lnV}`) return "flastname";
    if (local === `${fnV}_${lnV}`) return "firstname_lastname";
    if (local === `${fiV}_${lnV}`) return "f_lastname";
    if (local === `${lnV}.${fnV}`) return "lastname.firstname";
  }
  return null; // unknown pattern
}

/**
 * Learn email patterns from a set of known emails.
 * Returns patterns sorted by frequency.
 */
export function learnPatterns(
  knownEmails: Array<{ firstName: string; lastName: string; email: string }>
): LearnedPattern[] {
  const counts = new Map<string, { count: number; examples: string[] }>();

  for (const { firstName, lastName, email } of knownEmails) {
    if (!firstName || !lastName || !email) continue;
    const pattern = derivePattern(firstName, lastName, email);
    if (!pattern) continue;
    const entry = counts.get(pattern) ?? { count: 0, examples: [] };
    entry.count++;
    if (entry.examples.length < 3) entry.examples.push(email);
    counts.set(pattern, entry);
  }

  return Array.from(counts.entries())
    .map(([pattern, { count, examples }]) => ({ pattern, count, examples }))
    .sort((a, b) => b.count - a.count);
}

// ── Main function ─────────────────────────────────────────────────────────────

export function extrapolateEmails(
  firstName: string,
  lastName: string,
  domain: string,
  options: {
    maxCandidates?: number;
    includeGermanVariants?: boolean;
    learnedPatterns?: LearnedPattern[];   // from learnPatterns() on known emails in the case
  } = {}
): ExtrapolationResult {
  const { maxCandidates = 5, includeGermanVariants = true, learnedPatterns } = options;

  if (!firstName.trim() || !lastName.trim() || !domain.trim()) {
    return { candidates: [], bestGuess: null, confidence: "none", note: "Missing name or domain" };
  }

  const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase().trim();
  if (!cleanDomain.includes(".")) {
    return { candidates: [], bestGuess: null, confidence: "none", note: "Invalid domain" };
  }

  const SKIP_DOMAINS = ["kleinanzeigen.de", "firmenabc.com", "trustlocal.de", "regional.de", "mapquest.com", "zvshk.de", "installateur-mv.de", "hls-portal.de", "northdata.de", "wlw.de", "gelbeseiten.de"];
  if (SKIP_DOMAINS.some(d => cleanDomain.endsWith(d) || cleanDomain === d)) {
    return { candidates: [], bestGuess: null, confidence: "none", note: `Catalog domain — email patterns not applicable` };
  }

  const fn = normalizeSimple(firstName.trim());
  const ln = normalizeSimple(lastName.trim());
  const fnDe = normalizeGerman(firstName.trim());
  const lnDe = normalizeGerman(lastName.trim());
  const fi = fn[0] ?? "";
  const fiDe = fnDe[0] ?? "";

  // Re-rank patterns based on learned data
  let orderedPatterns = [...PATTERNS];
  if (learnedPatterns && learnedPatterns.length > 0) {
    const learnedOrder = learnedPatterns.map(l => l.pattern);
    orderedPatterns.sort((a, b) => {
      const ai = learnedOrder.indexOf(a.name);
      const bi = learnedOrder.indexOf(b.name);
      // Learned patterns come first (by frequency rank), unknown patterns last
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
    // Top learned pattern gets "high" confidence
    if (learnedOrder.length > 0) {
      for (const p of orderedPatterns) {
        p.confidence = learnedOrder.indexOf(p.name) === 0 ? "high"
          : learnedOrder.indexOf(p.name) <= 1 ? "medium" : "low";
      }
    }
  }

  const seen = new Set<string>();
  const candidates: EmailCandidate[] = [];

  for (const pat of orderedPatterns) {
    if (candidates.length >= maxCandidates) break;
    const localPart = pat.build(fi, fn, ln);
    const email = `${localPart}@${cleanDomain}`;
    if (!seen.has(email) && localPart.length >= 2) {
      seen.add(email);
      candidates.push({ email, pattern: pat.name, confidence: pat.confidence });
    }
    if (includeGermanVariants && (fn !== fnDe || ln !== lnDe)) {
      const localDe = pat.build(fiDe, fnDe, lnDe);
      const emailDe = `${localDe}@${cleanDomain}`;
      if (!seen.has(emailDe) && localDe.length >= 2 && candidates.length < maxCandidates) {
        seen.add(emailDe);
        candidates.push({ email: emailDe, pattern: `${pat.name} (de)`, confidence: pat.confidence });
      }
    }
  }

  if (candidates.length === 0) {
    return { candidates: [], bestGuess: null, confidence: "none" };
  }

  return { candidates, bestGuess: candidates[0].email, confidence: candidates[0].confidence };
}


// ── SMTP verification (optional, no email sent) ───────────────────────────────

/**
 * Verify email existence via SMTP RCPT TO handshake.
 * Connects to the domain's MX server, sends EHLO + MAIL FROM + RCPT TO,
 * reads the response code. 250 = exists, 550 = not found.
 *
 * NOTE: Many servers block this (greylisting, catch-all). Use as hint only.
 */
export async function smtpVerifyEmail(email: string): Promise<{
  exists: boolean | null;  // null = inconclusive
  catchAll: boolean | null; // true = server accepts everything
  code: number;
  message: string;
}> {
  try {
    const domain = email.split("@")[1];
    if (!domain) return { exists: null, catchAll: null, code: 0, message: "Invalid email" };

    const { resolveMx } = await import("dns/promises");
    const mxRecords = await resolveMx(domain).catch(() => []);
    if (mxRecords.length === 0) return { exists: null, catchAll: null, code: 0, message: "No MX record" };

    const mxHost = mxRecords.sort((a, b) => a.priority - b.priority)[0].exchange;

    // Helper: single RCPT TO check
    async function rcptCheck(addr: string): Promise<{ code: number; message: string }> {
      const net = await import("net");
      return new Promise((resolve) => {
        const socket = net.createConnection({ host: mxHost, port: 25, timeout: 8000 });
        let step = 0, buffer = "";
        const send = (cmd: string) => socket.write(`${cmd}\r\n`);
        socket.on("timeout", () => { socket.destroy(); resolve({ code: 0, message: "Timeout" }); });
        socket.on("error", (err) => resolve({ code: 0, message: err.message }));
        socket.on("data", (data) => {
          buffer += data.toString();
          const lines = buffer.split("\r\n"); buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line) continue;
            const code = parseInt(line.slice(0, 3), 10);
            if (step === 0 && code === 220) { send("EHLO dataminer.verify"); step++; }
            else if (step === 1 && code >= 200 && code < 300) { send("MAIL FROM:<verify@dataminer.app>"); step++; }
            else if (step === 2 && code >= 200 && code < 300) { send(`RCPT TO:<${addr}>`); step++; }
            else if (step === 3) { socket.destroy(); resolve({ code, message: line }); return; }
            else if (code >= 400) { socket.destroy(); resolve({ code, message: line }); return; }
          }
        });
        socket.on("close", () => { if (step < 3) resolve({ code: 0, message: "Connection closed" }); });
      });
    }

    // 1. Check catch-all with a random impossible address
    const fakeAddr = `xnoreply-${Math.random().toString(36).slice(2, 10)}@${domain}`;
    const fakeResult = await rcptCheck(fakeAddr);
    const isCatchAll = fakeResult.code === 250 || fakeResult.code === 251;

    if (isCatchAll) {
      // Can't determine existence — server accepts everything
      return { exists: null, catchAll: true, code: fakeResult.code, message: "Catch-all server — cannot verify" };
    }

    // 2. Check actual email
    const realResult = await rcptCheck(email);
    const exists = realResult.code === 250 || realResult.code === 251
      ? true
      : realResult.code >= 550 && realResult.code < 560
      ? false
      : null;

    return { exists, catchAll: false, code: realResult.code, message: realResult.message };
  } catch (e) {
    return { exists: null, catchAll: null, code: 0, message: (e as Error).message };
  }
}
