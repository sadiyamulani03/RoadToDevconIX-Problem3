/**
 * Deterministic demo provider.
 *
 * When no translation API credentials are configured, Bhasha Markets runs on
 * curated translations for the sample markets shipped with the repository.
 * This provider NEVER calls the network and NEVER fabricates an API response:
 * it returns the committed fixture text, and the UI labels every result as
 * "Demo fixtures - not a live translation".
 *
 * Fixture integrity is enforced at runtime: the placeholders present in a
 * fixture must exactly match the placeholders the protected request contained.
 * A mismatch fails loudly instead of silently degrading the demonstration.
 */

import type { MarketField } from "@/lib/market-schema";
import { MARKET_FIELDS } from "@/lib/market-schema";
import { isTargetLanguage, type TargetLanguage } from "@/lib/languages";
import {
  PLACEHOLDER_REGEX,
} from "@/lib/invariants/placeholder-protection";
import type {
  TranslationProvider,
  TranslationRequest,
  TranslationResponse,
} from "@/lib/translation/types";
import { TranslationProviderError } from "@/lib/translation/types";
import fixtureData from "@/lib/translation/fixtures/sample-market-translations.json";

export interface FixtureEntry {
  marketId: string;
  language: TargetLanguage;
  fields: Record<MarketField, string>;
}

export interface FixtureFile {
  version: string;
  description: string;
  disclaimer: string;
  entries: FixtureEntry[];
}

const FIXTURE_DISCLAIMER =
  "Demo fixtures: curated, deterministic translations. This is NOT a live translation and no API credentials are configured.";

function placeholderIdsIn(text: string): string[] {
  const ids: string[] = [];
  for (const match of text.matchAll(PLACEHOLDER_REGEX)) {
    ids.push(`INV_${match[1]}`);
  }
  return ids.sort();
}

function sameMultiset(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
}

export class FixtureTranslationProvider implements TranslationProvider {
  readonly id = "fixture-demo";
  readonly label = "Curated demo fixtures";
  readonly isLive = false;
  readonly description = FIXTURE_DISCLAIMER;

  private readonly index = new Map<
    string,
    Map<TargetLanguage, FixtureEntry>
  >();

  constructor(entries: FixtureEntry[]) {
    for (const entry of entries) {
      if (!isTargetLanguage(entry.language)) continue;
      const byLanguage =
        this.index.get(entry.marketId) ??
        new Map<TargetLanguage, FixtureEntry>();
      byLanguage.set(entry.language, entry);
      this.index.set(entry.marketId, byLanguage);
    }
  }

  get supportedMarketIds(): string[] {
    return [...this.index.keys()].sort();
  }

  async translate(request: TranslationRequest): Promise<TranslationResponse> {
    const entry = this.index.get(request.marketId)?.get(request.targetLanguage);
    if (!entry) {
      throw new TranslationProviderError({
        code: "fixture_not_found",
        providerId: this.id,
        message: `The demo fixture provider has no ${request.targetLanguage} fixtures for market "${request.marketId}". Load one of the sample markets (${this.supportedMarketIds.join(
          ", "
        )}) or set SARVAM_API_KEY in .env.local for live translation of your own market.`,
        retryable: false,
      });
    }

    const fields: TranslationResponse["fields"] = [];
    for (const field of request.fields) {
      const text = entry.fields[field.field];
      if (typeof text !== "string" || text.length === 0) {
        throw new TranslationProviderError({
          code: "fixture_integrity",
          providerId: this.id,
          message: `Fixture for ${request.marketId} (${request.targetLanguage}) is missing the "${field.field}" field.`,
          retryable: false,
        });
      }
      const expected = field.placeholderIds;
      const found = placeholderIdsIn(text);
      if (!sameMultiset(expected, found)) {
        throw new TranslationProviderError({
          code: "fixture_integrity",
          providerId: this.id,
          message: `Fixture for ${request.marketId} (${request.targetLanguage}) field "${field.field}" embeds placeholders [${found.join(
            ", "
          )}] but the protected request expected [${expected.join(", ")}]. Update the fixture or the source market.`,
          retryable: false,
        });
      }
      fields.push({ field: field.field, text });
    }

    return {
      providerId: this.id,
      providerLabel: this.label,
      isLive: false,
      targetLanguage: request.targetLanguage,
      fields,
      providerRequestIds: [`fixture:${request.marketId}:${request.targetLanguage}`],
      notes: [FIXTURE_DISCLAIMER],
    };
  }
}

export function loadFixtureFile(): FixtureFile {
  const file = fixtureData as unknown as FixtureFile;
  for (const entry of file.entries) {
    for (const field of MARKET_FIELDS) {
      if (typeof entry.fields?.[field] !== "string") {
        throw new Error(
          `Fixture data is incomplete: ${entry.marketId}/${entry.language}/${field}`
        );
      }
    }
  }
  return file;
}

export const FIXTURE_PROVIDER_DISCLAIMER = FIXTURE_DISCLAIMER;
