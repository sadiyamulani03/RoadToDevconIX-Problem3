import { NextResponse } from "next/server";
import { publishVersion } from "@/lib/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ versionId: string }> }
) {
  const { versionId } = await context.params;
  try {
    const outcome = publishVersion(versionId);
    if (!outcome.ok) {
      return NextResponse.json(
        {
          ok: false,
          gate: outcome.gate,
          status: outcome.state.status,
        },
        { status: 409 }
      );
    }
    return NextResponse.json({
      ok: true,
      gate: outcome.gate,
      status: outcome.state.status,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Publish failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
