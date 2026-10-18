/**
 * Publication gate.
 *
 * This is the enforcement point, not the UI. The publish API route calls
 * `evaluatePublishGate` before changing any state, and the gate recomputes
 * every condition from the underlying data instead of trusting a status field:
 *
 *   - a translation must exist
 *   - validation must have run on the CURRENT text (hash equality)
 *   - no blocking issues (changed number/date/unit, placeholder problems)
 *   - every review-severity issue must have a recorded acknowledgement
 *   - the derived status must be "verified"
 *
 * A language with blocking issues can never publish, regardless of the state
 * of the other languages.
 */

import {
  blockingIssues,
  deriveStatus,
  unacknowledgedReviewIssues,
  type LanguageVersionState,
} from "@/lib/review-workflow";
import type {
  LanguageVersionStatus,
  ValidationIssue,
} from "@/lib/invariants/types";

export type PublishGateReasonCode =
  | "translation_error"
  | "no_translation"
  | "not_validated"
  | "edited_since_validation"
  | "blocking_issues"
  | "unacknowledged_review_issues"
  | "empty_field"
  | "not_verified"
  | "already_published";

export interface PublishGateReason {
  code: PublishGateReasonCode;
  message: string;
  issues?: ValidationIssue[];
}

export interface PublishGateResult {
  allowed: boolean;
  reasons: PublishGateReason[];
  derivedStatus: LanguageVersionStatus;
  /** Human summary suitable for a toast/status banner. */
  summary: string;
}

export function evaluatePublishGate(
  state: LanguageVersionState
): PublishGateResult {
  const reasons: PublishGateReason[] = [];
  const derivedStatus = deriveStatus(state);

  if (state.error && !state.translated) {
    reasons.push({
      code: "translation_error",
      message: `Translation failed: ${state.error.message}`,
    });
  }
  if (!state.translated) {
    reasons.push({
      code: "no_translation",
      message: "This language has not been translated yet.",
    });
    return finish(reasons, derivedStatus);
  }
  if (!state.validation) {
    reasons.push({
      code: "not_validated",
      message: "This translation has never passed validation.",
    });
  }
  if (state.currentHash !== state.lastValidatedHash) {
    reasons.push({
      code: "edited_since_validation",
      message:
        "The translation was edited after its last validation. Revalidate before publishing.",
    });
  }

  const blocking = blockingIssues(state);
  if (blocking.length > 0) {
    reasons.push({
      code: "blocking_issues",
      message: `Publication blocked: ${blocking.length} protected fact check(s) failed.`,
      issues: blocking,
    });
  }

  const unacknowledged = unacknowledgedReviewIssues(state);
  if (unacknowledged.length > 0) {
    reasons.push({
      code: "unacknowledged_review_issues",
      message: `Human review required: ${unacknowledged.length} linguistic check(s) need an explicit reviewer decision (or correction).`,
      issues: unacknowledged,
    });
  }

  const empty = emptyFields(state);
  if (empty.length > 0) {
    reasons.push({
      code: "empty_field",
      message: `These fields are empty: ${empty.join(", ")}.`,
    });
  }

  if (state.status === "published" && state.currentHash === state.lastValidatedHash) {
    reasons.push({
      code: "already_published",
      message: "This language version is already published.",
    });
  } else if (derivedStatus !== "verified" && reasons.length === 0) {
    reasons.push({
      code: "not_verified",
      message: `This language version is "${derivedStatus}" and cannot be published.`,
    });
  }

  return finish(reasons, derivedStatus);
}

function emptyFields(state: LanguageVersionState): string[] {
  if (!state.translated) return [];
  const labels: Record<string, string> = {
    title: "title",
    question: "question",
    resolutionRules: "resolution rules",
    closingAt: "closing date and time",
    resolutionSource: "resolution source",
  };
  return (["title", "question", "resolutionRules", "closingAt", "resolutionSource"] as const)
    .filter((field) => state.translated![field].trim().length === 0)
    .map((field) => labels[field]);
}

function finish(
  reasons: PublishGateReason[],
  derivedStatus: LanguageVersionStatus
): PublishGateResult {
  const allowed = reasons.length === 0 && derivedStatus === "verified";
  const summary = allowed
    ? "All protected facts verified. Ready to publish."
    : reasons[0]?.message ?? "Publication is not allowed.";
  return { allowed, reasons, derivedStatus, summary };
}
