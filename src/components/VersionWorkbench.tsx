"use client";

import { useEffect, useMemo, useState } from "react";
import {
  MARKET_FIELDS,
  MARKET_FIELD_LABELS,
  type MarketField,
} from "@/lib/market-schema";
import { LANGUAGE_LABELS, LANGUAGE_NATIVE_LABELS } from "@/lib/languages";
import { INVARIANT_KIND_LABELS } from "@/lib/invariants/types";
import { DEADLINE_RELATION_LABELS } from "@/lib/invariants/types";
import { StatusBadge } from "@/components/StatusBadge";
import { IssueCard } from "@/components/IssueCard";
import type {
  MarketSourceJson,
  ProviderStatusJson,
  VersionDetailJson,
} from "@/components/ui-types";

const NATIVE_CLASS: Record<string, string> = { hi: "hi", mr: "hi", ta: "ta" };

async function callApi(
  url: string,
  init?: RequestInit
): Promise<{ ok: boolean; body: unknown }> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  let body: unknown = undefined;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return { ok: response.ok, body };
}

function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "error" in body) {
    const value = (body as { error?: unknown }).error;
    if (typeof value === "string") return value;
  }
  return fallback;
}

export function VersionWorkbench({
  detail,
  market,
  provider,
  onChanged,
  notify,
}: {
  detail: VersionDetailJson;
  market: MarketSourceJson;
  provider: ProviderStatusJson;
  onChanged: () => Promise<void>;
  notify: (message: string, tone?: "ok" | "bad") => void;
}) {
  const { version, gate, derivedStatus } = detail;
  const [drafts, setDrafts] = useState<Record<MarketField, string>>(() => ({
    title: version.translated?.title ?? "",
    question: version.translated?.question ?? "",
    resolutionRules: version.translated?.resolutionRules ?? "",
    closingAt: version.translated?.closingAt ?? "",
    resolutionSource: version.translated?.resolutionSource ?? "",
  }));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDrafts({
      title: version.translated?.title ?? "",
      question: version.translated?.question ?? "",
      resolutionRules: version.translated?.resolutionRules ?? "",
      closingAt: version.translated?.closingAt ?? "",
      resolutionSource: version.translated?.resolutionSource ?? "",
    });
  }, [version.versionId, version.revision, version.translated]);

  const dirtyFields = useMemo(
    () =>
      MARKET_FIELDS.filter(
        (field) =>
          version.translated !== undefined &&
          drafts[field] !== version.translated[field]
      ),
    [drafts, version.translated]
  );

  const editedSinceValidation =
    version.currentHash !== version.lastValidatedHash;

  async function run(action: () => Promise<{ ok: boolean; body: unknown }>, success: string) {
    setBusy(true);
    try {
      const result = await action();
      if (result.ok) {
        notify(success, "ok");
      } else {
        notify(errorMessage(result.body, "Action failed."), "bad");
      }
      await onChanged();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Action failed.", "bad");
    } finally {
      setBusy(false);
    }
  }

  function saveField(field: MarketField) {
    void run(
      () =>
        callApi(`/api/versions/${version.versionId}`, {
          method: "PATCH",
          body: JSON.stringify({ field, text: drafts[field], editor: "reviewer" }),
        }),
      `${MARKET_FIELD_LABELS[field]} saved. Previous verification invalidated — revalidate.`
    );
  }

  function saveAll() {
    if (dirtyFields.length === 0) return;
    void (async () => {
      setBusy(true);
      try {
        for (const field of dirtyFields) {
          const result = await callApi(`/api/versions/${version.versionId}`, {
            method: "PATCH",
            body: JSON.stringify({
              field,
              text: drafts[field],
              editor: "reviewer",
            }),
          });
          if (!result.ok) {
            notify(errorMessage(result.body, "Edit failed."), "bad");
            break;
          }
        }
        notify("Edits saved. Revalidate before publishing.", "ok");
        await onChanged();
      } finally {
        setBusy(false);
      }
    })();
  }

  const validation = version.validation;
  const acknowledged = new Set(
    version.acknowledgements.map((ack) => ack.issueId)
  );
  const targetLanguageClass = NATIVE_CLASS[version.language] ?? "";

  return (
    <div>
      <div className="card">
        <div className="spread">
          <div>
            <h2>
              {LANGUAGE_LABELS[version.language]}{" "}
              <span className={`${targetLanguageClass} muted`}>
                ({LANGUAGE_NATIVE_LABELS[version.language]})
              </span>{" "}
              <StatusBadge status={derivedStatus} />
            </h2>
            <p className="small muted">
              Version <span className="mono">{version.versionId}</span> ·
              revision {version.revision} · provider{" "}
              {version.providerLabel ?? "unknown"}
              {version.isLiveProvider ? "" : " (demo fixtures, not a live translation)"}
            </p>
          </div>
          <div className="row">
            <button
              className="secondary"
              disabled={busy || !version.translated}
              onClick={() =>
                void run(
                  () =>
                    callApi(`/api/versions/${version.versionId}/revalidate`, {
                      method: "POST",
                    }),
                  "Revalidation complete."
                )
              }
            >
              Revalidate
            </button>
            <button
              disabled={busy || !version.translated}
              onClick={() =>
                void run(
                  () =>
                    callApi(`/api/versions/${version.versionId}/publish`, {
                      method: "POST",
                    }),
                  "Published."
                )
              }
            >
              Publish
            </button>
          </div>
        </div>

        {version.error ? (
          <div className="banner bad">
            <strong>Translation failed ({version.error.code}).</strong>{" "}
            {version.error.message}
          </div>
        ) : null}

        <div
          className={`banner ${
            gate.allowed ? "ok" : derivedStatus === "verified" ? "warn" : "bad"
          }`}
        >
          <strong>{gate.summary}</strong>
          {gate.reasons.length > 0 ? (
            <ul className="small" style={{ margin: "6px 0 0 18px" }}>
              {gate.reasons.map((reason) => (
                <li key={reason.code}>{reason.message}</li>
              ))}
            </ul>
          ) : null}
          {editedSinceValidation && version.translated ? (
            <p className="small" style={{ marginTop: 6 }}>
              The current text has not been validated (hash{" "}
              <span className="mono">
                {version.currentHash.slice(0, 10) || "—"}
              </span>{" "}
              ≠ validated{" "}
              <span className="mono">
                {version.lastValidatedHash.slice(0, 10) || "—"}
              </span>
              ). Revalidate to refresh the report.
            </p>
          ) : null}
        </div>

        {!provider.isLive ? (
          <p className="tiny muted">
            Demo mode: translations come from curated committed fixtures. Set
            SARVAM_API_KEY and TRANSLATION_PROVIDER=auto (or sarvam) to run the
            same pipeline against the live Sarvam API.
          </p>
        ) : null}
      </div>

      {validation ? (
        <div className="card">
          <h3>Deterministic verification report</h3>
          <p className="small">
            <strong>
              {validation.invariantsMatched}/{validation.invariantsChecked}
            </strong>{" "}
            protected facts matched ·{" "}
            <span style={{ color: "var(--bad)" }}>
              {validation.blockingIssueCount} blocking
            </span>{" "}
            ·{" "}
            <span style={{ color: "var(--warn)" }}>
              {validation.reviewIssueCount} need review
            </span>{" "}
            · checked {new Date(validation.checkedAt).toLocaleString()}
          </p>
          <p className="tiny muted">{validation.scope}</p>
          <div className="divider" />
          {validation.issues.length === 0 ? (
            <p className="small" style={{ color: "var(--ok)" }}>
              No issues. Every protected number, date, time, unit and deadline
              relation matches the English source.
            </p>
          ) : (
            validation.issues.map((issue) => (
              <IssueCard
                key={issue.issueId}
                issue={issue}
                acknowledged={acknowledged.has(issue.issueId)}
                busy={busy}
                onAcknowledge={(issueId, reviewer, note) =>
                  void run(
                    () =>
                      callApi(
                        `/api/versions/${version.versionId}/acknowledge`,
                        {
                          method: "POST",
                          body: JSON.stringify({ issueId, reviewer, note }),
                        }
                      ),
                    "Acknowledgement recorded in the audit trail."
                  )
                }
              />
            ))
          )}
        </div>
      ) : null}

      {version.translated ? (
        <div className="card">
          <h3>Translation fields</h3>
          <p className="small muted">
            Edit any field; saving invalidates the previous verification until
            you revalidate. Protected values are re-checked mechanically.
          </p>
          {MARKET_FIELDS.map((field) => (
            <div className="field-block" key={field}>
              <div className="spread">
                <strong>{MARKET_FIELD_LABELS[field]}</strong>
                <button
                  className="secondary tiny-btn"
                  disabled={busy || drafts[field] === version.translated?.[field]}
                  onClick={() => saveField(field)}
                >
                  Save field
                </button>
              </div>
              <label>English source</label>
              <p className="small muted" style={{ margin: 0 }}>
                {field === "closingAt"
                  ? `${market.closingAt} (${market.timezone})`
                  : market[field]}
              </p>
              <label>{LANGUAGE_LABELS[version.language]} translation</label>
              <textarea
                className={targetLanguageClass}
                value={drafts[field]}
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    [field]: event.target.value,
                  }))
                }
                rows={field === "resolutionRules" ? 6 : 2}
              />
            </div>
          ))}
          <div className="row">
            <button disabled={busy || dirtyFields.length === 0} onClick={saveAll}>
              Save all edits ({dirtyFields.length})
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void run(
                  () =>
                    callApi(`/api/versions/${version.versionId}/revalidate`, {
                      method: "POST",
                    }),
                  "Revalidation complete."
                )
              }
            >
              Revalidate
            </button>
          </div>
        </div>
      ) : null}

      {validation ? (
        <div className="card">
          <h3>Evidence</h3>
          {validation.fields.map((fieldResult) => (
            <details key={fieldResult.field} className="field-block">
              <summary>
                {MARKET_FIELD_LABELS[fieldResult.field]} —{" "}
                {fieldResult.matched}/{fieldResult.sourceInvariants.length}{" "}
                matched
                {fieldResult.issues.length > 0
                  ? `, ${fieldResult.issues.length} issue(s)`
                  : ""}
              </summary>
              <table>
                <thead>
                  <tr>
                    <th>Token</th>
                    <th>English value</th>
                    <th>Deadline</th>
                    <th>Translated value found</th>
                    <th>Kind</th>
                  </tr>
                </thead>
                <tbody>
                  {fieldResult.sourceInvariants.map((source) => {
                    const rowIssues = fieldResult.issues.filter(
                      (issue) => issue.invariantId === source.id
                    );
                    return (
                      <tr key={source.id}>
                        <td className="mono">{source.id}</td>
                        <td>
                          <span className="evidence">{source.raw}</span>
                          {rowIssues.length > 0 ? (
                            <span
                              className="tiny"
                              style={{ color: "var(--bad)", display: "block" }}
                            >
                              {rowIssues.map((issue) => issue.title).join("; ")}
                            </span>
                          ) : null}
                        </td>
                        <td className="tiny">
                          {source.relation
                            ? DEADLINE_RELATION_LABELS[source.relation]
                            : "—"}
                        </td>
                        <td className={`${targetLanguageClass} tiny`}>
                          {rowIssues
                            .map((issue) => issue.detectedValue)
                            .filter(Boolean)
                            .join(", ") || "matched"}
                        </td>
                        <td className="tiny">
                          {INVARIANT_KIND_LABELS[source.kind]}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {fieldResult.targetInvariants.length > 0 ? (
                <details style={{ marginTop: 8 }}>
                  <summary>
                    Values found in the {LANGUAGE_LABELS[version.language]}{" "}
                    text ({fieldResult.targetInvariants.length})
                  </summary>
                  <table>
                    <thead>
                      <tr>
                        <th>Value</th>
                        <th>Kind</th>
                        <th>Deadline</th>
                        <th>Canonical</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fieldResult.targetInvariants.map((target) => (
                        <tr key={target.id}>
                          <td className={`${targetLanguageClass}`}>
                            <span className="evidence">{target.raw}</span>
                          </td>
                          <td className="tiny">
                            {INVARIANT_KIND_LABELS[target.kind]}
                          </td>
                          <td className="tiny">
                            {target.relation
                              ? DEADLINE_RELATION_LABELS[target.relation]
                              : "—"}
                          </td>
                          <td className="tiny mono">{target.canonical}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              ) : null}
            </details>
          ))}

          <details>
            <summary>
              Placeholder audit (
              {validation.placeholderAudits.length} protected tokens checked
              byte-for-byte)
            </summary>
            <table>
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Field</th>
                  <th>Placeholder</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {validation.placeholderAudits.map((audit) => (
                  <tr key={`${audit.invariantId}-${audit.field}`}>
                    <td className="mono">{audit.invariantId}</td>
                    <td className="tiny">{audit.field}</td>
                    <td className="mono tiny">{audit.placeholder}</td>
                    <td className="tiny">
                      {audit.status === "ok"
                        ? "kept intact"
                        : `${audit.status} (found ${audit.foundCount}×)`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      ) : null}

      <div className="card">
        <h3>Demo: inject a realistic translation error</h3>
        <p className="small muted">
          The corruption uses the same deterministic renderer as the pipeline,
          so it changes exactly one protected value in the current text and
          invalidates the verification — just like a careless human edit.
          Revalidate afterwards to watch the gate block publication.
        </p>
        <div className="row">
          <button
            className="secondary"
            disabled={busy || !version.translated}
            onClick={() =>
              void run(
                () =>
                  callApi("/api/demo/corrupt", {
                    method: "POST",
                    body: JSON.stringify({
                      marketId: version.marketId,
                      language: version.language,
                      kind: "date_shift",
                    }),
                  }),
                "Date shifted by one day. Revalidate to see the gate catch it."
              )
            }
          >
            Shift a date (+1 day)
          </button>
          <button
            className="secondary"
            disabled={busy || !version.translated}
            onClick={() =>
              void run(
                () =>
                  callApi("/api/demo/corrupt", {
                    method: "POST",
                    body: JSON.stringify({
                      marketId: version.marketId,
                      language: version.language,
                      kind: "magnitude_shift",
                    }),
                  }),
                "Magnitude changed (e.g. lakh → crore). Revalidate to see the gate catch it."
              )
            }
          >
            Shift a magnitude
          </button>
          <button
            className="secondary"
            disabled={busy || !version.translated}
            onClick={() =>
              void run(
                () =>
                  callApi("/api/demo/corrupt", {
                    method: "POST",
                    body: JSON.stringify({
                      marketId: version.marketId,
                      language: version.language,
                      kind: "percent_shift",
                    }),
                  }),
                "Percentage changed. Revalidate to see the gate catch it."
              )
            }
          >
            Shift a percentage
          </button>
        </div>
      </div>

      <div className="card">
        <h3>Audit trail for this language</h3>
        {version.audit.length === 0 ? (
          <p className="small muted">No events yet.</p>
        ) : (
          [...version.audit].reverse().map((event) => (
            <div className="audit-event" key={event.id}>
              <p className="small" style={{ margin: 0 }}>
                <span className="mono tiny">{event.at}</span> ·{" "}
                <strong>{event.action}</strong> ({event.actor})
              </p>
              <p className="small muted" style={{ margin: 0 }}>
                {event.summary}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
