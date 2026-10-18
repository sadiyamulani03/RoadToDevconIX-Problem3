/**
 * Workbench service layer.
 *
 * All story-level operations live here so the API routes, the UI and the
 * acceptance scripts share one implementation:
 *
 *   - create and list markets
 *   - translate a market into one or more languages (live or fixture provider)
 *   - edit a translation, revalidate it, acknowledge linguistic checks
 *   - publish behind the recomputed publication gate
 *   - inject the deterministic demo corruptions used by the demo/acceptance
 *     flow (date shift, magnitude shift, percent shift)
 */

import { randomUUID } from "node:crypto";
import type { MarketDraft, MarketField, MarketSource } from "@/lib/market-schema";
import {
  MARKET_FIELDS,
  MarketDraftSchema,
  MarketSourceSchema,
} from "@/lib/market-schema";
import {
  isTargetLanguage,
  TARGET_LANGUAGES,
  type TargetLanguage,
} from "@/lib/languages";
import { store } from "@/lib/store";
import { createAuditEvent } from "@/lib/audit-log";
import {
  acknowledgeIssue,
  applyTranslationEdit,
  createVersionState,
  deriveStatus,
  revalidateVersion,
  type LanguageVersionState,
} from "@/lib/review-workflow";
import { evaluatePublishGate, type PublishGateResult } from "@/lib/publish-gate";
import {
  providerModeOf,
  resolveProvider,
  type ProviderEnvironment,
} from "@/lib/translation";
import { translateMarket } from "@/lib/translation/pipeline";
import { extractMarketInvariants } from "@/lib/invariants/extractor";
import { renderInvariantForLanguage } from "@/lib/invariants/localized-renderer";
import type { ExtractedInvariant } from "@/lib/invariants/types";

export interface ProviderStatus {
  mode: "live" | "demo-fixtures";
  providerId: string;
  label: string;
  isLive: boolean;
  description: string;
  sarvamKeyConfigured: boolean;
}

export function providerStatus(env: ProviderEnvironment = process.env as ProviderEnvironment): ProviderStatus {
  const provider = resolveProvider(env);
  return {
    mode: providerModeOf(provider),
    providerId: provider.id,
    label: provider.label,
    isLive: provider.isLive,
    description: provider.description,
    sarvamKeyConfigured: Boolean(
      env.SARVAM_API_KEY && env.SARVAM_API_KEY.trim().length > 0
    ),
  };
}

export interface MarketSummary {
  id: string;
  title: string;
  isDemo: boolean;
  closingAt: string;
  timezone: string;
  versionCount: number;
  verifiedCount: number;
  publishedCount: number;
  blockedCount: number;
}

