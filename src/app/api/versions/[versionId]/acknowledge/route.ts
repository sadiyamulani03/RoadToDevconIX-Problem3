import { NextResponse } from "next/server";
import { z } from "zod";
import { acknowledgeVersionIssue } from "@/lib/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AcknowledgeSchema = z.object({
  issueId: z.string().min(1),
  reviewer: z.string().min(1).max(120),
  note: z.string().min(3).max(2000),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ versionId: string }> }
) {
  const { versionId } = await context.params;
  try {
    const body = AcknowledgeSchema.parse(await request.json());
    const result = acknowledgeVersionIssue({ versionId, ...body });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({
      versionId: result.state.versionId,
      status: result.state.status,
      acknowledgements: result.state.acknowledgements,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Acknowledgement failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
