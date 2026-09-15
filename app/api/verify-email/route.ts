import { NextRequest, NextResponse } from "next/server";
import { smtpVerifyEmail } from "@/lib/email-extrapolator";

/**
 * POST /api/verify-email
 * Body: { email: string }
 * Returns SMTP verification result (no email sent).
 */
export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "email required" }, { status: 400 });
    }
    const result = await smtpVerifyEmail(email.trim());
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
