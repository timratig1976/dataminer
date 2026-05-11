import { NextResponse } from "next/server";
import { DEFAULT_PRESETS } from "@/lib/ai";

export async function GET() {
  return NextResponse.json(DEFAULT_PRESETS);
}
