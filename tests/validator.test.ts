import { describe, expect, it } from "vitest";
import { getSampleMarket } from "@/lib/sample-markets";
import { createFixtureProvider } from "@/lib/translation";
import { translateMarket } from "@/lib/translation/pipeline";
import type {
  MarketSource,
  TranslatedMarket,
} from "@/lib/market-schema";
import { validateTranslation } from "@/lib/invariants/invariant-validator";
import { deriveStatus, createVersionState } from "@/lib/review-workflow";

async function translate(
  marketId: string,
  language: "hi" | "ta" | "mr"
): Promise<{ market: MarketSource; translated: TranslatedMarket }> {
  const market = getSampleMarket(marketId)!;
  const provider = createFixtureProvider();
  const result = await translateMarket(market, {
    provider,
    languages: [language],
  });
  const languageResult = result.languages[0];
  if (!languageResult.translated) {
    throw new Error(`fixture missing for ${marketId}.${language}`);
  }
  return { market, translated: languageResult.translated };
}

function report(market: MarketSource, translated: TranslatedMarket) {
  return validateTranslation({ market, translated });
}

describe("deterministic translation validation", () => {
  it("verifies a correct fixture with every fact matched", async () => {
    const { market, translated } = await translate("rbi-rate-cut-2027", "hi");
    const result = report(market, translated);
    expect(result.status).toBe("verified");
    expect(result.invariantsChecked).toBeGreaterThanOrEqual(9);
    expect(result.invariantsMatched).toBe(result.invariantsChecked);
    expect(result.blockingIssueCount).toBe(0);
    expect(result.scope).toContain("NOT verified");
  });

  it("when a date changes", async () => {
    const { market, translated } = await translate("rbi-rate-cut-2027", "hi");
    const mutated: TranslatedMarket = {
      ...translated,
      title: translated.title.replace("१५ जून २०२७", "१६ जून २०२७"),
    };
    const result = report(market, mutated);
    expect(result.status).toBe("blocked");
    expect(
      result.issues.some(
        (issue) => issue.code === "changed_value" && issue.severity === "blocking"
      )
    ).toBe(true);
    expect(result.issues[0].message).toContain("Publication blocked");
  });

  it("catches a changed unit even when the number is identical", async () => {
    const { market, translated } = await translate("monsoon-onset-kerala-2027", "hi");
    const mutated: TranslatedMarket = {
      ...translated,
      resolutionRules: translated.resolutionRules.replace("मिमी", "सेमी"),
    };
    const result = report(market, mutated);
    expect(result.status).toBe("blocked");
    expect(result.issues.some((issue) => issue.code === "changed_unit")).toBe(true);
  });

  it("catches a before -> by deadline relation change", async () => {
    const { market, translated } = await translate("rbi-rate-cut-2027", "hi");
    const mutated: TranslatedMarket = {
      ...translated,
      title: translated.title.replace("से पहले", "तक"),
    };
    const result = report(market, mutated);
    expect(result.status).toBe("blocked");
    const issue = result.issues.find(
      (candidate) => candidate.code === "deadline_relation_changed"
    );
    expect(issue?.severity).toBe("blocking");
    expect(issue?.message).toContain("Before");
  });

  it("treats a missing deadline word as human review, not a pass and not a block", async () => {
    const { market, translated } = await translate("rbi-rate-cut-2027", "hi");
    const mutated: TranslatedMarket = {
      ...translated,
      title: translated.title.replace(" से पहले", ""),
    };
    const result = report(market, mutated);
    expect(result.status).toBe("needs_review");
    const issue = result.issues.find(
      (candidate) => candidate.code === "deadline_relation_unverified"
    );
    expect(issue?.severity).toBe("review");
    expect(issue?.suggestion).toContain("acknowledge");
  });

  it("flags a protected value that vanished from the translation", async () => {
    const { market, translated } = await translate("rbi-rate-cut-2027", "hi");
    const mutated: TranslatedMarket = {
      ...translated,
      question: translated.question.replace("१५ जून २०२७", "जून"),
    };
    const result = report(market, mutated);
    expect(result.status).toBe("blocked");
    expect(result.issues.some((issue) => issue.code === "missing_invariant")).toBe(true);
  });

  it("flags a fact the translator invented", async () => {
    const { market, translated } = await translate("rbi-rate-cut-2027", "hi");
    const mutated: TranslatedMarket = {
      ...translated,
      resolutionRules: `${translated.resolutionRules} इसके अलावा 42% की वृद्धि।`,
    };
    const result = report(market, mutated);
    expect(result.status).toBe("blocked");
    expect(result.issues.some((issue) => issue.code === "extra_invariant")).toBe(true);
  });

  it("flags an empty field as blocking", async () => {
    const { market, translated } = await translate("rbi-rate-cut-2027", "hi");
    const result = report(market, { ...translated, resolutionSource: "" });
    expect(result.issues.some((issue) => issue.code === "empty_field")).toBe(true);
  });

  it("keeps every version version-by-version status derivation stable", async () => {
    const { market, translated } = await translate("rbi-rate-cut-2027", "hi");
    const validation = report(market, translated);
    const state = createVersionState({
      marketId: market.id,
      language: "hi",
      translated,
      validation,
      at: new Date().toISOString(),
    });
    expect(deriveStatus(state)).toBe("verified");
    expect(state.currentHash).toBe(state.lastValidatedHash);
  });
});
