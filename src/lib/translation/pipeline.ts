/**
 * Translation pipeline.
 *
 * For one English source market, and for every target language (Hindi, Tamil,
 * Marathi):
 *
 *   1. extract invariants deterministically
 *   2. protect every invariant with a placeholder
 *   3. send ALL FIVE fields (including the complete resolution rules) to the
 *      provider in one request
 *   4. verify every placeholder survived the provider call byte-for-byte
 *   5. restore the protected values (rendered into the target script)
 *   6. validate the restored translation against the English source
 *
 * Each language is processed and validated independently; a provider failure
 * or validation failure in one language never hides or blocks another.
 */

import type {
  MarketField,
  MarketSource,
  TranslatedMarket,
} from "@/lib/market-schema";
import { MARKET_FIELDS, TranslatedMarketSchema, MarketSourceSchema } from "@/lib/market-schema";
import {
  LANGUAGE_LABELS,
  PROVIDER_LANGUAGE_CODES,
  SOURCE_PROVIDER_LANGUAGE_CODE,
  TARGET_LANGUAGES,
  type TargetLanguage,
} from "@/lib/languages";
import { formatClosingAtDisplay } from "@/lib/closing-time";
import {
  extractMarketInvariants,
  type MarketInvariantBundle,
} from "@/lib/invariants/extractor";
import {
  protectFieldText,
  restoreFieldText,
  verifyPlaceholders,
  type PlaceholderVerification,
  type ProtectionRecord,
  type RestoredToken,
} from "@/lib/invariants/placeholder-protection";
import {
  validateTranslation,
} from "@/lib/invariants/invariant-validator";
import type { ValidationReport } from "@/lib/invariants/types";
import type {
  TranslationProvider,
  TranslationRequest,
} from "@/lib/translation/types";
import { TranslationProviderError } from "@/lib/translation/types";

export interface PipelineLanguageResult {
  language: TargetLanguage;
  status: "verified" | "needs_review" | "blocked";
  translated?: TranslatedMarket;
  report?: ValidationReport;
  error?: { code: string; message: string };
  protection: ProtectionRecord[];
  placeholderVerifications: PlaceholderVerification[];
  restored: RestoredToken[];
  providerRequestIds: string[];
  providerNotes: string[];
}

export interface TranslationPipelineResult {
  market: MarketSource;
  provider: {
    id: string;
    label: string;
    isLive: boolean;
    description: string;
  };
  requestedLanguages: TargetLanguage[];
  sourceInvariants: MarketInvariantBundle;
  languages: PipelineLanguageResult[];
}

export interface TranslateMarketOptions {
  provider: TranslationProvider;
  languages?: readonly TargetLanguage[];
  /** Render restored values in the target script (default true). */
  renderLocalized?: boolean;
}

function fieldTextsOf(market: MarketSource): Record<MarketField, string> {
  return {
    title: market.title,
    question: market.question,
    resolutionRules: market.resolutionRules,
    closingAt: formatClosingAtDisplay(market),
    resolutionSource: market.resolutionSource,
  };
}

export async function translateMarket(
  marketInput: MarketSource,
  options: TranslateMarketOptions
): Promise<TranslationPipelineResult> {
  const market = MarketSourceSchema.parse(marketInput);
  const provider = options.provider;
  const languages = options.languages ?? TARGET_LANGUAGES;
  const sourceInvariants = extractMarketInvariants(market);
  const fieldTexts = fieldTextsOf(market);
  const results: PipelineLanguageResult[] = [];

  for (const language of languages) {
    const protection = MARKET_FIELDS.map((field) =>
      protectFieldText(fieldTexts[field], sourceInvariants.byField[field], field)
    );

    const request: TranslationRequest = {
      marketId: market.id,
      sourceLanguageCode: SOURCE_PROVIDER_LANGUAGE_CODE,
      targetLanguage: language,
      targetLanguageCode: PROVIDER_LANGUAGE_CODES[language],
      targetLanguageLabel: LANGUAGE_LABELS[language],
      fields: protection.map((record) => ({
        field: record.field,
        text: record.protectedText,
        placeholderIds: record.tokens.map((token) => token.invariant.id),
      })),
      context: {
        title: market.title,
        closingAtDisplay: fieldTexts.closingAt,
      },
    };

    try {
      const response = await provider.translate(request);
      const responseByField = new Map(
        response.fields.map((field) => [field.field, field.text])
      );

      const placeholderVerifications: PlaceholderVerification[] = [];
      const restoredFields: Partial<Record<MarketField, string>> = {};
      const restoredTokens: RestoredToken[] = [];

      for (const record of protection) {
        const text = responseByField.get(record.field);
        if (typeof text !== "string") {
          throw new TranslationProviderError({
            code: "malformed_response",
            providerId: provider.id,
            message: `Provider response is missing the "${record.field}" field for ${LANGUAGE_LABELS[language]}.`,
            retryable: false,
          });
        }
        placeholderVerifications.push(...verifyPlaceholders(text, record));
        const restore = restoreFieldText(text, record, {
          language,
          renderLocalized: options.renderLocalized,
        });
        restoredTokens.push(...restore.restored);
        restoredFields[record.field] = restore.text;
      }

      const translated = TranslatedMarketSchema.parse({
        marketId: market.id,
        language,
        title: restoredFields.title,
        question: restoredFields.question,
        resolutionRules: restoredFields.resolutionRules,
        closingAt: restoredFields.closingAt,
        resolutionSource: restoredFields.resolutionSource,
        providerId: provider.id,
        isLiveProvider: provider.isLive,
        translatedAt: new Date().toISOString(),
      });

      const report = validateTranslation({
        market,
        translated,
        placeholderVerifications,
        restoredFields,
      });

      results.push({
        language,
        status: report.status,
        translated,
        report,
        protection,
        placeholderVerifications,
        restored: restoredTokens,
        providerRequestIds: response.providerRequestIds,
        providerNotes: response.notes,
      });
    } catch (error) {
      const providerError =
        error instanceof TranslationProviderError
          ? error
          : new TranslationProviderError({
              code: "malformed_response",
              providerId: provider.id,
              message:
                error instanceof Error
                  ? error.message
                  : "Unknown translation failure.",
              retryable: false,
            });
      results.push({
        language,
        status: "blocked",
        error: { code: providerError.code, message: providerError.message },
        protection,
        placeholderVerifications: [],
        restored: [],
        providerRequestIds: [],
        providerNotes: [],
      });
    }
  }

  return {
    market,
    provider: {
      id: provider.id,
      label: provider.label,
      isLive: provider.isLive,
      description: provider.description,
    },
    requestedLanguages: [...languages],
    sourceInvariants,
    languages: results,
  };
}
