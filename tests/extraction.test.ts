import { describe, expect, it } from "vitest";
import { getSampleMarket, SAMPLE_MARKETS } from "@/lib/sample-markets";
import {
  extractInvariants,
  extractMarketInvariants,
  extractTranslatedInvariants,
} from "@/lib/invariants/extractor";
import { formatClosingAtDisplay } from "@/lib/closing-time";
import { toNativeDigits, formatIndianGrouping } from "@/lib/invariants/localized-renderer";

const EMPTY_FIELDS = {
  title: "",
  question: "",
  resolutionRules: "",
  closingAt: "",
  resolutionSource: "",
};

function kindsOf(marketId: string): Map<string, string[]> {
  const market = getSampleMarket(marketId)!;
  const bundle = extractMarketInvariants(market);
  const byCanonical = new Map<string, string[]>();
  for (const invariant of bundle.all) {
    byCanonical.set(invariant.canonical, [
      ...(byCanonical.get(invariant.canonical) ?? []),
      invariant.kind,
    ]);
  }
  return byCanonical;
}

describe("deterministic invariant extraction", () => {
  it("parses Indian-grouped quantities", () => {
    const invariants = extractInvariants(
      "A margin above 1,00,000 votes.",
      "resolutionRules"
    );
    const quantity = invariants.find((invariant) => invariant.kind === "quantity");
    expect(quantity?.canonical).toBe("n:100000:vote");
    expect(quantity?.numericValue).toBe(100000);
  });

  it("parses percentages with decimals", () => {
    const invariants = extractInvariants("a cut of 0.25% qualifies", "resolutionRules");
    expect(invariants.some((invariant) => invariant.canonical === "pct:0.25")).toBe(true);
  });

  it("parses currency amounts with magnitude words", () => {
    const invariants = extractInvariants("subsidy of ₹1 Lakh per beneficiary", "question");
    const money = invariants.find((invariant) => invariant.kind === "money");
    expect(money?.canonical).toBe("inr:100000");
    expect(money?.magnitudeWord).toBe("lakh");
  });

  it("parses word quantities (two crore / one lakh)", () => {
    const invariants = extractInvariants(
      "more than two crore households, fewer than one lakh households",
      "resolutionRules"
    );
    const values = invariants.map((invariant) => invariant.canonical);
    expect(values).toContain("n:20000000");
    expect(values).toContain("n:100000");
  });

  it("attaches before / by / after relations to the value they govern", () => {
    const before = extractInvariants("before 15 June 2027", "title");
    expect(before[0]?.relation).toBe("before");
    const by = extractInvariants("announced by 15 June 2027", "title");
    expect(by[0]?.relation).toBe("by");
    const after = extractInvariants("begin on or after 31 March 2028", "title");
    expect(after[0]?.relation).toBe("after");
  });

  it("never mistakes 'by-poll' or 'published by MoSPI' for a deadline", () => {
    const poll = extractInvariants(
      "Karnataka By-poll Victory Margin Above 1,00,000 Votes",
      "title"
    );
    expect(poll.every((invariant) => invariant.relation === undefined)).toBe(true);

    const reported = extractInvariants(
      "reported by MoSPI for April 2027 is above 5.0%",
      "resolutionRules"
    );
    const year = reported.find((invariant) => invariant.kind === "year");
    const percent = reported.find((invariant) => invariant.kind === "percent");
    expect(year?.relation).toBeUndefined();
    expect(percent?.relation).toBeUndefined();
  });

  it("never fabricates dates, money or percentages from placeholder tokens", () => {
    const invariants = extractInvariants(
      "Will services begin before ⟦INV_007⟧?",
      "question"
    );
    expect(invariants.every((invariant) => invariant.kind === "number")).toBe(true);
  });

  it("parses native-digit dates and relations in translated text", () => {
    const bundle = extractTranslatedInvariants({
      ...EMPTY_FIELDS,
      title: "१५ जून २०२७ से पहले आरबीआई रेपो दर में कटौती",
    });
    const date = bundle.byField.title.find((invariant) => invariant.kind === "date");
    expect(date?.dateISO).toBe("2027-06-15");
    expect(date?.relation).toBe("before");
  });

  it("parses Tamil renderings back into canonical values", () => {
    const bundle = extractTranslatedInvariants({
      ...EMPTY_FIELDS,
      resolutionRules:
        "குறைந்தது ஈர்பத்து ஐந்து அடிப்படை புள்ளிகள்; ₹௧ லட்சம்; ௫.0%",
    });
    const canonicals = bundle.all.map((invariant) => invariant.canonical);
    expect(canonicals).toContain("pct:5");
    expect(canonicals).toContain("n:5:basis_point");
    expect(canonicals).toContain("inr:100000");
  });

  it("covers every protected kind across the demo corpus", () => {
    const all = SAMPLE_MARKETS.flatMap(
      (market) => extractMarketInvariants(market).all
    );
    const kinds = new Set(all.map((invariant) => invariant.kind));
    for (const kind of [
      "date",
      "time",
      "year",
      "percent",
      "money",
      "quantity",
      "number",
      "url",
    ]) {
      expect(kinds.has(kind as never), `missing kind ${kind}`).toBe(true);
    }
    const relations = new Set(all.map((invariant) => invariant.relation));
    expect(relations.has("before")).toBe(true);
    expect(relations.has("by")).toBe(true);
    expect(relations.has("after")).toBe(true);
  });

  it("extracts every kind for the RBI market with stable canonical keys", () => {
    const byCanonical = kindsOf("rbi-rate-cut-2027");
    expect(byCanonical.get("date:2027-06-15")).toContain("date");
    expect(byCanonical.get("pct:0.25")).toContain("percent");
    expect(byCanonical.get("n:25:basis_point")).toContain("quantity");
    expect(byCanonical.get("url:rbi.org.in")).toContain("url");
    expect(byCanonical.get("time:17:30:IST")).toContain("time");
  });
});

describe("closing-time display", () => {
  it("formats the closing instant in the market timezone", () => {
    expect(formatClosingAtDisplay(SAMPLE_MARKETS[0])).toBe(
      "15 June 2027, 5:30 PM IST"
    );
    expect(formatClosingAtDisplay(SAMPLE_MARKETS[1])).toBe(
      "5 June 2027, 11:59 PM IST"
    );
  });
});

describe("localized rendering helpers", () => {
  it("maps digits to Devanagari and Tamil", () => {
    expect(toNativeDigits("15", "hi")).toBe("१५");
    expect(toNativeDigits("15", "ta")).toBe("௧௫");
  });

  it("groups digits in the Indian system", () => {
    expect(formatIndianGrouping(100000)).toBe("1,00,000");
    expect(formatIndianGrouping(10000000)).toBe("1,00,00,000");
    expect(formatIndianGrouping(1000)).toBe("1,000");
  });
});
