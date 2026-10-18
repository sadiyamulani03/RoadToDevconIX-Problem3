/**
 * Audit trail.
 *
 * Every state transition a reviewer cares about is recorded: translation
 * requests, validation results, reviewer edits, acknowledgements of linguistic
 * checks, publish attempts (allowed and blocked) and the fixture-based error
 * demonstration. Events are append-only and rendered in the UI.
 */

import type { MarketField } from "@/lib/market-schema";
import type { TargetLanguage } from "@/lib/languages";
import type { LanguageVersionStatus } from "@/lib/invariants/types";

export type AuditAction =
  | "market_created"
  | "market_updated"
  | "translation_requested"
  | "translation_received"
  | "translation_failed"
  | "validation_completed"
  | "reviewer_edit"
  | "issue_acknowledged"
  | "publish_attempted"
  | "publish_blocked"
  | "published"
  | "demo_corruption_injected";

export interface AuditEvent {
  id: string;
  at: string;
  actor: string;
  action: AuditAction;
  marketId: string;
  language?: TargetLanguage;
  field?: MarketField;
  previousStatus?: LanguageVersionStatus;
  newStatus?: LanguageVersionStatus;
  summary: string;
  details?: Record<string, unknown>;
}

let auditCounter = 0;

export function createAuditEvent(
  input: Omit<AuditEvent, "id"> & { id?: string }
): AuditEvent {
  auditCounter += 1;
  return {
    id:
      input.id ??
      `aud_${input.at.replace(/[^0-9]/g, "").slice(0, 14)}_${auditCounter}`,
    at: input.at,
    actor: input.actor,
    action: input.action,
    marketId: input.marketId,
    language: input.language,
    field: input.field,
    previousStatus: input.previousStatus,
    newStatus: input.newStatus,
    summary: input.summary,
    details: input.details,
  };
}

export function appendAuditEvent(
  events: AuditEvent[],
  event: AuditEvent
): AuditEvent[] {
  return [...events, event];
}
