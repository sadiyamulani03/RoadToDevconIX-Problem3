/**
 * Shared types for invariant extraction and validation.
 *
 * An "invariant" is a fact in the English source that must survive
 * translation: numbers, percentages, currency amounts, quantities, dates,
 * times, years, ranges and deadline relations. Invariants are extracted by
 * deterministic code (regular expressions, lexicons and date parsing), never
 * by a language model.
 */

import type { MarketField } from "@/lib/market-schema";
import type { TargetLanguage } from "@/lib/languages";

export type InvariantKind =
  | "number"
  | "percent"
  | "money"
  | "quantity"
  | "date"
  | "time"
  | "year"
  | "range"
  | "url";

export const INVARIANT_KIND_LABELS: Record<InvariantKind, string> = {
  number: "Number",
  percent: "Percentage",
  money: "Currency amount",
  quantity: "Quantity",
  date: "Date",
  time: "Time",
  year: "Year",
  range: "Numeric range",
  url: "Link",
};

/**
 * Deadline relations are semantic, not cosmetic. "before 15 June" and
 * "by 15 June" resolve a market differently, so they can never be treated as
 * equivalent.
 */
export type DeadlineRelation = "before" | "by" | "on" | "after" | "within";

export const DEADLINE_RELATION_LABELS: Record<DeadlineRelation, string> = {
  before: "before (strictly earlier than)",
  by: "by / no later than",
  on: "on (that specific date)",
  after: "after (strictly later than)",
  within: "within (inside the period)",
};

export type InvariantConfidence = "high" | "low";

export interface ExtractedInvariant {
  /** Stable per-extraction id, e.g. "INV_004". Used in placeholders. */
  id: string;
  field: MarketField;
  kind: InvariantKind;
  /** Exact source substring that was matched. */
  raw: string;
  /** Stable key used for equality matching across languages. */
  canonical: string;
  /** Human-readable description, e.g. "₹1 lakh (INR 100000)". */
  display: string;
  numericValue?: number;
  rangeEnd?: number;
  /** Canonical unit, e.g. "day", "seat", "basis_point". */
  unit?: string;
  rawUnit?: string;
  currency?: string;
  /** Effective multiplier word when the source used words, e.g. "lakh". */
  magnitudeWord?: string;
  dateISO?: string;
  time24?: string;
  timezone?: string;
  relation?: DeadlineRelation;
  relationRaw?: string;
  confidence: InvariantConfidence;
  /** Explanation for reviewers: why this token is protected. */
  note?: string;
  start: number;
  end: number;
}

export type ValidationIssueCode =
  | "placeholder_missing"
  | "placeholder_duplicated"
  | "placeholder_corrupted"
  | "missing_invariant"
  | "changed_value"
  | "changed_unit"
  | "magnitude_mismatch"
  | "deadline_relation_changed"
  | "deadline_relation_unverified"
  | "ambiguous_date"
  | "extra_invariant"
  | "empty_field"
  | "provider_error";

export type IssueSeverity = "blocking" | "review";

export interface ValidationIssue {
  /** Deterministic id used for acknowledgements and UI keys. */
  issueId: string;
  code: ValidationIssueCode;
  severity: IssueSeverity;
  field: MarketField;
  language: TargetLanguage;
  invariantId?: string;
  sourceValue?: string;
  detectedValue?: string;
  title: string;
  message: string;
  suggestion: string;
}

export interface PlaceholderAudit {
  invariantId: string;
  placeholder: string;
  field: MarketField;
  expectedCount: number;
  foundCount: number;
  status: "ok" | "missing" | "duplicated" | "corrupted";
  detectedVariants: string[];
}

export interface FieldValidationResult {
  field: MarketField;
  sourceInvariants: ExtractedInvariant[];
  targetInvariants: ExtractedInvariant[];
  matched: number;
  issues: ValidationIssue[];
}

export type ValidationStatus = "verified" | "needs_review" | "blocked";

export interface ValidationReport {
  language: TargetLanguage;
  status: ValidationStatus;
  checkedAt: string;
  invariantsChecked: number;
  invariantsMatched: number;
  blockingIssueCount: number;
  reviewIssueCount: number;
  issues: ValidationIssue[];
  fields: FieldValidationResult[];
  placeholderAudits: PlaceholderAudit[];
  /** Clear statement of what this report does and does not prove. */
  scope: string;
}

export type LanguageVersionStatus =
  | "draft"
  | "translating"
  | "needs_review"
  | "verified"
  | "published"
  | "blocked";

export const LANGUAGE_VERSION_STATUS_LABELS: Record<
  LanguageVersionStatus,
  string
> = {
  draft: "Draft",
  translating: "Translating",
  needs_review: "Needs review",
  verified: "Verified",
  published: "Published",
  blocked: "Blocked",
};
