"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MARKETS_REFRESH_HINT } from "@/components/constants";
import { VersionWorkbench } from "@/components/VersionWorkbench";
import { StatusBadge } from "@/components/StatusBadge";
import { LANGUAGE_LABELS, TARGET_LANGUAGES, type TargetLanguage } from "@/lib/languages";
import type {
  MarketDetailJson,
  MarketSummaryJson,
  ProviderStatusJson,
  TranslateResponseJson,
} from "@/components/ui-types";

interface Toast {
  message: string;
  tone: "ok" | "bad";
}

const TIMEZONE_OFFSETS: Record<string, string> = {
  "Asia/Kolkata": "+05:30",
  UTC: "+00:00",
  "Asia/Dubai": "+04:00",
  "Asia/Singapore": "+08:00",
  "Europe/London": "+00:00",
  "America/New_York": "-05:00",
};

function localToIso(local: string, timezone: string): string {
  const offset = TIMEZONE_OFFSETS[timezone] ?? "+00:00";
  const withSeconds = local.length === 16 ? `${local}:00` : local;
  return `${withSeconds}${offset}`;
}

export default function HomePage() {
  const [provider, setProvider] = useState<ProviderStatusJson | null>(null);
  const [markets, setMarkets] = useState<MarketSummaryJson[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MarketDetailJson | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState({
    title: "",
    question: "",
    resolutionRules: "",
    closingLocal: "2027-12-31T17:30",
    timezone: "Asia/Kolkata",
    resolutionSource: "",
  });

  const notify = useCallback((message: string, tone: "ok" | "bad" = "ok") => {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), 6500);
  }, []);

  const loadMarkets = useCallback(async () => {
    const response = await fetch("/api/markets", { cache: "no-store" });
    const body = (await response.json()) as { markets?: MarketSummaryJson[] };
    setMarkets(body.markets ?? []);
  }, []);

  const loadDetail = useCallback(async (marketId: string) => {
    const response = await fetch(`/api/markets/${marketId}`, {
      cache: "no-store",
    });
    if (!response.ok) {
      setDetail(null);
      return;
    }
    const body = (await response.json()) as MarketDetailJson;
    setDetail(body);
  }, []);

  const loadProvider = useCallback(async () => {
    const response = await fetch("/api/provider", { cache: "no-store" });
    const body = (await response.json()) as { provider?: ProviderStatusJson };
    setProvider(body.provider ?? null);
  }, []);

  useEffect(() => {
    void loadProvider();
    void loadMarkets();
  }, [loadMarkets, loadProvider]);

  useEffect(() => {
    if (!selectedId) return;
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  useEffect(() => {
    if (!detail) return;
    if (
      !selectedVersionId ||
      !detail.versions.some((item) => item.version.versionId === selectedVersionId)
    ) {
      setSelectedVersionId(detail.versions[0]?.version.versionId ?? null);
    }
  }, [detail, selectedVersionId]);

  const refresh = useCallback(async () => {
    await loadMarkets();
    if (selectedId) await loadDetail(selectedId);
  }, [loadMarkets, loadDetail, selectedId]);

  const selectedVersion = useMemo(
    () =>
      detail?.versions.find(
        (item) => item.version.versionId === selectedVersionId
      ) ?? null,
    [detail, selectedVersionId]
  );

  async function translate(languages?: TargetLanguage[]) {
    if (!selectedId) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/markets/${selectedId}/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(languages ? { languages } : {}),
      });
      const body = (await response.json()) as TranslateResponseJson & {
        error?: string;
      };
      if (!response.ok) {
        notify(body.error ?? "Translation failed.", "bad");
        return;
      }
      const verified = body.versions.filter(
        (version) => version.validation?.status === "verified"
      ).length;
      notify(
        `Translated ${body.versions.length} language version(s) with ${body.provider.label}: ${verified} fully verified.`,
        "ok"
      );
      await refresh();
      if (body.versions[0]) setSelectedVersionId(body.versions[0].versionId);
    } finally {
      setBusy(false);
    }
  }

  async function createMarket() {
    setBusy(true);
    try {
      const response = await fetch("/api/markets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title,
          question: draft.question,
          resolutionRules: draft.resolutionRules,
          closingAt: localToIso(draft.closingLocal, draft.timezone),
          timezone: draft.timezone,
          resolutionSource: draft.resolutionSource,
          isDemo: true,
        }),
      });
      const body = (await response.json()) as {
        market?: { id: string };
        error?: string;
      };
      if (!response.ok || !body.market) {
        notify(body.error ?? "Could not create the market.", "bad");
        return;
      }
      notify(`Market "${body.market.id}" created.`, "ok");
      setShowCreate(false);
      await loadMarkets();
      setSelectedId(body.market.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>Bhasha Markets</h1>
        <p className="small muted">
          {MARKETS_REFRESH_HINT}
        </p>

        {provider ? (
          <div className={`banner ${provider.isLive ? "ok" : "warn"}`}>
            <strong>
              {provider.isLive
                ? `Live provider: ${provider.label}`
                : "Demo fixtures mode"}
            </strong>
            <p className="tiny" style={{ margin: "4px 0 0" }}>
              {provider.isLive
                ? "Sarvam API credentials detected; translations run against the live provider."
                : "No SARVAM_API_KEY configured. Curated committed fixtures are used so the workflow stays fully deterministic. The live Sarvam path is exercised the moment a key is provided."}
            </p>
          </div>
        ) : null}

        <div className="spread">
          <h3>Markets</h3>
          <button
            className="secondary tiny-btn"
            onClick={() => setShowCreate((value) => !value)}
          >
            {showCreate ? "Close" : "New market"}
          </button>
        </div>

        {showCreate ? (
          <div className="card sub">
            <label>Title</label>
            <input
              value={draft.title}
              onChange={(event) =>
                setDraft({ ...draft, title: event.target.value })
              }
            />
            <label>Question</label>
            <input
              value={draft.question}
              onChange={(event) =>
                setDraft({ ...draft, question: event.target.value })
              }
            />
            <label>Resolution rules</label>
            <textarea
              rows={4}
              value={draft.resolutionRules}
              onChange={(event) =>
                setDraft({ ...draft, resolutionRules: event.target.value })
              }
            />
            <label>Closing date &amp; time (local)</label>
            <input
              type="datetime-local"
              value={draft.closingLocal}
              onChange={(event) =>
                setDraft({ ...draft, closingLocal: event.target.value })
              }
            />
            <label>Timezone</label>
            <select
              value={draft.timezone}
              onChange={(event) =>
                setDraft({ ...draft, timezone: event.target.value })
              }
            >
              {Object.keys(TIMEZONE_OFFSETS).map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
            <label>Resolution source</label>
            <input
              value={draft.resolutionSource}
              onChange={(event) =>
                setDraft({ ...draft, resolutionSource: event.target.value })
              }
            />
            <button
              style={{ marginTop: 10 }}
              disabled={busy}
              onClick={() => void createMarket()}
            >
              Create market
            </button>
          </div>
        ) : null}

        {markets.map((market) => (
          <button
            key={market.id}
            className={`market-item ${selectedId === market.id ? "active" : ""}`}
            onClick={() => {
              setSelectedId(market.id);
              setSelectedVersionId(null);
            }}
          >
            <div className="spread">
              <strong className="small">{market.title}</strong>
            </div>
            <div className="row tiny muted" style={{ marginTop: 4 }}>
              {market.isDemo ? <span className="chip">demo</span> : null}
              <span>{market.versionCount} language(s)</span>
              {market.publishedCount > 0 ? (
                <span className="chip published">{market.publishedCount} published</span>
              ) : null}
              {market.verifiedCount > 0 ? (
                <span className="chip verified">{market.verifiedCount} verified</span>
              ) : null}
              {market.blockedCount > 0 ? (
                <span className="chip blocked">{market.blockedCount} blocked</span>
              ) : null}
            </div>
          </button>
        ))}
      </aside>

      <main className="main">
        {!detail ? (
          <div className="card">
            <h2>Pick a market</h2>
            <p className="small muted">
              Every language version passes through the same pipeline: extract
              protected facts from the English source, replace them with
              placeholders, translate, verify the placeholders survived,
              restore the values and then re-parse the translation to prove
              every number, date, unit and deadline relation is unchanged.
              Anything that cannot be proven is flagged; publication is gated.
            </p>
          </div>
        ) : (
          <>
            <div className="card">
              <div className="spread">
                <div>
                  <h2>{detail.market.title}</h2>
                  <p className="small muted">
                    <span className="mono">{detail.market.id}</span> · closes{" "}
                    {detail.market.closingAt} ({detail.market.timezone})
                  </p>
                </div>
                <div className="row">
                  <button
                    disabled={busy}
                    onClick={() => void translate()}
                  >
                    Translate all languages
                  </button>
                  {TARGET_LANGUAGES.map((language) => (
                    <button
                      key={language}
                      className="secondary"
                      disabled={busy}
                      onClick={() => void translate([language])}
                    >
                      {LANGUAGE_LABELS[language]}
                    </button>
                  ))}
                </div>
              </div>

              <details style={{ marginTop: 8 }}>
                <summary>English source fields</summary>
                {(
                  [
                    ["title", detail.market.title],
                    ["question", detail.market.question],
                    ["resolutionRules", detail.market.resolutionRules],
                    ["closingAt", `${detail.market.closingAt} (${detail.market.timezone})`],
                    ["resolutionSource", detail.market.resolutionSource],
                  ] as const
                ).map(([field, text]) => (
                  <div key={field} style={{ marginTop: 8 }}>
                    <label>{field}</label>
                    <p className="small">{text}</p>
                  </div>
                ))}
              </details>
            </div>

            <div className="card">
              <h3>Language versions</h3>
              {detail.versions.length === 0 ? (
                <p className="small muted">
                  No translations yet. Run the pipeline to create Hindi, Tamil
                  and Marathi versions.
                </p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Language</th>
                      <th>Status</th>
                      <th>Facts matched</th>
                      <th>Issues</th>
                      <th>Provider</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {detail.versions.map((item) => (
                      <tr key={item.version.versionId}>
                        <td>{LANGUAGE_LABELS[item.version.language]}</td>
                        <td>
                          <StatusBadge status={item.derivedStatus} />
                        </td>
                        <td className="tiny">
                          {item.version.validation
                            ? `${item.version.validation.invariantsMatched}/${item.version.validation.invariantsChecked}`
                            : "—"}
                        </td>
                        <td className="tiny">
                          {item.version.validation
                            ? `${item.version.validation.blockingIssueCount} blocking · ${item.version.validation.reviewIssueCount} review`
                            : "—"}
                        </td>
                        <td className="tiny">
                          {item.version.providerLabel ?? "—"}
                        </td>
                        <td>
                          <button
                            className="secondary tiny-btn"
                            onClick={() =>
                              setSelectedVersionId(item.version.versionId)
                            }
                          >
                            Open workbench
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {selectedVersion && provider ? (
              <VersionWorkbench
                detail={selectedVersion}
                market={detail.market}
                provider={provider}
                onChanged={refresh}
                notify={notify}
              />
            ) : null}
          </>
        )}

        {toast ? (
          <div
            className="toast"
            style={{
              borderColor:
                toast.tone === "ok"
                  ? "rgba(47,191,113,0.6)"
                  : "rgba(229,72,77,0.6)",
            }}
          >
            {toast.message}
          </div>
        ) : null}
      </main>
    </div>
  );
}
