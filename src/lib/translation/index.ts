/**
 * Provider selection.
 *
 * TRANSLATION_PROVIDER=auto      live Sarvam when SARVAM_API_KEY is present,
 *                                curated demo fixtures otherwise
 * TRANSLATION_PROVIDER=sarvam    force live Sarvam (clear error without a key)
 * TRANSLATION_PROVIDER=fixture   force the deterministic demo fixtures
 */

import { SarvamTranslationProvider } from "@/lib/translation/sarvam-provider";
import {
  FixtureTranslationProvider,
  loadFixtureFile,
  type FixtureEntry,
} from "@/lib/translation/fixture-provider";
import type { TranslationProvider } from "@/lib/translation/types";

export type TranslationProviderMode = "auto" | "sarvam" | "fixture";

export interface ProviderEnvironment {
  SARVAM_API_KEY?: string;
  SARVAM_BASE_URL?: string;
  SARVAM_MODEL?: string;
  TRANSLATION_TIMEOUT_MS?: string;
  TRANSLATION_MAX_ATTEMPTS?: string;
  TRANSLATION_PROVIDER?: string;
}

export function parseProviderMode(value: string | undefined): TranslationProviderMode {
  const mode = (value ?? "auto").toLowerCase();
  if (mode === "sarvam" || mode === "fixture") return mode;
  return "auto";
}

export function createFixtureProvider(
  entries?: FixtureEntry[]
): FixtureTranslationProvider {
  const fixtureEntries = entries ?? loadFixtureFile().entries;
  return new FixtureTranslationProvider(fixtureEntries);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function resolveProvider(
  env: ProviderEnvironment = process.env as ProviderEnvironment
): TranslationProvider {
  const mode = parseProviderMode(env.TRANSLATION_PROVIDER);
  const hasKey = Boolean(env.SARVAM_API_KEY && env.SARVAM_API_KEY.trim().length > 0);

  if (mode === "fixture") return createFixtureProvider();

  if (mode === "sarvam" || (mode === "auto" && hasKey)) {
    return new SarvamTranslationProvider({
      apiKey: env.SARVAM_API_KEY,
      baseUrl: env.SARVAM_BASE_URL ?? "https://api.sarvam.ai",
      model: env.SARVAM_MODEL ?? "sarvam-translate:v1",
      timeoutMs: parsePositiveInt(env.TRANSLATION_TIMEOUT_MS, 30_000),
      maxAttempts: parsePositiveInt(env.TRANSLATION_MAX_ATTEMPTS, 3),
    });
  }

  return createFixtureProvider();
}

export function providerModeOf(
  provider: TranslationProvider
): "live" | "demo-fixtures" {
  return provider.isLive ? "live" : "demo-fixtures";
}

export * from "@/lib/translation/types";
