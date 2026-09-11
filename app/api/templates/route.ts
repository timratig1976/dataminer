import { NextResponse } from "next/server";
import { PROJECT_TEMPLATES } from "@/lib/templates";

export async function GET() {
  return NextResponse.json(PROJECT_TEMPLATES);
}