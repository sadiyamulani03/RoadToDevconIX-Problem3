import { NextResponse } from "next/server";
import { revalidateVersionById } from "@/lib/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ versionId: string }> }
) {
  const { versionId } = await context.params;
  try {
    const version = revalidateVersionById(versionId);
    return NextResponse.json({
      versionId: version.versionId,
      status: version.status,
      validation: version.validation,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Revalidation failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
