/**
 * Deterministic invariant validation.
 *
 * Every target language is validated independently. For each of the five
 * market fields the English invariants are matched against the invariants
 * extracted from the translation:
 *
 *   - exact canonical match        -> verified
 *   - same value, different unit   -> changed_unit (blocking)
 *   - different value / magnitude  -> changed_value (blocking)
 *   - source relation not present  -> deadline_relation_unverified (review)
 *   - different relation word      -> deadline_relation_changed (blocking)
 *   - no match at all              -> missing_invariant (blocking)
 *   - value not present in source  -> extra_invariant (blocking)
 *
 * A language model is never asked whether a translation "looks right"; only
 * parsed values are compared. When a fact cannot be parsed confidently the
 * report requires human review instead of guessing.
 */

import type {
  MarketField,
  MarketSource,
  TranslatedMarket,
} from "@/lib/market-schema";
import {
  MARKET_FIELDS,
  MARKET_FIELD_LABELS,
} from "@/lib/market-schema";
import type { TargetLanguage } from "@/lib/languages";
import { LANGUAGE_LABELS } from "@/lib/languages";
import {
  extractMarketInvariants,
  extractTranslatedInvariants,
} from "@/lib/invariants/extractor";
import type {
  PlaceholderVerification,
} from "@/lib/invariants/placeholder-protection";
import { findPlaceholderResidue } from "@/lib/invariants/placeholder-protection";
import {
  RELATION_PLAIN_ENGLISH,
} from "@/lib/invariants/deadline-validator";
import type {
  ExtractedInvariant,
  FieldValidationResult,
  IssueSeverity,
  ValidationIssue,
  ValidationIssueCode,
  ValidationReport,
} from "@/lib/invariants/types";

export interface ValidationInput {
  market: MarketSource;
  translated: TranslatedMarket;
  /** Placeholder integrity checks from the translation pipeline. */
  placeholderVerifications?: PlaceholderVerification[];
  /** Texts that must be scanned for leftover placeholder residue. */
  restoredFields?: Partial<Record<MarketField, string>>;
  checkedAt?: string;
}

const SCOPE_STATEMENT =
  "Mechanically verified: numbers, percentages, currency amounts, dates, " +
  "times, years, numeric ranges, links and the deadline relations before / " +
  "by / on / after / within. NOT verified: grammar, tone, named entities, " +
  "political wording or any fact outside the extracted invariant list. " +
  "Editorial judgement still applies.";

type Family = "temporal" | "numeric" | "url";

function familyOf(kind: ExtractedInvariant["kind"]): Family {
  if (kind === "date" || kind === "time") return "temporal";
  if (kind === "url") return "url";
  return "numeric";
}

function issueId(
  language: TargetLanguage,
  field: MarketField,
  code: ValidationIssueCode,
  suffix: string
): string {
  return `${language}:${field}:${code}:${suffix}`;
}

function makeIssue(params: {
  language: TargetLanguage;
  field: MarketField;
  code: ValidationIssueCode;
  severity: IssueSeverity;
  title: string;
  message: string;
  suggestion: string;
  invariantId?: string;
  sourceValue?: string;
  detectedValue?: string;
  suffix: string;
}): ValidationIssue {
  return {
    issueId: issueId(params.language, params.field, params.code, params.suffix),
    code: params.code,
    severity: params.severity,
    field: params.field,
    language: params.language,
    invariantId: params.invariantId,
    sourceValue: params.sourceValue,
    detectedValue: params.detectedValue,
    title: params.title,
    message: params.message,
    suggestion: params.suggestion,
  };
}

function valuesEqual(a: ExtractedInvariant, b: ExtractedInvariant): boolean {
  if (a.dateISO && b.dateISO) return a.dateISO === b.dateISO;
  if (a.numericValue !== undefined && b.numericValue !== undefined) {
    return a.numericValue === b.numericValue;
  }
  if (a.time24 && b.time24) return a.time24 === b.time24;
  return false;
}

