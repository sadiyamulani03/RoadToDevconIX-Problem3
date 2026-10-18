/**
 * Market schema: the single source of truth for what an English source market
 * and a translated market version look like. All structured data crossing an
 * API boundary is validated with Zod.
 */

import { z } from "zod";
import { TARGET_LANGUAGES } from "@/lib/languages";

/** The five market fields that must be captured and translated. */
export const MARKET_FIELDS = [
  "title",
  "question",
  "resolutionRules",
  "closingAt",
  "resolutionSource",
] as const;

export type MarketField = (typeof MARKET_FIELDS)[number];

export const MARKET_FIELD_LABELS: Record<MarketField, string> = {
  title: "Market title",
  question: "Market question",
  resolutionRules: "Resolution rules",
  closingAt: "Closing date and time",
  resolutionSource: "Resolution source",
};

const ISO_DATETIME_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:?\d{2})$/;

export const MarketSourceSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(80)
    .regex(
      /^[a-z0-9][a-z0-9-]*$/,
      "Market id must be a lowercase slug (letters, digits, dashes)."
    ),
  title: z.string().min(5).max(300),
  question: z.string().min(10).max(1000),
  resolutionRules: z.string().min(10).max(8000),
  /**
   * Machine-readable closing instant in ISO 8601 with an explicit offset,
   * e.g. "2027-06-15T17:30:00+05:30". The editor UI also accepts a local
   * date-time + timezone which is converted to this canonical form.
   */
  closingAt: z
    .string()
    .regex(
      ISO_DATETIME_RE,
      "Closing time must be ISO 8601 with offset, e.g. 2027-06-15T17:30:00+05:30"
    )
    .refine((value) => !Number.isNaN(Date.parse(value)), {
      message: "Closing time must be a real calendar date-time.",
    }),
  /** IANA timezone name used for display and deadline semantics. */
  timezone: z.string().min(1).max(64),
  resolutionSource: z.string().min(3).max(2000),
  /** True for the illustrative demo markets shipped with this repository. */
  isDemo: z.boolean().default(true),
  createdAt: z.string().optional(),
});

export type MarketSource = z.infer<typeof MarketSourceSchema>;

/** A single language's translation of the five market fields. */
export const TranslatedMarketSchema = z.object({
  marketId: z.string().min(1),
  language: z.enum(TARGET_LANGUAGES),
  title: z.string().min(1),
  question: z.string().min(1),
  resolutionRules: z.string().min(1),
  /** Human-readable closing date/time in the target language. */
  closingAt: z.string().min(1),
  resolutionSource: z.string().min(1),
  /** Which provider produced this draft ("sarvam-live" | "fixture-demo"). */
  providerId: z.string().min(1),
  isLiveProvider: z.boolean(),
  translatedAt: z.string().min(1),
});

export type TranslatedMarket = z.infer<typeof TranslatedMarketSchema>;

/** Request payload accepted by POST /api/markets (no id yet). */
export const MarketDraftSchema = MarketSourceSchema.omit({ id: true }).extend({
  id: MarketSourceSchema.shape.id.optional(),
});

/**
 * Caller-facing draft shape: fields with schema defaults (e.g. `isDemo`) are
 * optional here and filled in by `MarketDraftSchema.parse`.
 */
export type MarketDraft = z.input<typeof MarketDraftSchema>;

export function marketFieldText(
  market: MarketSource | TranslatedMarket,
  field: MarketField
): string {
  return market[field];
}

/** Validates a translated market and throws a readable error when invalid. */
export function parseTranslatedMarket(input: unknown): TranslatedMarket {
  return TranslatedMarketSchema.parse(input);
}

export function parseMarketSource(input: unknown): MarketSource {
  return MarketSourceSchema.parse(input);
}
