/**
 * Human review workflow.
 *
 * Status model (the single documented lifecycle for a language version):
 *
 *   draft          created, not translated yet
 *   translating    translation in progress
 *   needs_review   validation has review items, or the text was edited after
 *                  its last validation
 *   verified       every deterministic check passed; publishable
 *   published      published after passing the publish gate
 *   blocked        at least one blocking issue (changed number/date/unit,
 *                  placeholder corruption, provider failure, empty field)
 *
 * Rules enforced here:
 *   - any edit invalidates previous verification (hash mismatch)
 *   - revalidation refreshes the report and the status
 *   - review-only issues need an explicit, recorded acknowledgement; blocking
 *     issues can NEVER be acknowledged away
 */

import { createHash } from "node:crypto";
import type { MarketField, MarketSource, TranslatedMarket } from "@/lib/market-schema";
import { MARKET_FIELDS } from "@/lib/market-schema";
import type { TargetLanguage } from "@/lib/languages";
import {
  createAuditEvent,
  type AuditEvent,
} from "@/lib/audit-log";
import { validateTranslation } from "@/lib/invariants/invariant-validator";
import type {
  LanguageVersionStatus,
  ValidationIssue,
  ValidationReport,
} from "@/lib/invariants/types";

export interface IssueAcknowledgement {
  issueId: string;
  reviewer: string;
  note: string;
  at: string;
}

export interface LanguageVersionState {
  versionId: string;
  marketId: string;
  language: TargetLanguage;
  status: LanguageVersionStatus;
  translated?: TranslatedMarket;
  validation?: ValidationReport;
  /** sha256 of the current translated field values. */
  currentHash: string;
  /** sha256 at the moment of the most recent validation run. */
  lastValidatedHash: string;
  acknowledgements: IssueAcknowledgement[];
  revision: number;
  audit: AuditEvent[];
  providerId?: string;
  providerLabel?: string;
  isLiveProvider?: boolean;
  providerRequestIds: string[];
  error?: { code: string; message: string };
  createdAt: string;
  updatedAt: string;
}

export function versionIdFor(
  marketId: string,
  language: TargetLanguage
): string {
  return `${marketId}.${language}`;
}

export function hashTranslatedMarket(translated: TranslatedMarket): string {
  const payload = JSON.stringify(
    MARKET_FIELDS.map((field) => [field, translated[field]])
  );
  return createHash("sha256").update(payload).digest("hex");
}

export function isAcknowledged(
  state: LanguageVersionState,
  issue: ValidationIssue
): boolean {
  return state.acknowledgements.some(
    (acknowledgement) => acknowledgement.issueId === issue.issueId
  );
}

export function unacknowledgedReviewIssues(
  state: LanguageVersionState
): ValidationIssue[] {
  if (!state.validation) return [];
  return state.validation.issues.filter(
    (issue) =>
      issue.severity === "review" && !isAcknowledged(state, issue)
  );
}

export function blockingIssues(state: LanguageVersionState): ValidationIssue[] {
  if (!state.validation) return [];
  return state.validation.issues.filter((issue) => issue.severity === "blocking");
}

/**
 * Derives the lifecycle status from the current data. This is the only place
 * statuses are computed; the store always keeps `state.status` in sync with
 * this function so UI labels and the publish gate can never disagree.
 */
export function deriveStatus(
  state: LanguageVersionState
): LanguageVersionStatus {
  if (state.error) return "blocked";
  if (!state.translated) {
    return state.status === "translating" ? "translating" : "draft";
  }
  if (!state.validation || state.currentHash !== state.lastValidatedHash) {
    return "needs_review";
  }
  if (blockingIssues(state).length > 0) return "blocked";
  if (unacknowledgedReviewIssues(state).length > 0) return "needs_review";
  if (state.status === "published") return "published";
  return "verified";
}

export interface CreateVersionInput {
  marketId: string;
  language: TargetLanguage;
  translated?: TranslatedMarket;
  validation?: ValidationReport;
  providerId?: string;
  providerLabel?: string;
  isLiveProvider?: boolean;
  providerRequestIds?: string[];
  error?: { code: string; message: string };
  at: string;
}

export function createVersionState(
  input: CreateVersionInput
): LanguageVersionState {
  const hash = input.translated
    ? hashTranslatedMarket(input.translated)
    : "";
  const base: LanguageVersionState = {
    versionId: versionIdFor(input.marketId, input.language),
    marketId: input.marketId,
    language: input.language,
    status: "translating",
    translated: input.translated,
    validation: input.validation,
    currentHash: hash,
    lastValidatedHash: input.validation ? hash : "",
    acknowledgements: [],
    revision: 1,
    audit: [],
    providerId: input.providerId,
    providerLabel: input.providerLabel,
    isLiveProvider: input.isLiveProvider,
    providerRequestIds: input.providerRequestIds ?? [],
    error: input.error,
    createdAt: input.at,
    updatedAt: input.at,
  };
  base.status = deriveStatus(base);
  return base;
}

