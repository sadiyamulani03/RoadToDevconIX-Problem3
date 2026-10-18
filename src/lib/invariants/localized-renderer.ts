/**
 * Deterministic rendering of protected values into the target script.
 *
 * After a translation provider returns text containing placeholders, the
 * placeholders are replaced with the protected values again. By default the
 * value is rendered into the target language (native digits, native month and
 * magnitude words) which produces text a newsroom can publish directly, while
 * remaining 100% deterministic: the renderer only rearranges digits and lexemes
 * that are already in the lexicon.
 *
 * When a value cannot be rendered confidently the caller restores the exact
 * source text instead. Both paths are covered by the validator, which re-parses
 * the restored text and compares it with the English source.
 */

import type { TargetLanguage } from "@/lib/languages";
import {
  canonicalNumberString,
  parseNumericToken,
} from "@/lib/invariants/digit-normalizer";
import {
  TARGET_MAGNITUDE_WORDS,
  TARGET_MONTH_NAMES,
  TARGET_UNIT_WORDS,
} from "@/lib/invariants/lexicon";
import type { ExtractedInvariant } from "@/lib/invariants/types";

const NATIVE_ZERO: Record<TargetLanguage, number> = {
  hi: 0x0966, // Devanagari
  mr: 0x0966, // Devanagari (Marathi)
  ta: 0x0be6, // Tamil
};

/** Maps ASCII digits in a string to the target language's native digits. */
export function toNativeDigits(text: string, language: TargetLanguage): string {
  const zero = NATIVE_ZERO[language];
  let output = "";
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && codePoint >= 0x30 && codePoint <= 0x39) {
      output += String.fromCodePoint(zero + (codePoint - 0x30));
    } else {
      output += character;
    }
  }
  return output;
}

/** Indian digit grouping, e.g. 100000 -> "1,00,000". */
export function formatIndianGrouping(value: number): string {
  const text = canonicalNumberString(value);
  const negative = text.startsWith("-");
  const body = negative ? text.slice(1) : text;
  const [integerPart, decimalPart] = body.split(".");
  let grouped: string;
  if (integerPart.length <= 3) {
    grouped = integerPart;
  } else {
    const lastThree = integerPart.slice(-3);
    let rest = integerPart.slice(0, -3);
    const groups: string[] = [];
    while (rest.length > 2) {
      groups.unshift(rest.slice(-2));
      rest = rest.slice(0, -2);
    }
    if (rest.length > 0) groups.unshift(rest);
    grouped = `${groups.join(",")},${lastThree}`;
  }
  return `${negative ? "-" : ""}${grouped}${
    decimalPart ? `.${decimalPart}` : ""
  }`;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: "₹",
  USD: "$",
  EUR: "€",
};

function magnitudeMultiplier(canonicalMagnitude: string): number {
  switch (canonicalMagnitude) {
    case "hundred":
      return 100;
    case "thousand":
      return 1_000;
    case "lakh":
      return 100_000;
    case "crore":
      return 10_000_000;
    case "million":
      return 1_000_000;
    case "billion":
      return 1_000_000_000;
    default:
      return 1;
  }
}

function numericPartOfRaw(raw: string): string | null {
  const match = /(\d[\d,]*(?:\.\d+)?)/.exec(raw);
  return match ? match[1] : null;
}

/**
 * Renders an invariant into the target language. Returns null when the value
 * cannot be rendered with confidence; callers then restore the exact source
 * text instead of inventing a rendering.
 */
export function renderInvariantForLanguage(
  invariant: ExtractedInvariant,
  language: TargetLanguage
): string | null {
  switch (invariant.kind) {
    case "number":
      return numericPartOfRaw(invariant.raw)
        ? toNativeDigits(numericPartOfRaw(invariant.raw)!, language)
        : null;
    case "year":
      return invariant.numericValue !== undefined
        ? toNativeDigits(canonicalNumberString(invariant.numericValue), language)
        : null;
    case "percent": {
      const numeric = numericPartOfRaw(invariant.raw);
      return numeric ? `${toNativeDigits(numeric, language)}%` : null;
    }
    case "money": {
      if (invariant.numericValue === undefined || !invariant.currency) return null;
      const symbol = CURRENCY_SYMBOLS[invariant.currency] ?? invariant.currency;
      if (invariant.magnitudeWord) {
        const multiplier = magnitudeMultiplier(invariant.magnitudeWord);
        const base = invariant.numericValue / multiplier;
        const magnitudeWord =
          TARGET_MAGNITUDE_WORDS[language][invariant.magnitudeWord];
        if (!magnitudeWord) return null;
        return `${symbol}${toNativeDigits(
          canonicalNumberString(base),
          language
        )} ${magnitudeWord}`;
      }
      return `${symbol}${toNativeDigits(
        formatIndianGrouping(invariant.numericValue),
        language
      )}`;
    }
    case "quantity": {
      if (invariant.numericValue === undefined) return null;
      const unitWord = invariant.unit
        ? TARGET_UNIT_WORDS[language][invariant.unit]
        : undefined;
      if (!unitWord) return null;
      return `${toNativeDigits(
        formatIndianGrouping(invariant.numericValue),
        language
      )} ${unitWord}`;
    }
    case "range": {
      if (invariant.numericValue === undefined || invariant.rangeEnd === undefined) {
        return null;
      }
      const left = toNativeDigits(
        formatIndianGrouping(invariant.numericValue),
        language
      );
      const right = toNativeDigits(
        formatIndianGrouping(invariant.rangeEnd),
        language
      );
      let suffix = "";
      if (invariant.unit === "percent") {
        suffix = "%";
      } else if (invariant.unit) {
        const unitWord = TARGET_UNIT_WORDS[language][invariant.unit];
        if (!unitWord) return null;
        suffix = ` ${unitWord}`;
      }
      return `${left}–${right}${suffix}`;
    }
    case "date": {
      if (!invariant.dateISO) return null;
      const [year, month, day] = invariant.dateISO.split("-");
      const monthName = TARGET_MONTH_NAMES[language][Number(month)];
      if (!monthName) return null;
      return `${toNativeDigits(String(Number(day)), language)} ${monthName} ${toNativeDigits(
        year,
        language
      )}`;
    }
    case "time":
      return toNativeDigits(invariant.raw, language);
    case "url":
      return null;
    default:
      return null;
  }
}

/** Re-parses numbers through the normaliser to assert renderer round-trips. */
export function renderedNumberIsEquivalent(
  rendered: string,
  expected: number
): boolean {
  const parsed = parseNumericToken(rendered);
  return parsed !== null && parsed === expected;
}