export function listMarketSummaries(): MarketSummary[] {
  return store.listMarkets().map((market) => {
    const versions = store.listVersions(market.id);
    return {
      id: market.id,
      title: market.title,
      isDemo: market.isDemo,
      closingAt: market.closingAt,
      timezone: market.timezone,
      versionCount: versions.length,
      verifiedCount: versions.filter((v) => deriveStatus(v) === "verified").length,
      publishedCount: versions.filter((v) => deriveStatus(v) === "published").length,
      blockedCount: versions.filter((v) => deriveStatus(v) === "blocked").length,
    };
  });
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function createMarket(
  draft: MarketDraft,
  now: () => string = () => new Date().toISOString()
): MarketSource {
  const parsed = MarketDraftSchema.parse(draft);
  let id = parsed.id && parsed.id.length > 0 ? parsed.id : slugify(parsed.title);
  if (id.length === 0) id = `market-${randomUUID().slice(0, 8)}`;
  let candidate = id;
  let suffix = 2;
  while (store.getMarket(candidate)) {
    candidate = `${id}-${suffix}`;
    suffix += 1;
  }
  const at = now();
  const market = MarketSourceSchema.parse({
    ...parsed,
    id: candidate,
    createdAt: at,
  });
  store.saveMarket(market);
  store.appendMarketAudit(
    market.id,
    createAuditEvent({
      at,
      actor: "editor",
      action: "market_created",
      marketId: market.id,
      summary: `Market "${market.title}" created.`,
      details: { isDemo: market.isDemo },
    })
  );
  return market;
}

export interface TranslateResult {
  marketId: string;
  versions: LanguageVersionState[];
  provider: ProviderStatus;
}

export async function translateMarketVersion(
  marketId: string,
  languages: readonly TargetLanguage[] = TARGET_LANGUAGES,
  options: { env?: ProviderEnvironment; now?: () => string } = {}
): Promise<TranslateResult> {
  const market = store.getMarket(marketId);
  if (!market) throw new Error(`Unknown market "${marketId}".`);
  const requested = languages.filter(isTargetLanguage);
  if (requested.length === 0) {
    throw new Error("At least one target language is required.");
  }

  const env = options.env ?? (process.env as ProviderEnvironment);
  const now = options.now ?? (() => new Date().toISOString());
  const provider = resolveProvider(env);

  store.appendMarketAudit(
    marketId,
    createAuditEvent({
      at: now(),
      actor: "editor",
      action: "translation_requested",
      marketId,
      summary: `Translation requested for ${requested.join(", ")} via ${provider.label}.`,
      details: { providerId: provider.id, isLive: provider.isLive },
    })
  );

  const result = await translateMarket(market, {
    provider,
    languages: requested,
  });

  const versions: LanguageVersionState[] = [];
  for (const language of result.languages) {
    const at = now();
    const state = createVersionState({
      marketId,
      language: language.language,
      translated: language.translated,
      validation: language.report,
      providerId: result.provider.id,
      providerLabel: result.provider.label,
      isLiveProvider: result.provider.isLive,
      providerRequestIds: language.providerRequestIds,
      error: language.error,
      at,
    });

    if (language.translated) {
      state.audit = [
        ...state.audit,
        createAuditEvent({
          at,
          actor: "system",
          action: "translation_received",
          marketId,
          language: language.language,
          summary: `${result.provider.label} returned a draft${
            result.provider.isLive ? "" : " (demo fixtures, not a live translation)"
          }.`,
          details: providerRequestIds(language.providerRequestIds, result.provider.id),
        }),
      ];
    } else if (language.error) {
      state.audit = [
        ...state.audit,
        createAuditEvent({
          at,
          actor: "system",
          action: "translation_failed",
          marketId,
          language: language.language,
          summary: `Translation failed: ${language.error.message}`,
          details: { code: language.error.code },
        }),
      ];
    }

    if (language.report) {
      state.audit = [
        ...state.audit,
        createAuditEvent({
          at,
          actor: "system",
          action: "validation_completed",
          marketId,
          language: language.language,
          previousStatus: "translating",
          newStatus: deriveStatus(state),
          summary:
            language.report.status === "verified"
              ? `Validation passed: ${language.report.invariantsMatched}/${language.report.invariantsChecked} protected facts matched.`
              : language.report.status === "needs_review"
                ? `Validation needs review: ${language.report.reviewIssueCount} item(s) require a human decision.`
                : `Validation blocked: ${language.report.blockingIssueCount} protected fact(s) failed.`,
          details: {
            status: language.report.status,
            invariantsChecked: language.report.invariantsChecked,
            invariantsMatched: language.report.invariantsMatched,
            blockingIssues: language.report.blockingIssueCount,
            reviewIssues: language.report.reviewIssueCount,
          },
        }),
      ];
    }

    state.status = deriveStatus(state);
    store.saveVersion(state);
    versions.push(state);
  }

  return { marketId, versions, provider: providerStatus(env) };
}

function providerRequestIds(
  ids: string[],
  providerId: string
): Record<string, unknown> {
  return { providerId, requestIds: ids };
}

export interface VersionDetail {
  version: LanguageVersionState;
  derivedStatus: LanguageVersionState["status"];
  gate: PublishGateResult;
}

export function getVersionDetail(versionId: string): VersionDetail | undefined {
  const version = store.getVersion(versionId);
  if (!version) return undefined;
  return {
    version,
    derivedStatus: deriveStatus(version),
    gate: evaluatePublishGate(version),
  };
}

export function getMarketDetail(marketId: string):
  | {
      market: MarketSource;
      versions: VersionDetail[];
      provider: ProviderStatus;
    }
  | undefined {
  const market = store.getMarket(marketId);
  if (!market) return undefined;
  return {
    market,
    versions: store
      .listVersions(marketId)
      .map((version) => ({
        version,
        derivedStatus: deriveStatus(version),
        gate: evaluatePublishGate(version),
      })),
    provider: providerStatus(),
  };
}

export interface EditVersionInput {
  versionId: string;
  field: MarketField;
  text: string;
  editor: string;
}

export function editVersion(input: EditVersionInput): LanguageVersionState {
  const version = requireVersion(input.versionId);
  if (!MARKET_FIELDS.includes(input.field)) {
    throw new Error(`Unknown field "${input.field}".`);
  }
  const next = applyTranslationEdit(version, {
    field: input.field,
    text: input.text,
    editor: input.editor,
    at: new Date().toISOString(),
  });
  store.saveVersion(next);
  return next;
}

export function revalidateVersionById(versionId: string): LanguageVersionState {
  const version = requireVersion(versionId);
  const market = requireMarket(version.marketId);
  const next = revalidateVersion(
    version,
    market,
    new Date().toISOString(),
    "reviewer"
  );
  store.saveVersion(next);
  return next;
}

export function acknowledgeVersionIssue(input: {
  versionId: string;
  issueId: string;
  reviewer: string;
  note: string;
}): { ok: boolean; error?: string; state: LanguageVersionState } {
  const version = requireVersion(input.versionId);
  const result = acknowledgeIssue(version, {
    issueId: input.issueId,
    reviewer: input.reviewer,
    note: input.note,
    at: new Date().toISOString(),
  });
  if (result.ok) store.saveVersion(result.state);
  return result;
}

export interface PublishOutcome {
  ok: boolean;
  gate: PublishGateResult;
  state: LanguageVersionState;
}

/**
 * The only path to "published". The gate is recomputed from the current data
 * inside `evaluatePublishGate`; a matching status label counts for nothing.
 */
export function publishVersion(versionId: string): PublishOutcome {
  const version = requireVersion(versionId);
  const at = new Date().toISOString();
  const gate = evaluatePublishGate(version);

  if (!gate.allowed) {
    const blocked: LanguageVersionState = {
      ...version,
      updatedAt: at,
      audit: [
        ...version.audit,
        createAuditEvent({
          at,
          actor: "editor",
          action: "publish_blocked",
          marketId: version.marketId,
          language: version.language,
          previousStatus: version.status,
          newStatus: gate.derivedStatus,
          summary: gate.summary,
          details: {
            reasons: gate.reasons.map((reason) => reason.code),
            blockingIssues: gate.reasons
              .flatMap((reason) => reason.issues ?? [])
              .filter((issue) => issue.severity === "blocking")
              .map((issue) => issue.issueId),
          },
        }),
      ],
    };
    store.saveVersion(blocked);
    return { ok: false, gate, state: blocked };
  }

  const published: LanguageVersionState = {
    ...version,
    status: "published",
    updatedAt: at,
    audit: [
      ...version.audit,
      createAuditEvent({
        at,
        actor: "editor",
        action: "publish_attempted",
        marketId: version.marketId,
        language: version.language,
        previousStatus: version.status,
        summary: "Publish requested; running the publication gate.",
      }),
      createAuditEvent({
        at,
        actor: "system",
        action: "published",
        marketId: version.marketId,
        language: version.language,
        previousStatus: version.status,
        newStatus: "published",
        summary:
          "Published. All protected facts verified against the English source.",
      }),
    ],
  };
  store.saveVersion(published);
  return { ok: true, gate, state: published };
}

function requireVersion(versionId: string): LanguageVersionState {
  const version = store.getVersion(versionId);
  if (!version) throw new Error(`Unknown version "${versionId}".`);
  return version;
}

function requireMarket(marketId: string): MarketSource {
  const market = store.getMarket(marketId);
  if (!market) throw new Error(`Unknown market "${marketId}".`);
  return market;
}

/* ------------------------------------------------------------------------ */
/* Demo corruptions                                                          */
/* ------------------------------------------------------------------------ */

export type DemoCorruptionKind =
  | "date_shift"
  | "magnitude_shift"
  | "percent_shift";

export const DEMO_CORRUPTION_KINDS: readonly DemoCorruptionKind[] = [
  "date_shift",
  "magnitude_shift",
  "percent_shift",
];

export interface CorruptionResult {
  ok: boolean;
  error?: string;
  state?: LanguageVersionState;
  kind?: DemoCorruptionKind;
  field?: MarketField;
  from?: string;
  to?: string;
}

const MAGNITUDE_MULTIPLIERS: Record<string, number> = {
  hundred: 100,
  thousand: 1_000,
  lakh: 100_000,
  crore: 10_000_000,
  million: 1_000_000,
  billion: 1_000_000_000,
};

function nextMagnitude(canonical: string): string {
  switch (canonical) {
    case "lakh":
      return "crore";
    case "crore":
      return "lakh";
    case "thousand":
      return "lakh";
    case "million":
      return "billion";
    case "billion":
      return "million";
    case "hundred":
      return "thousand";
    default:
      return "lakh";
  }
}

function addDaysToISO(dateISO: string, days: number): string {
  const [year, month, day] = dateISO.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(
    date.getUTCDate()
  )}`;
}

function replaceFirst(
  text: string,
  search: string,
  replacement: string
): string | undefined {
  const at = text.indexOf(search);
  if (at === -1) return undefined;
  return text.slice(0, at) + replacement + text.slice(at + search.length);
}

interface CorruptionCandidate {
  field: MarketField;
  invariant: ExtractedInvariant;
  synthetic: ExtractedInvariant;
}

/**
 * Injects a realistic translation error into the CURRENT translated text by
 * rewriting the deterministic rendering of one protected value. The rewritten
 * text is applied through the normal reviewer-edit path, so it invalidates the
 * previous verification exactly like a human edit would — then revalidating
 * must fail with a blocking issue. Nothing is shown as "verified" because it
 * once was.
 */
export function injectDemoCorruption(input: {
  marketId: string;
  language: TargetLanguage;
  kind: DemoCorruptionKind;
}): CorruptionResult {
  const market = store.getMarket(input.marketId);
  if (!market) return { ok: false, error: `Unknown market "${input.marketId}".` };
  const version = store.findVersion(input.marketId, input.language);
  if (!version || !version.translated) {
    return {
      ok: false,
      error: `No ${input.language} translation exists yet. Translate the market first.`,
    };
  }

  const bundle = extractMarketInvariants(market);
  const candidates = corruptionCandidates(bundle.all, input.kind);
  if (candidates.length === 0) {
    return {
      ok: false,
      error: `This market has no protected value suitable for a ${input.kind} demonstration.`,
    };
  }

  for (const candidate of candidates) {
    const source = renderInvariantForLanguage(candidate.invariant, input.language);
    const corrupted = renderInvariantForLanguage(candidate.synthetic, input.language);
    if (!source || !corrupted || source === corrupted) continue;
    const originalText = version.translated[candidate.field];
    const nextText = replaceFirst(originalText, source, corrupted);
    if (nextText === undefined) continue;

    const at = new Date().toISOString();
    const edited = applyTranslationEdit(version, {
      field: candidate.field,
      text: nextText,
      editor: "demo-corruption",
      at,
    });
    const withAudit: LanguageVersionState = {
      ...edited,
      audit: [
        ...edited.audit,
        createAuditEvent({
          at,
          actor: "demo",
          action: "demo_corruption_injected",
          marketId: input.marketId,
          language: input.language,
          field: candidate.field,
          previousStatus: version.status,
          newStatus: "needs_review",
          summary: `Demo corruption (${input.kind}): changed "${source}" to "${corrupted}". Revalidate to see the gate catch it.`,
          details: {
            kind: input.kind,
            from: source,
            to: corrupted,
            invariantId: candidate.invariant.id,
          },
        }),
      ],
    };
    store.saveVersion(withAudit);
    return {
      ok: true,
      state: withAudit,
      kind: input.kind,
      field: candidate.field,
      from: source,
      to: corrupted,
    };
  }

  return {
    ok: false,
    error: `Could not find the rendered value for a ${input.kind} demonstration in the current text.`,
  };
}

function corruptionCandidates(
  invariants: ExtractedInvariant[],
  kind: DemoCorruptionKind
): CorruptionCandidate[] {
  const byField = [...invariants].sort((a, b) => a.start - b.start);

  if (kind === "date_shift") {
    return byField
      .filter(
        (invariant) =>
          invariant.kind === "date" &&
          invariant.dateISO !== undefined &&
          invariant.confidence === "high"
      )
      .map((invariant) => ({
        field: invariant.field,
        invariant,
        synthetic: {
          ...invariant,
          dateISO: addDaysToISO(invariant.dateISO!, 1),
          raw: `${invariant.raw} (shifted)`,
        },
      }));
  }

  if (kind === "percent_shift") {
    return byField
      .filter(
        (invariant) =>
          invariant.kind === "percent" && invariant.numericValue !== undefined
      )
      .map((invariant) => {
        const shifted = invariant.numericValue! + 1;
        return {
          field: invariant.field,
          invariant,
          synthetic: {
            ...invariant,
            numericValue: shifted,
            raw: invariant.raw.replace(
              /[\d][\d,.]*/,
              String(shifted)
            ),
          },
        };
      });
  }

  const moneyWithMagnitude = byField.filter(
    (invariant) =>
      invariant.kind === "money" &&
      invariant.magnitudeWord !== undefined &&
      invariant.numericValue !== undefined
  );
  if (moneyWithMagnitude.length > 0) {
    return moneyWithMagnitude.map((invariant) => {
      const oldMultiplier =
        MAGNITUDE_MULTIPLIERS[invariant.magnitudeWord!] ?? 1;
      const base = invariant.numericValue! / oldMultiplier;
      const nextWord = nextMagnitude(invariant.magnitudeWord!);
      return {
        field: invariant.field,
        invariant,
        synthetic: {
          ...invariant,
          magnitudeWord: nextWord,
          numericValue: base * (MAGNITUDE_MULTIPLIERS[nextWord] ?? 1),
          raw: `${invariant.raw} (magnitude changed)`,
        },
      };
    });
  }

  const quantities = byField.filter(
    (invariant) =>
      invariant.kind === "quantity" && invariant.numericValue !== undefined
  );
  if (quantities.length > 0) {
    const sorted = [...quantities].sort(
      (a, b) => (b.numericValue ?? 0) - (a.numericValue ?? 0)
    );
    return sorted.map((invariant) => ({
      field: invariant.field,
      invariant,
      synthetic: {
        ...invariant,
        numericValue: invariant.numericValue! * 10,
      },
    }));
  }

  return byField
    .filter(
      (invariant) =>
        invariant.kind === "percent" && invariant.numericValue !== undefined
    )
    .map((invariant) => {
      const shifted = invariant.numericValue! * 10;
      return {
        field: invariant.field,
        invariant,
        synthetic: {
          ...invariant,
          numericValue: shifted,
          raw: invariant.raw.replace(/[\d][\d,.]*/, String(shifted)),
        },
      };
    });
}
