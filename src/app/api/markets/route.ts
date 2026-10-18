import { NextResponse } from "next/server";
import { MarketDraftSchema } from "@/lib/market-schema";
import { createMarket, listMarketSummaries } from "@/lib/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ markets: listMarketSummaries() });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const draft = MarketDraftSchema.parse(body);
    const market = createMarket(draft);
    return NextResponse.json({ market }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid market payload.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
