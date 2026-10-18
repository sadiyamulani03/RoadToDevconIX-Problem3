"use client";

import { useState } from "react";
import type { ValidationIssue } from "@/components/ui-types";
import { MARKET_FIELD_LABELS } from "@/lib/market-schema";

export function IssueCard({
  issue,
  acknowledged,
  onAcknowledge,
  busy,
}: {
  issue: ValidationIssue;
  acknowledged: boolean;
  onAcknowledge: (issueId: string, reviewer: string, note: string) => void;
  busy: boolean;
}) {
  const [note, setNote] = useState("");
  const [reviewer, setReviewer] = useState("");

  return (
    <div className={`issue ${issue.severity}`}>
      <div className="spread">
        <strong>
          {issue.severity === "blocking" ? "Blocking" : "Needs review"} ·{" "}
          {issue.title}
        </strong>
        <span className="tiny muted mono">{issue.code}</span>
      </div>
      <p className="small" style={{ marginTop: 4 }}>
        {issue.message}
      </p>
      <p className="small muted">Suggestion: {issue.suggestion}</p>
      <div className="row tiny muted">
        <span>Field: {MARKET_FIELD_LABELS[issue.field] ?? issue.field}</span>
        {issue.invariantId ? (
          <span className="mono">Token: {issue.invariantId}</span>
        ) : null}
      </div>
      {issue.severity === "review" ? (
        acknowledged ? (
          <p className="small" style={{ color: "var(--ok)", marginTop: 6 }}>
            Acknowledged by a reviewer; recorded in the audit trail.
          </p>
        ) : (
          <details style={{ marginTop: 6 }}>
            <summary>Acknowledge this linguistic check (recorded)</summary>
            <div className="row" style={{ marginTop: 6 }}>
              <input
                placeholder="Reviewer name"
                value={reviewer}
                onChange={(event) => setReviewer(event.target.value)}
                style={{ maxWidth: 180 }}
              />
              <input
                placeholder="Why is this acceptable?"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
              <button
                className="secondary tiny-btn"
                disabled={busy || reviewer.trim().length === 0 || note.trim().length < 3}
                onClick={() => onAcknowledge(issue.issueId, reviewer, note)}
              >
                Record acknowledgement
              </button>
            </div>
          </details>
        )
      ) : (
        <p className="tiny" style={{ color: "var(--bad)", marginTop: 6 }}>
          Blocking issues cannot be acknowledged; correct the translation and
          revalidate.
        </p>
      )}
    </div>
  );
}