function chooseClosest(
  source: ExtractedInvariant,
  candidates: ExtractedInvariant[]
): ExtractedInvariant {
  const scored = candidates.map((candidate) => {
    let score = 0;
    if (candidate.kind === source.kind) score += 4;
    if (familyOf(candidate.kind) === familyOf(source.kind)) score += 2;
    if (valuesEqual(source, candidate)) score += 8;
    return { candidate, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].candidate;
}

function changedValueIssue(
  source: ExtractedInvariant,
  target: ExtractedInvariant,
  field: MarketField,
  language: TargetLanguage
): ValidationIssue {
  const label = LANGUAGE_LABELS[language];
  const fieldLabel = MARKET_FIELD_LABELS[field];
  const suffix = `${source.id}-${target.id}`;

  if (
    source.unit &&
    target.unit &&
    source.unit !== target.unit &&
    valuesEqual(source, target)
  ) {
    return makeIssue({
      language,
      field,
      code: "changed_unit",
      severity: "blocking",
      title: "Protected unit changed",
      message: `Publication blocked: the English source measures ${source.raw}, but the ${label} text measures ${target.raw}. The number matches but the unit does not.`,
      suggestion: `Correct the ${label} ${fieldLabel.toLowerCase()} so the unit reads "${source.raw}", then revalidate.`,
      invariantId: source.id,
      sourceValue: source.raw,
      detectedValue: target.raw,
      suffix,
    });
  }

  const magnitudeChanged =
    Boolean(source.magnitudeWord || target.magnitudeWord) ||
    (source.kind === "money" && target.kind === "money");

  if (magnitudeChanged) {
    return makeIssue({
      language,
      field,
      code: "magnitude_mismatch",
      severity: "blocking",
      title: "Magnitude changed",
      message: `Publication blocked: the English source specifies ${source.display}, but the ${label} text specifies ${target.display}. A lakh-to-crore (or similar) change is a different market.`,
      suggestion: `Restore the original magnitude in the ${label} ${fieldLabel.toLowerCase()} (source: ${source.raw}), then revalidate.`,
      invariantId: source.id,
      sourceValue: source.raw,
      detectedValue: target.raw,
      suffix,
    });
  }

  const title =
    source.kind === "date"
      ? "Date changed"
      : source.kind === "time"
        ? "Time changed"
        : source.kind === "percent"
          ? "Percentage changed"
          : source.kind === "money"
            ? "Amount changed"
            : source.kind === "range"
              ? "Range changed"
              : "Number changed";

  return makeIssue({
    language,
    field,
    code: "changed_value",
    severity: "blocking",
    title,
    message: `Publication blocked: the English source says "${source.raw}", but the ${label} text contains "${target.raw}".`,
    suggestion: `Correct the ${label} ${fieldLabel.toLowerCase()} so it matches the English source ("${source.raw}"), then revalidate.`,
    invariantId: source.id,
    sourceValue: source.raw,
    detectedValue: target.raw,
    suffix,
  });
}

function relationChangedIssue(
  source: ExtractedInvariant,
  target: ExtractedInvariant,
  field: MarketField,
  language: TargetLanguage
): ValidationIssue {
  const label = LANGUAGE_LABELS[language];
  const sourceRelation = RELATION_PLAIN_ENGLISH[source.relation!];
  const targetRelation = RELATION_PLAIN_ENGLISH[target.relation!];
  return makeIssue({
    language,
    field,
    code: "deadline_relation_changed",
    severity: "blocking",
    title: "Deadline wording changed",
    message: `Publication blocked: the English deadline is "${source.raw}" (${sourceRelation}), but the ${label} text says "${target.raw}" (${targetRelation}). "Before" and "by" resolve a market differently.`,
    suggestion: `Rewrite the ${label} ${MARKET_FIELD_LABELS[field].toLowerCase()} so the deadline keeps the "${sourceRelation}" meaning, then revalidate.`,
    invariantId: source.id,
    sourceValue: source.raw,
    detectedValue: target.raw,
    suffix: `${source.id}-${target.id}`,
  });
}

function relationUnverifiedIssue(
  source: ExtractedInvariant,
  target: ExtractedInvariant | undefined,
  field: MarketField,
  language: TargetLanguage
): ValidationIssue {
  const label = LANGUAGE_LABELS[language];
  const detected = target ? target.raw : source.raw;
  return makeIssue({
    language,
    field,
    code: "deadline_relation_unverified",
    severity: "review",
    title: "Deadline meaning needs a human check",
    message: `Human review required: the English deadline "${source.raw}" uses "${RELATION_PLAIN_ENGLISH[
      source.relation!
    ]}", but the ${label} text around "${detected}" uses no deadline word this tool recognises. The date is intact; the before/by/on/after meaning could not be confirmed mechanically.`,
    suggestion: `Edit the ${label} text to include the correct deadline word (for example "से पहले" for before or "तक" for by), then revalidate. A reviewer may also acknowledge this specific linguistic check, which is recorded separately from numeric verification.`,
    invariantId: source.id,
    sourceValue: source.raw,
    detectedValue: detected,
    suffix: source.id,
  });
}

function missingIssue(
  source: ExtractedInvariant,
  field: MarketField,
  language: TargetLanguage
): ValidationIssue {
  const label = LANGUAGE_LABELS[language];
  return makeIssue({
    language,
    field,
    code: "missing_invariant",
    severity: "blocking",
    title: "Protected value missing",
    message: `Publication blocked: the English ${MARKET_FIELD_LABELS[
      field
    ].toLowerCase()} contains "${source.raw}" (${source.display}), but no matching value was found in the ${label} text.`,
    suggestion: `Add the protected value "${source.raw}" back to the ${label} text exactly as in the source, then revalidate.`,
    invariantId: source.id,
    sourceValue: source.raw,
    suffix: source.id,
  });
}

function extraIssue(
  target: ExtractedInvariant,
  field: MarketField,
  language: TargetLanguage
): ValidationIssue {
  const label = LANGUAGE_LABELS[language];
  return makeIssue({
    language,
    field,
    code: "extra_invariant",
    severity: "blocking",
    title: "Value not present in English source",
    message: `Publication blocked: the ${label} text contains "${target.raw}", which does not appear in the English source. The translator may have introduced or altered a fact.`,
    suggestion: `Remove or correct "${target.raw}" in the ${label} ${
      MARKET_FIELD_LABELS[field].toLowerCase()
    } so the text matches the English facts, then revalidate.`,
    detectedValue: target.raw,
    suffix: target.id,
  });
}

function matchField(
  source: ExtractedInvariant[],
  target: ExtractedInvariant[],
  field: MarketField,
  language: TargetLanguage
): { matched: number; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  let matched = 0;
  const targetPool = [...target];
  const sourcePending: ExtractedInvariant[] = [];

  // Pass 1: exact canonical matches (relation must match when declared).
  for (const sourceInvariant of source) {
    const index = targetPool.findIndex((candidate) => {
      if (candidate.canonical !== sourceInvariant.canonical) return false;
      if (
        sourceInvariant.relation &&
        candidate.relation !== sourceInvariant.relation
      ) {
        return false;
      }
      return true;
    });
    if (index >= 0) {
      targetPool.splice(index, 1);
      matched += 1;
    } else {
      sourcePending.push(sourceInvariant);
    }
  }

  // Pass 2: the source fact was not found verbatim. Explain precisely why.
  for (const sourceInvariant of sourcePending) {
    const family = familyOf(sourceInvariant.kind);
    const sameCanonicalIndex = targetPool.findIndex(
      (candidate) =>
        candidate.canonical === sourceInvariant.canonical &&
        familyOf(candidate.kind) === family
    );
    if (sameCanonicalIndex >= 0) {
      const candidate = targetPool[sameCanonicalIndex];
      targetPool.splice(sameCanonicalIndex, 1);
      if (sourceInvariant.relation && candidate.relation) {
        issues.push(
          relationChangedIssue(sourceInvariant, candidate, field, language)
        );
      } else if (sourceInvariant.relation && !candidate.relation) {
        issues.push(
          relationUnverifiedIssue(sourceInvariant, candidate, field, language)
        );
      } else {
        // The translation added a relation word the source did not declare
        // (normal grammar when rendering a standalone closing date).
        matched += 1;
      }
      continue;
    }

    const familyCandidates = targetPool.filter(
      (candidate) => familyOf(candidate.kind) === family
    );
    if (familyCandidates.length > 0) {
      const closest = chooseClosest(sourceInvariant, familyCandidates);
      targetPool.splice(targetPool.indexOf(closest), 1);
      if (sourceInvariant.relation && !closest.relation) {
        // A value changed inside a deadline: report the value change first,
        // because it is the more severe finding, but mention the relation.
        issues.push(
          changedValueIssue(sourceInvariant, closest, field, language)
        );
        issues.push(
          relationUnverifiedIssue(sourceInvariant, closest, field, language)
        );
      } else if (
        sourceInvariant.relation &&
        closest.relation &&
        closest.relation !== sourceInvariant.relation
      ) {
        if (valuesEqual(sourceInvariant, closest)) {
          issues.push(
            relationChangedIssue(sourceInvariant, closest, field, language)
          );
        } else {
          issues.push(
            changedValueIssue(sourceInvariant, closest, field, language)
          );
          issues.push(
            relationChangedIssue(sourceInvariant, closest, field, language)
          );
        }
      } else {
        issues.push(
          changedValueIssue(sourceInvariant, closest, field, language)
        );
      }
      continue;
    }

    issues.push(missingIssue(sourceInvariant, field, language));
  }

  // Pass 3: anything left in the translation is a fact the source never had.
  for (const leftover of targetPool) {
    issues.push(extraIssue(leftover, field, language));
  }

  // Ambiguous values need a human even when they matched.
  for (const invariant of [...source, ...target]) {
    if (invariant.confidence === "low") {
      issues.push(
        makeIssue({
          language,
          field,
          code: "ambiguous_date",
          severity: "review",
          title: "Ambiguous date needs a human check",
          message: `Human review required: "${invariant.raw}" is an ambiguous numeric date. Bhasha Markets assumed DD/MM/YYYY but cannot prove it mechanically.`,
          suggestion:
            "Rewrite the date with a month name (for example 15 June 2027) or acknowledge the assumption explicitly; the acknowledgement is recorded in the audit trail.",
          invariantId: invariant.id,
          sourceValue: invariant.raw,
          suffix: invariant.id,
        })
      );
    }
  }

  return { matched, issues };
}

function placeholderIssues(
  verifications: PlaceholderVerification[],
  language: TargetLanguage
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const verification of verifications) {
    if (verification.status === "ok") continue;
    const code: ValidationIssueCode =
      verification.status === "missing"
        ? "placeholder_missing"
        : verification.status === "duplicated"
          ? "placeholder_duplicated"
          : "placeholder_corrupted";
    const title =
      verification.status === "missing"
        ? "Protected value removed by translator"
        : verification.status === "duplicated"
          ? "Protected value duplicated by translator"
          : "Protected value corrupted by translator";
    const detail =
      verification.status === "missing"
        ? `the placeholder ${verification.placeholder} is missing, so the translator removed or rewrote the protected value`
        : verification.status === "duplicated"
          ? `the placeholder ${verification.placeholder} appears ${verification.foundCount} times`
          : `the placeholder ${verification.placeholder} was altered (found ${verification.variants
              .map((variant) => `"${variant}"`)
              .join(", ")})`;
    issues.push(
      makeIssue({
        language,
        field: verification.field,
        code,
        severity: "blocking",
        title,
        message: `Publication blocked: in the ${LANGUAGE_LABELS[language]} ${MARKET_FIELD_LABELS[
          verification.field
        ].toLowerCase()}, ${detail}. The protected value was "${verification.originalText}".`,
        suggestion: `Rerun the translation or correct the ${LANGUAGE_LABELS[
          language
        ]} text so it keeps "${verification.originalText}", then revalidate.`,
        invariantId: verification.invariantId,
        sourceValue: verification.originalText,
        suffix: verification.invariantId,
      })
    );
  }
  return issues;
}

function emptyFieldIssues(
  translated: TranslatedMarket,
  language: TargetLanguage
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const field of MARKET_FIELDS) {
    if (translated[field].trim().length === 0) {
      issues.push(
        makeIssue({
          language,
          field,
          code: "empty_field",
          severity: "blocking",
          title: "Field is empty",
          message: `Publication blocked: the ${LANGUAGE_LABELS[language]} ${MARKET_FIELD_LABELS[
            field
          ].toLowerCase()} is empty.`,
          suggestion: "Provide the translation for this field, then revalidate.",
          suffix: "empty",
        })
      );
    }
  }
  return issues;
}