export interface ApplyEditInput {
  field: MarketField;
  text: string;
  editor: string;
  at: string;
}

/** Applies a reviewer edit. Verification is invalidated until revalidation. */
export function applyTranslationEdit(
  state: LanguageVersionState,
  input: ApplyEditInput
): LanguageVersionState {
  if (!state.translated) {
    throw new Error("Cannot edit a version that has no translation.");
  }
  const previousStatus = state.status;
  const translated: TranslatedMarket = {
    ...state.translated,
    [input.field]: input.text,
  };
  const next: LanguageVersionState = {
    ...state,
    translated,
    currentHash: hashTranslatedMarket(translated),
    revision: state.revision + 1,
    status: "needs_review",
    updatedAt: input.at,
    audit: [
      ...state.audit,
      createAuditEvent({
        at: input.at,
        actor: input.editor,
        action: "reviewer_edit",
        marketId: state.marketId,
        language: state.language,
        field: input.field,
        previousStatus,
        newStatus: "needs_review",
        summary: `Reviewer edited the ${input.field} field; previous verification invalidated.`,
      }),
    ],
  };
  return next;
}

/**
 * Re-runs deterministic validation on the current translated text and
 * refreshes status. Called after every edit and after the demo corruption.
 */
export function revalidateVersion(
  state: LanguageVersionState,
  market: MarketSource,
  at: string,
  actor = "system"
): LanguageVersionState {
  if (!state.translated) return state;
  const report = validateTranslation({
    market,
    translated: state.translated,
    checkedAt: at,
  });
  const next: LanguageVersionState = {
    ...state,
    validation: report,
    lastValidatedHash: state.currentHash,
    updatedAt: at,
  };
  next.status = deriveStatus(next);
  next.audit = [
    ...next.audit,
    createAuditEvent({
      at,
      actor,
      action: "validation_completed",
      marketId: state.marketId,
      language: state.language,
      previousStatus: state.status,
      newStatus: next.status,
      summary:
        report.status === "verified"
          ? `Validation passed: ${report.invariantsMatched}/${report.invariantsChecked} protected facts matched.`
          : report.status === "needs_review"
            ? `Validation needs review: ${report.reviewIssueCount} item(s) require a human decision.`
            : `Validation blocked: ${report.blockingIssueCount} protected fact(s) failed.`,
      details: {
        status: report.status,
        invariantsChecked: report.invariantsChecked,
        invariantsMatched: report.invariantsMatched,
        blockingIssues: report.blockingIssueCount,
        reviewIssues: report.reviewIssueCount,
      },
    }),
  ];
  return next;
}

export interface AcknowledgeResult {
  ok: boolean;
  error?: string;
  state: LanguageVersionState;
}

/**
 * Records an explicit reviewer decision for a review-severity issue. This is
 * deliberately separate from deterministic validation: the audit trail shows
 * exactly which linguistic check a human accepted and why.
 */
export function acknowledgeIssue(
  state: LanguageVersionState,
  input: { issueId: string; reviewer: string; note: string; at: string }
): AcknowledgeResult {
  if (!state.validation) {
    return { ok: false, error: "Nothing to acknowledge: no validation report.", state };
  }
  const issue = state.validation.issues.find(
    (candidate) => candidate.issueId === input.issueId
  );
  if (!issue) {
    return { ok: false, error: "Unknown issue id.", state };
  }
  if (issue.severity === "blocking") {
    return {
      ok: false,
      error:
        "This is a blocking numeric/date/placeholder failure. It cannot be acknowledged; correct the translation and revalidate.",
      state,
    };
  }
  if (isAcknowledged(state, issue)) {
    return { ok: false, error: "Issue already acknowledged.", state };
  }
  if (!input.note.trim()) {
    return {
      ok: false,
      error: "A short note explaining the reviewer decision is required.",
      state,
    };
  }
  const next: LanguageVersionState = {
    ...state,
    acknowledgements: [
      ...state.acknowledgements,
      {
        issueId: input.issueId,
        reviewer: input.reviewer,
        note: input.note,
        at: input.at,
      },
    ],
    updatedAt: input.at,
  };
  next.status = deriveStatus(next);
  next.audit = [
    ...next.audit,
    createAuditEvent({
      at: input.at,
      actor: input.reviewer,
      action: "issue_acknowledged",
      marketId: state.marketId,
      language: state.language,
      previousStatus: state.status,
      newStatus: next.status,
      summary: `Reviewer acknowledged a linguistic check: ${issue.title}. Note: ${input.note}`,
      details: { issueId: input.issueId, code: issue.code },
    }),
  ];
  return { ok: true, state: next };
}
