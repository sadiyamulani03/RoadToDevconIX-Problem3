/**
 * Placeholder protection for translation.
 *
 * Before any text is sent to a translation provider, every protected invariant
 * is replaced with a unique, translation-resistant token:
 *
 *   "Will the RBI cut rates before 15 June 2027?"
 *     -> "Will the RBI cut rates before ⟦INV_004⟧?"
 *
 * The provider must return every token untouched. After the response arrives,
 * tokens are verified (present exactly once, byte-for-byte), then restored to
 * the protected values. Missing, duplicated, corrupted or substituted tokens
 * are reported as blocking issues. Nothing is ever "repaired" silently.
 */

import type { MarketField } from "@/lib/market-schema";
import type { TargetLanguage } from "@/lib/languages";
import type { ExtractedInvariant } from "@/lib/invariants/types";
import { renderInvariantForLanguage } from "@/lib/invariants/localized-renderer";

/** Matches the exact placeholder token produced by `placeholderFor`. */
export const PLACEHOLDER_REGEX = /⟦INV_(\d{3})⟧/g;

/**
 * Tolerant matcher for mangled placeholders: provider mangling can change
 * brackets, drop zero padding, insert spaces or use a hyphen. Anything that
 * this regex finds but `PLACEHOLDER_REGEX` does not is classified as
 * "corrupted" — never silently accepted.
 */
export const LENIENT_PLACEHOLDER_REGEX =
  /[\u27E6\u3010\[\uFF3B(【]\s*INV\s*[_\- ]?\s*(\d{1,3})\s*[\u27E7\u3011\]\uFF3D)】]/gi;

export function placeholderFor(invariantId: string): string {
  return `⟦${invariantId}⟧`;
}

export interface ProtectedToken {
  invariant: ExtractedInvariant;
  placeholder: string;
  originalText: string;
}

export interface SkippedToken {
  invariantId: string;
  reason: string;
}

export interface ProtectionRecord {
  field: MarketField;
  /** The text actually sent to the provider. */
  protectedText: string;
  /** Original text with placeholders removed, for the audit trail. */
  sourceText: string;
  tokens: ProtectedToken[];
  skipped: SkippedToken[];
}

/**
 * Replaces protected invariants in one field with placeholders.
 *
 * Overlapping invariants (possible when a shared relation word is attached to
 * two adjacent facts) are resolved deterministically: the first by position is
 * protected, the overlapping one is recorded as skipped and is still verified
 * later through the restored-text comparison.
 */
export function protectFieldText(
  text: string,
  invariants: ExtractedInvariant[],
  field: MarketField
): ProtectionRecord {
  const ordered = [...invariants].sort((a, b) => a.start - b.start);
  const chosen: ExtractedInvariant[] = [];
  const skipped: SkippedToken[] = [];
  for (const invariant of ordered) {
    const lastEnd = chosen.length > 0 ? chosen[chosen.length - 1].end : -1;
    if (invariant.start < lastEnd) {
      skipped.push({
        invariantId: invariant.id,
        reason: "overlaps another protected token",
      });
      continue;
    }
    chosen.push(invariant);
  }

  const tokens: ProtectedToken[] = chosen.map((invariant) => ({
    invariant,
    placeholder: placeholderFor(invariant.id),
    originalText: invariant.raw,
  }));

  let protectedText = text;
  const descending = [...chosen].sort((a, b) => b.start - a.start);
  for (const invariant of descending) {
    const placeholder = placeholderFor(invariant.id);
    protectedText =
      protectedText.slice(0, invariant.start) +
      placeholder +
      protectedText.slice(invariant.end);
  }

  return { field, protectedText, sourceText: text, tokens, skipped };
}

export type PlaceholderStatus = "ok" | "missing" | "duplicated" | "corrupted";

export interface PlaceholderVerification {
  invariantId: string;
  placeholder: string;
  field: MarketField;
  originalText: string;
  expectedCount: number;
  foundCount: number;
  status: PlaceholderStatus;
  variants: string[];
}

function countExact(text: string, placeholder: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = text.indexOf(placeholder, from);
    if (at === -1) break;
    count += 1;
    from = at + placeholder.length;
  }
  return count;
}

/**
 * Verifies placeholder integrity in the provider's response. Every token must
 * appear exactly once, byte-for-byte. Zero occurrences -> missing; more than
 * one -> duplicated; a lenient-only match -> corrupted.
 */
export function verifyPlaceholders(
  translatedText: string,
  record: ProtectionRecord
): PlaceholderVerification[] {
  return record.tokens.map((token) => {
    const foundCount = countExact(translatedText, token.placeholder);
    const lenientMatches: string[] = [];
    for (const match of translatedText.matchAll(LENIENT_PLACEHOLDER_REGEX)) {
      if (match[0] !== token.placeholder) {
        const digits = match[1] ?? "";
        if (Number(digits) === Number(token.invariant.id.replace(/\D/g, ""))) {
          lenientMatches.push(match[0]);
        }
      }
    }
    let status: PlaceholderStatus = "ok";
    if (foundCount === 0) {
      status = lenientMatches.length > 0 ? "corrupted" : "missing";
    } else if (foundCount > 1) {
      status = "duplicated";
    }
    return {
      invariantId: token.invariant.id,
      placeholder: token.placeholder,
      field: record.field,
      originalText: token.originalText,
      expectedCount: 1,
      foundCount,
      status,
      variants: lenientMatches,
    };
  });
}

/** Finds placeholder-like residue that survived restoration. */
export function findPlaceholderResidue(text: string): string[] {
  const residue: string[] = [];
  for (const match of text.matchAll(LENIENT_PLACEHOLDER_REGEX)) {
    residue.push(match[0]);
  }
  return residue;
}

export interface RestoredToken {
  invariantId: string;
  placeholder: string;
  sourceText: string;
  restoredText: string;
  rendered: boolean;
}

export interface RestoreResult {
  text: string;
  restored: RestoredToken[];
}

export interface RestoreOptions {
  language: TargetLanguage;
  /**
   * Render values into the target language script (default true). When false,
   * the exact English source text is restored, which is the strictest form of
   * "restore the original protected values".
   */
  renderLocalized?: boolean;
}

/**
 * Replaces verified placeholders with the protected values. Only tokens that
 * appear exactly once are restored; a duplicated token is restored zero times
 * so a corruption can never be hidden by a convenient replacement.
 */
export function restoreFieldText(
  translatedText: string,
  record: ProtectionRecord,
  options: RestoreOptions
): RestoreResult {
  const renderLocalized = options.renderLocalized !== false;
  let text = translatedText;
  const restored: RestoredToken[] = [];

  for (const token of record.tokens) {
    const foundCount = countExact(text, token.placeholder);
    const rendered =
      renderLocalized &&
      renderInvariantForLanguage(token.invariant, options.language);
    const replacement = rendered || token.originalText;
    if (foundCount === 1) {
      text = text.replace(token.placeholder, replacement);
    }
    restored.push({
      invariantId: token.invariant.id,
      placeholder: token.placeholder,
      sourceText: token.originalText,
      restoredText: foundCount === 1 ? replacement : "",
      rendered: Boolean(rendered),
    });
  }

  return { text, restored };
}