/**
 * Runs the full deterministic validation for one translated language version.
 */
export function validateTranslation(input: ValidationInput): ValidationReport {
  const { market, translated } = input;
  const language = translated.language;
  const sourceBundle = extractMarketInvariants(market);
  const targetFields: Record<MarketField, string> = {
    title: translated.title,
    question: translated.question,
    resolutionRules: translated.resolutionRules,
    closingAt: translated.closingAt,
    resolutionSource: translated.resolutionSource,
  };
  const targetBundle = extractTranslatedInvariants(targetFields);

  const fieldResults: FieldValidationResult[] = [];
  const allIssues: ValidationIssue[] = [];
  let invariantsMatched = 0;

  for (const field of MARKET_FIELDS) {
    const result = matchField(
      sourceBundle.byField[field],
      targetBundle.byField[field],
      field,
      language
    );
    invariantsMatched += result.matched;
    fieldResults.push({
      field,
      sourceInvariants: sourceBundle.byField[field],
      targetInvariants: targetBundle.byField[field],
      matched: result.matched,
      issues: result.issues,
    });
    allIssues.push(...result.issues);
  }

  allIssues.push(
    ...emptyFieldIssues(translated, language),
    ...placeholderIssues(input.placeholderVerifications ?? [], language)
  );

  if (input.restoredFields) {
    for (const field of MARKET_FIELDS) {
      const text = input.restoredFields[field];
      if (!text) continue;
      for (const residue of findPlaceholderResidue(text)) {
        allIssues.push(
          makeIssue({
            language,
            field,
            code: "placeholder_corrupted",
            severity: "blocking",
            title: "Placeholder residue left in text",
            message: `Publication blocked: the text still contains placeholder residue "${residue}". The protected value was not restored cleanly.`,
            suggestion:
              "Rerun the translation so placeholders survive intact, then revalidate.",
            suffix: residue,
          })
        );
      }
    }
  }

  // Deduplicate identical issues (same issueId).
  const seen = new Set<string>();
  const issues = allIssues.filter((issue) => {
    if (seen.has(issue.issueId)) return false;
    seen.add(issue.issueId);
    return true;
  });

  const blockingIssueCount = issues.filter(
    (issue) => issue.severity === "blocking"
  ).length;
  const reviewIssueCount = issues.filter(
    (issue) => issue.severity === "review"
  ).length;
  const status =
    blockingIssueCount > 0
      ? "blocked"
      : reviewIssueCount > 0
        ? "needs_review"
        : "verified";

  return {
    language,
    status,
    checkedAt: input.checkedAt ?? new Date().toISOString(),
    invariantsChecked: sourceBundle.all.length,
    invariantsMatched,
    blockingIssueCount,
    reviewIssueCount,
    issues,
    fields: fieldResults,
    placeholderAudits: (input.placeholderVerifications ?? []).map(
      (verification) => ({
        invariantId: verification.invariantId,
        placeholder: verification.placeholder,
        field: verification.field,
        expectedCount: verification.expectedCount,
        foundCount: verification.foundCount,
        status: verification.status,
        detectedVariants: verification.variants,
      })
    ),
    scope: SCOPE_STATEMENT,
  };
}
