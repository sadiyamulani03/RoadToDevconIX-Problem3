import { describe, expect, it } from "vitest";
import { getSampleMarket, SAMPLE_MARKETS } from "@/lib/sample-markets";
import { MARKET_FIELDS } from "@/lib/market-schema";
import { translateMarket } from "@/lib/translation/pipeline";
import {
  FIXTURE_PROVIDER_DISCLAIMER,
  FixtureTranslationProvider,
  loadFixtureFile,
} from "@/lib/translation/fixture-provider";
import { createFixtureProvider } from "@/lib/translation";

const TARGET_LANGUAGES = ["hi", "ta", "mr"] as const;

describe("curated demo fixtures", () => {
  it("ships a complete fixture for every sample market in all 3 languages", () => {
    const file = loadFixtureFile();
    for (const market of SAMPLE_MARKETS) {
      for (const language of TARGET_LANGUAGES) {
        const entry = file.entries.find(
          (candidate) =>
            candidate.marketId === market.id && candidate.language === language
        );
        expect(entry, `missing fixture ${market.id}.${language}`).toBeDefined();
        for (const field of MARKET_FIELDS) {
          expect(entry!.fields[field].trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("verifies all 18 language versions with every fact matched", async () => {
    for (const market of SAMPLE_MARKETS) {
      const result = await translateMarket(market, {
        provider: createFixtureProvider(),
        languages: [...TARGET_LANGUAGES],
      });
      for (const language of result.languages) {
        expect(
          language.status,
          `${market.id}.${language.language} should verify`
        ).toBe("verified");
        expect(language.report?.invariantsMatched).toBe(
          language.report?.invariantsChecked
        );
        expect(language.report?.invariantsChecked ?? 0).toBeGreaterThan(0);
        expect(language.report?.issues).toEqual([]);
      }
    }
  });

  it("labels demo results as non-live with the honest disclaimer", async () => {
    const result = await translateMarket(SAMPLE_MARKETS[0], {
      provider: createFixtureProvider(),
      languages: ["hi"],
    });
    const language = result.languages[0];
    expect(result.provider.isLive).toBe(false);
    expect(result.provider.label).toBe("Curated demo fixtures");
    expect(language.providerNotes.join(" ")).toContain("NOT a live translation");
    expect(FIXTURE_PROVIDER_DISCLAIMER).toContain("NOT a live translation");
  });

  it("preserves every placeholder token byte-for-byte in all fixtures", async () => {
    for (const market of SAMPLE_MARKETS) {
      const result = await translateMarket(market, {
        provider: createFixtureProvider(),
        languages: [...TARGET_LANGUAGES],
      });
      for (const language of result.languages) {
        const audits = language.report?.placeholderAudits ?? [];
        expect(audits.length).toBeGreaterThan(0);
        for (const audit of audits) {
          expect(
            audit.status,
            `${market.id}.${language.language} ${audit.field} token ${audit.invariantId}`
          ).toBe("ok");
        }
      }
    }
  });

  it("fails loudly when a fixture loses a protected placeholder", async () => {
    const file = loadFixtureFile();
    const damaged = new FixtureTranslationProvider(
      file.entries.map((entry) =>
        entry.marketId === "rbi-rate-cut-2027" && entry.language === "hi"
          ? {
              ...entry,
              fields: {
                ...entry.fields,
                title: "आरबीआई रेपो दर में कटौती", // placeholder stripped
              },
            }
          : entry
      )
    );
    const result = await translateMarket(getSampleMarket("rbi-rate-cut-2027")!, {
      provider: damaged,
      languages: ["hi"],
    });
    expect(result.languages[0].status).toBe("blocked");
    expect(result.languages[0].error?.code).toBe("fixture_integrity");
    expect(result.languages[0].translated).toBeUndefined();
  });

  it("reports a helpful error for markets without fixtures", async () => {
    const result = await translateMarket(
      {
        ...SAMPLE_MARKETS[0],
        id: "custom-market",
      },
      { provider: createFixtureProvider(), languages: ["hi"] }
    );
    expect(result.languages[0].status).toBe("blocked");
    expect(result.languages[0].error?.code).toBe("fixture_not_found");
    expect(result.languages[0].error?.message).toContain("SARVAM_API_KEY");
  });
});
