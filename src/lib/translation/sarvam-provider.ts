/**
 * Live translation provider: Sarvam AI Translate.
 *
 * Endpoint documented at https://docs.sarvam.ai/api-reference/text/translate-text
 *   POST {baseUrl}/translate
 *   Header: api-subscription-key: <SARVAM_API_KEY>
 *   Body:   { input, source_language_code, target_language_code, model }
 *   Reply:  { translated_text, request_id, source_language_code }
 *
 * Authentication failures return HTTP 403 (not 401). Rate limits are retried
 * with backoff; auth failures and malformed payloads fail fast. The API key is
 * read from the environment at construction time and is never logged, returned
 * or included in error messages.
 */

import {
  PROVIDER_LANGUAGE_CODES,
  SOURCE_PROVIDER_LANGUAGE_CODE,
} from "@/lib/languages";
import type {
  TranslationProvider,
  TranslationRequest,
  TranslationResponse,
} from "@/lib/translation/types";
import { TranslationProviderError } from "@/lib/translation/types";

export interface SarvamProviderOptions {
  apiKey: string | undefined;
  baseUrl: string;
  model: string;
  timeoutMs?: number;
  maxAttempts?: number;
  /** Injectable for tests so the suite never performs a network call. */
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
}

interface SarvamTranslateResponse {
  translated_text?: unknown;
  request_id?: unknown;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;

function inputLimitForModel(model: string): number {
  return model.includes("mayura") ? 1000 : 2000;
}

/**
 * Splits long protected text on sentence boundaries into chunks below the
 * provider limit. Placeholder tokens are never split internally.
 */
export function splitIntoChunks(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const sentences = text.split(/(?<=[.!?।])\s+/);
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const candidate = current.length === 0 ? sentence : `${current} ${sentence}`;
    if (candidate.length <= limit) {
      current = candidate;
      continue;
    }
    if (current.length > 0) {
      chunks.push(current);
      current = "";
    }
    if (sentence.length <= limit) {
      current = sentence;
      continue;
    }
    // Sentence itself too long: hard-split without cutting a placeholder.
    let remaining = sentence;
    while (remaining.length > limit) {
      let cut = limit;
      const openAt = remaining.lastIndexOf("⟦", cut);
      if (openAt !== -1 && remaining.indexOf("⟧", openAt) === -1) {
        cut = openAt;
      }
      chunks.push(remaining.slice(0, cut).trimEnd());
      remaining = remaining.slice(cut).trimStart();
    }
    current = remaining;
  }
  if (current.length > 0) chunks.push(current);
  return chunks.filter((chunk) => chunk.length > 0);
}

export class SarvamTranslationProvider implements TranslationProvider {
  readonly id = "sarvam-live";
  readonly label = "Sarvam AI (live)";
  readonly isLive = true;
  readonly description =
    "Live translation through the Sarvam AI /translate API. Facts are protected before the call and verified afterwards.";

  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleepImpl: (ms: number) => Promise<void>;

  constructor(options: SarvamProviderOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxAttempts = Math.min(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, 5);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleepImpl =
      options.sleepImpl ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async translate(request: TranslationRequest): Promise<TranslationResponse> {
    if (!this.apiKey || this.apiKey.trim().length === 0) {
      throw new TranslationProviderError({
        code: "missing_credentials",
        providerId: this.id,
        message:
          "SARVAM_API_KEY is not set. Add it to .env.local to enable live translation, or use TRANSLATION_PROVIDER=fixture for the labelled demo fixtures.",
      });
    }

    const targetCode = PROVIDER_LANGUAGE_CODES[request.targetLanguage];
    const fields: TranslationResponse["fields"] = [];
    const requestIds: string[] = [];
    const limit = inputLimitForModel(this.model);

    for (const field of request.fields) {
      const chunks = splitIntoChunks(field.text, limit - 100);
      const translatedChunks: string[] = [];
      for (const chunk of chunks) {
        const { translatedText, requestId } = await this.translateChunk(
          chunk,
          targetCode,
          request.marketId
        );
        translatedChunks.push(translatedText);
        if (requestId) requestIds.push(requestId);
      }
      fields.push({ field: field.field, text: translatedChunks.join(" ") });
    }

    return {
      providerId: this.id,
      providerLabel: this.label,
      isLive: true,
      targetLanguage: request.targetLanguage,
      fields,
      providerRequestIds: requestIds,
      notes: [`Model: ${this.model}`],
    };
  }

  private async translateChunk(
    input: string,
    targetLanguageCode: string,
    marketId: string
  ): Promise<{ translatedText: string; requestId?: string }> {
    let lastError: TranslationProviderError | null = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        return await this.performRequest(input, targetLanguageCode);
      } catch (error) {
        const providerError =
          error instanceof TranslationProviderError
            ? error
            : new TranslationProviderError({
                code: "network_error",
                providerId: this.id,
                message: `Translation request failed for market "${marketId}".`,
                retryable: true,
              });
        lastError = providerError;
        if (!providerError.retryable || attempt === this.maxAttempts) {
          throw providerError;
        }
        await this.sleepImpl(Math.min(250 * 2 ** (attempt - 1), 2000));
      }
    }
    throw (
      lastError ??
      new TranslationProviderError({
        code: "network_error",
        providerId: this.id,
        message: "Translation request failed after retries.",
        retryable: false,
      })
    );
  }

  private async performRequest(
    input: string,
    targetLanguageCode: string
  ): Promise<{ translatedText: string; requestId?: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/translate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-subscription-key": this.apiKey as string,
        },
        body: JSON.stringify({
          input,
          source_language_code: SOURCE_PROVIDER_LANGUAGE_CODE,
          target_language_code: targetLanguageCode,
          model: this.model,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new TranslationProviderError({
          code: "timeout",
          providerId: this.id,
          message: `Sarvam API did not respond within ${this.timeoutMs} ms.`,
          retryable: true,
        });
      }
      throw new TranslationProviderError({
        code: "network_error",
        providerId: this.id,
        message: "Could not reach the Sarvam API. Check network access.",
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 403) {
      throw new TranslationProviderError({
        code: "missing_credentials",
        providerId: this.id,
        status: 403,
        message:
          "Sarvam rejected the API key (HTTP 403). Check SARVAM_API_KEY in .env.local.",
        retryable: false,
      });
    }
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after") ?? "");
      throw new TranslationProviderError({
        code: "rate_limited",
        providerId: this.id,
        status: 429,
        message: Number.isFinite(retryAfter) && retryAfter > 0 && retryAfter <= 5
          ? `Sarvam rate limit reached; retry after ${retryAfter}s.`
          : "Sarvam rate limit reached.",
        retryable: true,
      });
    }
    if (!response.ok) {
      throw new TranslationProviderError({
        code: "http_error",
        providerId: this.id,
        status: response.status,
        message: `Sarvam API returned HTTP ${response.status}.`,
        retryable: response.status >= 500,
      });
    }

    let payload: SarvamTranslateResponse;
    try {
      payload = (await response.json()) as SarvamTranslateResponse;
    } catch {
      throw new TranslationProviderError({
        code: "malformed_response",
        providerId: this.id,
        message: "Sarvam API returned a non-JSON response.",
        retryable: false,
      });
    }

    if (typeof payload.translated_text !== "string") {
      throw new TranslationProviderError({
        code: "malformed_response",
        providerId: this.id,
        message: "Sarvam response is missing the translated_text field.",
        retryable: false,
      });
    }

    return {
      translatedText: payload.translated_text,
      requestId:
        typeof payload.request_id === "string" ? payload.request_id : undefined,
    };
  }
}
