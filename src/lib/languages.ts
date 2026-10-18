/**
 * Language definitions for Bhasha Markets.
 *
 * The newsroom editorial target is fixed: one English source market must be
 * translated into Hindi, Tamil and Marathi. Every module in this project uses
 * these constants instead of hard-coded language strings so the supported set
 * stays in one place.
 */

export const TARGET_LANGUAGES = ["hi", "ta", "mr"] as const;

export type TargetLanguage = (typeof TARGET_LANGUAGES)[number];

export const SOURCE_LANGUAGE = "en" as const;
export type SourceLanguage = typeof SOURCE_LANGUAGE;

export const LANGUAGE_LABELS: Record<TargetLanguage, string> = {
  hi: "Hindi",
  ta: "Tamil",
  mr: "Marathi",
};

export const LANGUAGE_NATIVE_LABELS: Record<TargetLanguage, string> = {
  hi: "हिन्दी",
  ta: "தமிழ்",
  mr: "मराठी",
};

/** BCP-47 / Sarvam codes used when talking to the live translation provider. */
export const PROVIDER_LANGUAGE_CODES: Record<TargetLanguage, string> = {
  hi: "hi-IN",
  ta: "ta-IN",
  mr: "mr-IN",
};

export const SOURCE_PROVIDER_LANGUAGE_CODE = "en-IN";

export function isTargetLanguage(value: unknown): value is TargetLanguage {
  return (
    typeof value === "string" &&
    (TARGET_LANGUAGES as readonly string[]).includes(value)
  );
}

/**
 * Unicode decimal digit blocks that appear in the languages this workbench
 * supports (Devanagari for Hindi/Marathi, Tamil for Tamil) plus the other
 * major Indian scripts, so a translation that uses any of them normalises
 * cleanly.
 */
export interface DigitBlock {
  name: string;
  zeroCodePoint: number;
  languages: string;
}

export const DIGIT_BLOCKS: readonly DigitBlock[] = [
  { name: "ascii", zeroCodePoint: 0x0030, languages: "ASCII (0-9)" },
  { name: "devanagari", zeroCodePoint: 0x0966, languages: "Hindi, Marathi" },
  { name: "bengali", zeroCodePoint: 0x09e6, languages: "Bengali" },
  { name: "gurmukhi", zeroCodePoint: 0x0a66, languages: "Punjabi" },
  { name: "gujarati", zeroCodePoint: 0x0ae6, languages: "Gujarati" },
  { name: "oriya", zeroCodePoint: 0x0b66, languages: "Odia" },
  { name: "tamil", zeroCodePoint: 0x0be6, languages: "Tamil" },
  { name: "telugu", zeroCodePoint: 0x0c66, languages: "Telugu" },
  { name: "kannada", zeroCodePoint: 0x0ce6, languages: "Kannada" },
  { name: "malayalam", zeroCodePoint: 0x0d66, languages: "Malayalam" },
] as const;
