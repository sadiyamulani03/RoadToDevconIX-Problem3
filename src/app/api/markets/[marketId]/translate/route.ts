import { NextResponse } from "next/server";
import { z } from "zod";
import { TARGET_LANGUAGES } from "@/lib/languages";
import { translateMarketVersion } from "@/lib/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TranslateRequestSchema = z.object({
  languages: z.array(z.enum(TARGET_LANGUAGES)).min(1).optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ marketId: string }> }
) {
  const { marketId } = await context.params;
  try {
    let languages: ("hi" | "mr" | "ta")[] | undefined;
    const rawBody = await request.text();
    if (rawBody.trim().length > 0) {
      languages = TranslateRequestSchema.parse(JSON.parse(rawBody)).languages;
    }
    const result = await translateMarketVersion(marketId, languages ?? TARGET_LANGUAGES);
    return NextResponse.json({
      marketId: result.marketId,
      provider: result.provider,
      versions: result.versions.map((version) => ({
        versionId: version.versionId,
        language: version.language,
        status: version.status,
        error: version.error,
        validation: version.validation
          ? {
              status: version.validation.status,
              invariantsChecked: version.validation.invariantsChecked,
              invariantsMatched: version.validation.invariantsMatched,
              blockingIssueCount: version.validation.blockingIssueCount,
              reviewIssueCount: version.validation.reviewIssueCount,
            }
          : undefined,
      })),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Translation request failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
