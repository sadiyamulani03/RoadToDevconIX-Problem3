import { NextResponse } from "next/server";
import { z } from "zod";
import { MARKET_FIELDS } from "@/lib/market-schema";
import { editVersion, getVersionDetail } from "@/lib/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ versionId: string }> }
) {
  const { versionId } = await context.params;
  const detail = getVersionDetail(versionId);
  if (!detail) {
    return NextResponse.json(
      { error: `Unknown version "${versionId}".` },
      { status: 404 }
    );
  }
  return NextResponse.json(detail);
}

const EditSchema = z.object({
  field: z.enum(MARKET_FIELDS),
  text: z.string().min(1).max(12000),
  editor: z.string().min(1).max(120).default("reviewer"),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ versionId: string }> }
) {
  const { versionId } = await context.params;
  try {
    const body = EditSchema.parse(await request.json());
    const version = editVersion({ versionId, ...body });
    return NextResponse.json({
      versionId: version.versionId,
      status: version.status,
      revision: version.revision,
      currentHash: version.currentHash,
      note: "Edit recorded. The previous verification is invalidated until revalidation runs.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Edit failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
