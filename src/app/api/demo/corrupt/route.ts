import { NextResponse } from "next/server";
import { z } from "zod";
import { TARGET_LANGUAGES } from "@/lib/languages";
import { injectDemoCorruption } from "@/lib/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CorruptSchema = z.object({
  marketId: z.string().min(1),
  language: z.enum(TARGET_LANGUAGES),
  kind: z.enum(["date_shift", "magnitude_shift", "percent_shift"]),
});

/**
 * Demonstrates the whole point of the tool: a plausible-looking translation
 * error is injected into the current text, the previous verification is
 * invalidated, and revalidating must block publication.
 */
export async function POST(request: Request) {
  try {
    const body = CorruptSchema.parse(await request.json());
    const result = injectDemoCorruption(body);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({
      ok: true,
      kind: result.kind,
      field: result.field,
      from: result.from,
      to: result.to,
      versionId: result.state?.versionId,
      status: result.state?.status,
      next: "POST /api/versions/{versionId}/revalidate to see the gate catch it.",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Corruption demo failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
