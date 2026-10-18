import { NextResponse } from "next/server";
import { store } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ marketId: string }> }
) {
  const { marketId } = await context.params;
  if (!store.getMarket(marketId)) {
    return NextResponse.json(
      { error: `Unknown market "${marketId}".` },
      { status: 404 }
    );
  }
  return NextResponse.json({ events: store.auditFor(marketId) });
}
