/**
 * Translation provider abstraction.
 *
 * The pipeline, validation and UI depend only on these interfaces, never on a
 * specific vendor. The live provider (Sarvam) and the deterministic demo
 * fixture provider are interchangeable, which also lets tests inject a
 * recording fake without touching the network.
 */

import type { MarketField } from "@/lib/market-schema";
import type { TargetLanguage } from "@/lib/languages";

export interface TranslationFieldRequest {
  field: MarketField;
  /**
   * Text with protected facts replaced by placeholders. Providers must return
   * every placeholder (⟦INV_000⟧) byte-for-byte.
   */
  text: string;
  /** Placeholder ids that must appear in the response for this field. */
  placeholderIds: string[];
}

export interface TranslationRequest {
  marketId: string;
  sourceLanguageCode: string;
  targetLanguage: TargetLanguage;
  targetLanguageCode: string;
  targetLanguageLabel: string;
  fields: TranslationFieldRequest[];
  context: {
    title: string;
    closingAtDisplay: string;
  };
}

export interface TranslatedFieldResponse {
  field: MarketField;
  text: string;
}

export interface TranslationResponse {
  providerId: string;
  providerLabel: string;
  isLive: boolean;
  targetLanguage: TargetLanguage;
  fields: TranslatedFieldResponse[];
  /** Provider request identifiers (safe, non-secret) for the audit trail. */
  providerRequestIds: string[];
  notes: string[];
}

export interface TranslationProvider {
  id: string;
  label: string;
  /** True when the provider performs real network translation. */
  isLive: boolean;
  /** Human explanation shown in the UI ("Demo fixtures - not a live translation"). */
  description: string;
  translate(request: TranslationRequest): Promise<TranslationResponse>;
}

export type TranslationErrorCode =
  | "missing_credentials"
  | "unsupported_language"
  | "input_too_long"
  | "http_error"
  | "rate_limited"
  | "timeout"
  | "network_error"
  | "malformed_response"
  | "fixture_not_found"
  | "fixture_integrity";

export class TranslationProviderError extends Error {
  readonly code: TranslationErrorCode;
  readonly providerId: string;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(options: {
    code: TranslationErrorCode;
    message: string;
    providerId: string;
    status?: number;
    retryable?: boolean;
  }) {
    super(options.message);
    this.name = "TranslationProviderError";
    this.code = options.code;
    this.providerId = options.providerId;
    this.status = options.status;
    const retryableByDefault =
      ["http_error", "rate_limited", "timeout", "network_error"].includes(
        options.code
      ) &&
      (options.status === undefined ||
        options.status >= 500 ||
        options.status === 429);
    this.retryable = options.retryable ?? retryableByDefault;
  }
}
