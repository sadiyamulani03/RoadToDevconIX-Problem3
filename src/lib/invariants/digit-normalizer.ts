/**
 * Deterministic numeral normalisation.
 *
 * Indian-language translations freely mix scripts and digit systems:
 *
 *   Hindi / Marathi (Devanagari):  १५ जून २०२७      -> 15 जून 2027
 *   Tamil:                         ௧௫ ஜூன் ௨௦௨௭     -> 15 ஜூன் 2027
 *   ASCII:                         15 June 2027     -> 15 June 2027
 *
 * On top of scripts, numbers are grouped differently:
 *
 *   Western grouping:  100,000        Indian grouping:  1,00,000
 *
 * Both must compare as the same number. This module is pure, synchronous and
 * has no network or model dependency, so every comparison in the validator is
 * explainable and reproducible.
 */

import { DIGIT_BLOCKS } from "@/lib/languages";

/** Maps any supported script's decimal digit to its ASCII counterpart. */
export function normalizeDigitsToAscii(text: string): string {
  let output = "";
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) {
      output += character;
      continue;
    }
    let mapped: string | null = null;
    for (const block of DIGIT_BLOCKS) {
      if (block.zeroCodePoint === 0x0030) continue;
      const offset = codePoint - block.zeroCodePoint;
      if (offset >= 0 && offset <= 9) {
        mapped = String(offset);
        break;
      }
    }
    output += mapped ?? character;
  }
  return output;
}

/**
 * Removes digit-grouping separators (Indian and Western) that sit between two
 * digits. Decimal separators are never touched: only `,` (U+002C), the Arabic
 * thousands separator (U+066C) and the right single quote (U+2019, used as a
 * thousands separator in some locales) are removed, and only when flanked by
 * digits on both sides.
 *
 * "1,00,000" -> "100000"   "1,00,000.50" -> "100000.50"   "1,234" -> "1234"
 */
export function stripDigitGrouping(text: string): string {
  return text.replace(/(?<=\d)[,\u066C\u2019](?=\d)/g, "");
}

/** Digit-normalise then strip grouping. The canonical form for parsers. */
export function canonicalizeNumerals(text: string): string {
  return stripDigitGrouping(normalizeDigitsToAscii(text));
}

const NUMERIC_TOKEN_RE = /^[+-]?\d+(?:\.\d+)?$/;

/**
 * Parses a numeric token after digit normalisation and grouping removal.
 * Returns null when the token is not a plain number, so callers can fail
 * safely instead of silently coercing garbage.
 */
export function parseNumericToken(token: string): number | null {
  const canonical = canonicalizeNumerals(token).trim();
  if (!NUMERIC_TOKEN_RE.test(canonical)) return null;
  const value = Number(canonical);
  return Number.isFinite(value) ? value : null;
}

/** Stable string form used in canonical invariant keys. */
export function canonicalNumberString(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(6)));
}

/** True when two textual numeric tokens denote the same value. */
export function numericTokensEqual(a: string, b: string): boolean {
  const left = parseNumericToken(a);
  const right = parseNumericToken(b);
  if (left === null || right === null) return false;
  return left === right;
}

/**
 * Formats a number the way Indian newsrooms read it (lakh/crore grouping)
 * with an explicit unit label. Used only for human-readable messages.
 */
export function describeMagnitude(value: number): string {
  if (Math.abs(value) >= 10_000_000 && Math.abs(value) % 10_000_000 === 0) {
    const crores = value / 10_000_000;
    return `${value.toLocaleString("en-IN")} (${crores} crore)`;
  }
  if (Math.abs(value) >= 100_000 && Math.abs(value) % 100_000 === 0) {
    const lakhs = value / 100_000;
    return `${value.toLocaleString("en-IN")} (${lakhs} lakh)`;
  }
  return value.toLocaleString("en-IN");
}
