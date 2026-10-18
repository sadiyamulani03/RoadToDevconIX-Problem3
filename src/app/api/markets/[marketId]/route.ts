import { NextResponse } from "next/server";
import { getMarketDetail } from "@/lib/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ marketId: string }> }
) {
  const { marketId } = await context.params;
  const detail = getMarketDetail(marketId);
  if (!detail) {
    return NextResponse.json(
      { error: `Unknown market "${marketId}".` },
      { status: 404 }
    );
  }
  return NextResponse.json(detail);
}
