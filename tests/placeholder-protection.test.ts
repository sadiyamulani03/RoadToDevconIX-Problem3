import { describe, expect, it } from "vitest";
import { getSampleMarket } from "@/lib/sample-markets";
import { extractMarketInvariants } from "@/lib/invariants/extractor";
import {
  findPlaceholderResidue,
  protectFieldText,
  restoreFieldText,
  verifyPlaceholders,
} from "@/lib/invariants/placeholder-protection";

const rbi = getSampleMarket("rbi-rate-cut-2027")!;
const bundle = extractMarketInvariants(rbi);
const titleRecord = protectFieldText(
  rbi.title,
  bundle.byField.title,
  "title"
);

describe("placeholder protection", () => {
  it("replaces protected values with numbered tokens", () => {
    expect(titleRecord.protectedText).toBe("RBI Repo Rate Cut Before ⟦INV_001⟧");
    expect(titleRecord.tokens).toHaveLength(1);
    expect(titleRecord.tokens[0].invariant.canonical).toBe("date:2027-06-15");
  });

  it("keeps relation words in the text sent to the translator", () => {
    expect(titleRecord.protectedText).toContain("Before");
    expect(titleRecord.protectedText).not.toContain("15 June 2027");
  });

  it("skips overlapping tokens deterministically", () => {
    const record = protectFieldText(
      "between 4% and 6%",
      [
        {
          id: "INV_A",
          field: "title",
          kind: "range",
          raw: "4% and 6%",
          canonical: "rng:4:6:pct",
          display: "4–6%",
          confidence: "high",
          start: 8,
          end: 17,
        },
        {
          id: "INV_B",
          field: "title",
          kind: "percent",
          raw: "6%",
          canonical: "pct:6",
          display: "6%",
          confidence: "high",
          start: 15,
          end: 17,
        },
      ],
      "title"
    );
    expect(record.tokens.map((token) => token.invariant.id)).toEqual(["INV_A"]);
    expect(record.skipped.map((token) => token.invariantId)).toEqual(["INV_B"]);
  });
});

describe("placeholder verification", () => {
  it("accepts a byte-for-byte intact token", () => {
    const verifications = verifyPlaceholders(
      "आरबीआई ⟦INV_001⟧ से पहले",
      titleRecord
    );
    expect(verifications[0].status).toBe("ok");
    expect(verifications[0].foundCount).toBe(1);
  });

  it("flags a missing token", () => {
    const verifications = verifyPlaceholders("आरबीआई कटौती", titleRecord);
    expect(verifications[0].status).toBe("missing");
  });

  it("flags a duplicated token", () => {
    const verifications = verifyPlaceholders(
      "⟦INV_001⟧ और ⟦INV_001⟧",
      titleRecord
    );
    expect(verifications[0].status).toBe("duplicated");
    expect(verifications[0].foundCount).toBe(2);
  });

  it("flags a mangled token as corrupted, never repaired silently", () => {
    const verifications = verifyPlaceholders(
      "⟦INV_1⟧ से पहले",
      titleRecord
    );
    expect(verifications[0].status).toBe("corrupted");
    expect(verifications[0].variants).toEqual(["⟦INV_1⟧"]);
  });
});

describe("restoration", () => {
  it("restores values with localized rendering", () => {
    const result = restoreFieldText("आरबीआई ⟦INV_001⟧ से पहले", titleRecord, {
      language: "hi",
    });
    expect(result.text).toBe("आरबीआई १५ जून २०२७ से पहले");
    expect(result.restored[0].rendered).toBe(true);
  });

  it("falls back to the exact source text for links", () => {
    const sourceRecord = protectFieldText(
      rbi.resolutionSource,
      bundle.byField.resolutionSource,
      "resolutionSource"
    );
    const result = restoreFieldText(
      "भारतीय रिज़र्व बैंक (⟦INV_010⟧)",
      sourceRecord,
      { language: "hi" }
    );
    expect(result.text).toContain("rbi.org.in");
    expect(result.restored[0].rendered).toBe(false);
  });

  it("restores a duplicated token zero times so corruption cannot hide", () => {
    const result = restoreFieldText("⟦INV_001⟧ ⟦INV_001⟧", titleRecord, {
      language: "hi",
    });
    expect(result.text).toContain("⟦INV_001⟧");
    expect(result.restored[0].restoredText).toBe("");
  });

  it("finds leftover placeholder residue", () => {
    expect(findPlaceholderResidue("text ⟦INV_01⟧ left")).toEqual(["⟦INV_01⟧"]);
    expect(findPlaceholderResidue("clean text")).toEqual([]);
  });
});
