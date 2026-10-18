/**
 * Bilingual lexicons used by the deterministic extractor.
 *
 * Everything in this file is plain data: month names, number words, magnitude
 * words (lakh / crore), measurement units, currency markers and deadline
 * relation words in English, Hindi, Marathi and Tamil. The extractor and the
 * validator build their regular expressions from these tables, which keeps
 * behaviour explainable and easy to extend.
 */

import type { DeadlineRelation, InvariantKind } from "@/lib/invariants/types";
import type { TargetLanguage } from "@/lib/languages";

export interface MonthEntry {
  name: string;
  month: number;
  language: "en" | "hi" | "mr" | "ta";
}

/** Month names in all four languages, lowercase where applicable. */
export const MONTH_ENTRIES: readonly MonthEntry[] = [
  // English
  { name: "january", month: 1, language: "en" },
  { name: "february", month: 2, language: "en" },
  { name: "march", month: 3, language: "en" },
  { name: "april", month: 4, language: "en" },
  { name: "may", month: 5, language: "en" },
  { name: "june", month: 6, language: "en" },
  { name: "july", month: 7, language: "en" },
  { name: "august", month: 8, language: "en" },
  { name: "september", month: 9, language: "en" },
  { name: "october", month: 10, language: "en" },
  { name: "november", month: 11, language: "en" },
  { name: "december", month: 12, language: "en" },
  { name: "jan", month: 1, language: "en" },
  { name: "feb", month: 2, language: "en" },
  { name: "mar", month: 3, language: "en" },
  { name: "apr", month: 4, language: "en" },
  { name: "jun", month: 6, language: "en" },
  { name: "jul", month: 7, language: "en" },
  { name: "aug", month: 8, language: "en" },
  { name: "sep", month: 9, language: "en" },
  { name: "sept", month: 9, language: "en" },
  { name: "oct", month: 10, language: "en" },
  { name: "nov", month: 11, language: "en" },
  { name: "dec", month: 12, language: "en" },
  // Hindi
  { name: "जनवरी", month: 1, language: "hi" },
  { name: "फरवरी", month: 2, language: "hi" },
  { name: "फ़रवरी", month: 2, language: "hi" },
  { name: "मार्च", month: 3, language: "hi" },
  { name: "अप्रैल", month: 4, language: "hi" },
  { name: "मई", month: 5, language: "hi" },
  { name: "जून", month: 6, language: "hi" },
  { name: "जुलाई", month: 7, language: "hi" },
  { name: "अगस्त", month: 8, language: "hi" },
  { name: "सितंबर", month: 9, language: "hi" },
  { name: "सितम्बर", month: 9, language: "hi" },
  { name: "अक्टूबर", month: 10, language: "hi" },
  { name: "अक्तूबर", month: 10, language: "hi" },
  { name: "नवंबर", month: 11, language: "hi" },
  { name: "नवम्बर", month: 11, language: "hi" },
  { name: "दिसंबर", month: 12, language: "hi" },
  { name: "दिसम्बर", month: 12, language: "hi" },
  // Marathi
  { name: "जानेवारी", month: 1, language: "mr" },
  { name: "फेब्रुवारी", month: 2, language: "mr" },
  { name: "मार्च", month: 3, language: "mr" },
  { name: "एप्रिल", month: 4, language: "mr" },
  { name: "मे", month: 5, language: "mr" },
  { name: "जून", month: 6, language: "mr" },
  { name: "जुलै", month: 7, language: "mr" },
  { name: "ऑगस्ट", month: 8, language: "mr" },
  { name: "सप्टेंबर", month: 9, language: "mr" },
  { name: "ऑक्टोबर", month: 10, language: "mr" },
  { name: "नोव्हेंबर", month: 11, language: "mr" },
  { name: "डिसेंबर", month: 12, language: "mr" },
  // Tamil
  { name: "ஜனவரி", month: 1, language: "ta" },
  { name: "பிப்ரவரி", month: 2, language: "ta" },
  { name: "மார்ச்", month: 3, language: "ta" },
  { name: "ஏப்ரல்", month: 4, language: "ta" },
  { name: "மே", month: 5, language: "ta" },
  { name: "ஜூன்", month: 6, language: "ta" },
  { name: "சூன்", month: 6, language: "ta" },
  { name: "ஜூலை", month: 7, language: "ta" },
  { name: "ஆகஸ்ட்", month: 8, language: "ta" },
  { name: "செப்டம்பர்", month: 9, language: "ta" },
  { name: "அக்டோபர்", month: 10, language: "ta" },
  { name: "நவம்பர்", month: 11, language: "ta" },
  { name: "டிசம்பர்", month: 12, language: "ta" },
] as const;

/** Distribution month names used by an official agency (e.g. IMD) to render dates. */
export const TARGET_MONTH_NAMES: Record<TargetLanguage, readonly string[]> = {
  hi: [
    "",
    "जनवरी",
    "फरवरी",
    "मार्च",
    "अप्रैल",
    "मई",
    "जून",
    "जुलाई",
    "अगस्त",
    "सितंबर",
    "अक्टूबर",
    "नवंबर",
    "दिसंबर",
  ],
  mr: [
    "",
    "जानेवारी",
    "फेब्रुवारी",
    "मार्च",
    "एप्रिल",
    "मे",
    "जून",
    "जुलै",
    "ऑगस्ट",
    "सप्टेंबर",
    "ऑक्टोबर",
    "नोव्हेंबर",
    "डिसेंबर",
  ],
  ta: [
    "",
    "ஜனவரி",
    "பிப்ரவரி",
    "மார்ச்",
    "ஏப்ரல்",
    "மே",
    "ஜூன்",
    "ஜூலை",
    "ஆகஸ்ட்",
    "செப்டம்பர்",
    "அக்டோபர்",
    "நவம்பர்",
    "டிசம்பர்",
  ],
};

export interface MagnitudeEntry {
  word: string;
  multiplier: number;
  /** Canonical name used in messages and rendering. */
  canonical: "hundred" | "thousand" | "lakh" | "crore" | "million" | "billion";
}

/** Multiplier words including Indian numbering (lakh, crore). */
export const MAGNITUDE_ENTRIES: readonly MagnitudeEntry[] = [
  { word: "hundred", multiplier: 100, canonical: "hundred" },
  { word: "thousand", multiplier: 1_000, canonical: "thousand" },
  { word: "lakh", multiplier: 100_000, canonical: "lakh" },
  { word: "lakhs", multiplier: 100_000, canonical: "lakh" },
  { word: "lac", multiplier: 100_000, canonical: "lakh" },
  { word: "lacs", multiplier: 100_000, canonical: "lakh" },
  { word: "crore", multiplier: 10_000_000, canonical: "crore" },
  { word: "crores", multiplier: 10_000_000, canonical: "crore" },
  { word: "million", multiplier: 1_000_000, canonical: "million" },
  { word: "billion", multiplier: 1_000_000_000, canonical: "billion" },
  { word: "सौ", multiplier: 100, canonical: "hundred" },
  { word: "शे", multiplier: 100, canonical: "hundred" },
  { word: "நூறு", multiplier: 100, canonical: "hundred" },
  { word: "हजार", multiplier: 1_000, canonical: "thousand" },
  { word: "हज़ार", multiplier: 1_000, canonical: "thousand" },
  { word: "ஆயிரம்", multiplier: 1_000, canonical: "thousand" },
  { word: "लाख", multiplier: 100_000, canonical: "lakh" },
  { word: "लक्ष", multiplier: 100_000, canonical: "lakh" },
  { word: "லட்சம்", multiplier: 100_000, canonical: "lakh" },
  { word: "करोड़", multiplier: 10_000_000, canonical: "crore" },
  { word: "कोटी", multiplier: 10_000_000, canonical: "crore" },
  { word: "கோடி", multiplier: 10_000_000, canonical: "crore" },
  { word: "मिलियन", multiplier: 1_000_000, canonical: "million" },
  { word: "மில்லியன்", multiplier: 1_000_000, canonical: "million" },
  { word: "बिलियन", multiplier: 1_000_000_000, canonical: "billion" },
  { word: "பில்லியன்", multiplier: 1_000_000_000, canonical: "billion" },
] as const;

export interface NumberWordEntry {
  word: string;
  value: number;
}

/**
 * Number words for small values. Combined with a magnitude word these form
 * expressions like "one lakh" / "एक लाख" / "ஒரு லட்சம்".
 */
export const NUMBER_WORD_ENTRIES: readonly NumberWordEntry[] = [
  { word: "one", value: 1 },
  { word: "two", value: 2 },
  { word: "three", value: 3 },
  { word: "four", value: 4 },
  { word: "five", value: 5 },
  { word: "six", value: 6 },
  { word: "seven", value: 7 },
  { word: "eight", value: 8 },
  { word: "nine", value: 9 },
  { word: "ten", value: 10 },
  { word: "eleven", value: 11 },
  { word: "twelve", value: 12 },
  { word: "twenty", value: 20 },
  { word: "twenty-five", value: 25 },
  { word: "thirty", value: 30 },
  { word: "forty", value: 40 },
  { word: "fifty", value: 50 },
  { word: "sixty", value: 60 },
  { word: "seventy", value: 70 },
  { word: "eighty", value: 80 },
  { word: "ninety", value: 90 },
  { word: "एक", value: 1 },
  { word: "दो", value: 2 },
  { word: "दोन", value: 2 },
  { word: "तीन", value: 3 },
  { word: "चार", value: 4 },
  { word: "पांच", value: 5 },
  { word: "पाँच", value: 5 },
  { word: "पाच", value: 5 },
  { word: "छह", value: 6 },
  { word: "छः", value: 6 },
  { word: "सहा", value: 6 },
  { word: "सात", value: 7 },
  { word: "आठ", value: 8 },
  { word: "नौ", value: 9 },
  { word: "नऊ", value: 9 },
  { word: "दस", value: 10 },
  { word: "दहा", value: 10 },
  { word: "बीस", value: 20 },
  { word: "वीस", value: 20 },
  { word: "पचास", value: 50 },
  { word: "पन्नास", value: 50 },
  { word: "ஒரு", value: 1 },
  { word: "ஒன்று", value: 1 },
  { word: "இரண்டு", value: 2 },
  { word: "இரு", value: 2 },
  { word: "மூன்று", value: 3 },
  { word: "நான்கு", value: 4 },
  { word: "ஐந்து", value: 5 },
  { word: "ஆறு", value: 6 },
  { word: "ஏழு", value: 7 },
  { word: "எட்டு", value: 8 },
  { word: "ஒன்பது", value: 9 },
  { word: "பத்து", value: 10 },
  { word: "இருபது", value: 20 },
  { word: "ஐம்பது", value: 50 },
] as const;

/** Canonical units and their unit labels for messages. */
export const UNIT_LABELS: Record<string, string> = {
  day: "days",
  week: "weeks",
  month: "months",
  year: "years",
  hour: "hours",
  minute: "minutes",
  second: "seconds",
  basis_point: "basis points",
  percentage_point: "percentage points",
  seat: "seats",
  vote: "votes",
  hectare: "hectares",
  mm: "millimetres",
  cm: "centimetres",
  km: "kilometres",
  kg: "kilograms",
  tonne: "tonnes",
  degree_celsius: "degrees Celsius",
  station: "stations",
  wicket: "wickets",
  run: "runs",
  passenger: "passengers",
  vehicle: "vehicles",
  rupee: "rupees",
};

export interface UnitEntry {
  word: string;
  unit: string;
}

/** Measurement / count unit words mapped to canonical units. */
export const UNIT_ENTRIES: readonly UnitEntry[] = [
  { word: "days", unit: "day" },
  { word: "day", unit: "day" },
  { word: "weeks", unit: "week" },
  { word: "week", unit: "week" },
  { word: "months", unit: "month" },
  { word: "month", unit: "month" },
  { word: "years", unit: "year" },
  { word: "year", unit: "year" },
  { word: "hours", unit: "hour" },
  { word: "hour", unit: "hour" },
  { word: "minutes", unit: "minute" },
  { word: "minute", unit: "minute" },
  { word: "seconds", unit: "second" },
  { word: "second", unit: "second" },
  { word: "basis points", unit: "basis_point" },
  { word: "basis point", unit: "basis_point" },
  { word: "bps", unit: "basis_point" },
  { word: "percentage points", unit: "percentage_point" },
  { word: "percentage point", unit: "percentage_point" },
  { word: "percent points", unit: "percentage_point" },
  { word: "percent point", unit: "percentage_point" },
  { word: "seats", unit: "seat" },
  { word: "seat", unit: "seat" },
  { word: "votes", unit: "vote" },
  { word: "vote", unit: "vote" },
  { word: "hectares", unit: "hectare" },
  { word: "hectare", unit: "hectare" },
  { word: "millimetres", unit: "mm" },
  { word: "millimeters", unit: "mm" },
  { word: "millimetre", unit: "mm" },
  { word: "millimeter", unit: "mm" },
  { word: "mm", unit: "mm" },
  { word: "centimetres", unit: "cm" },
  { word: "centimeters", unit: "cm" },
  { word: "cm", unit: "cm" },
  { word: "kilometres", unit: "km" },
  { word: "kilometers", unit: "km" },
  { word: "km", unit: "km" },
  { word: "kilograms", unit: "kg" },
  { word: "kilogram", unit: "kg" },
  { word: "kg", unit: "kg" },
  { word: "tonnes", unit: "tonne" },
  { word: "tonne", unit: "tonne" },
  { word: "tons", unit: "tonne" },
  { word: "ton", unit: "tonne" },
  { word: "degrees celsius", unit: "degree_celsius" },
  { word: "degree celsius", unit: "degree_celsius" },
  { word: "stations", unit: "station" },
  { word: "station", unit: "station" },
  { word: "passengers", unit: "passenger" },
  { word: "passenger", unit: "passenger" },
  { word: "vehicles", unit: "vehicle" },
  { word: "vehicle", unit: "vehicle" },
  { word: "दिन", unit: "day" },
  { word: "दिनों", unit: "day" },
  { word: "दिवस", unit: "day" },
  { word: "दिवसां", unit: "day" },
  { word: "दिवसांत", unit: "day" },
  { word: "நாள்", unit: "day" },
  { word: "நாட்கள்", unit: "day" },
  { word: "நாட்களில்", unit: "day" },
  { word: "நாட்களுக்கு", unit: "day" },
  { word: "सप्ताह", unit: "week" },
  { word: "सप्ताहों", unit: "week" },
  { word: "हफ्ते", unit: "week" },
  { word: "हफ्ता", unit: "week" },
  { word: "आठवडा", unit: "week" },
  { word: "आठवडे", unit: "week" },
  { word: "आठवड्यां", unit: "week" },
  { word: "வாரம்", unit: "week" },
  { word: "வாரங்கள்", unit: "week" },
  { word: "महीना", unit: "month" },
  { word: "महीने", unit: "month" },
  { word: "महीनों", unit: "month" },
  { word: "माह", unit: "month" },
  { word: "महिना", unit: "month" },
  { word: "महिने", unit: "month" },
  { word: "महिन्यां", unit: "month" },
  { word: "மாதம்", unit: "month" },
  { word: "மாதங்கள்", unit: "month" },
  { word: "மாதங்களில்", unit: "month" },
  { word: "साल", unit: "year" },
  { word: "सालों", unit: "year" },
  { word: "वर्ष", unit: "year" },
  { word: "वर्षों", unit: "year" },
  { word: "वर्षां", unit: "year" },
  { word: "ஆண்டு", unit: "year" },
  { word: "ஆண்டுகள்", unit: "year" },
  { word: "வருடம்", unit: "year" },
  { word: "घंटा", unit: "hour" },
  { word: "घंटे", unit: "hour" },
  { word: "तास", unit: "hour" },
  { word: "மணி", unit: "hour" },
  { word: "மணிநேரம்", unit: "hour" },
  { word: "मिनट", unit: "minute" },
  { word: "மினிடம்", unit: "minute" },
  { word: "நிமிடம்", unit: "minute" },
  { word: "நிமிடங்கள்", unit: "minute" },
  { word: "आधार अंक", unit: "basis_point" },
  { word: "बेसिस पॉइंट", unit: "basis_point" },
  { word: "बेसिस पॉइंट्स", unit: "basis_point" },
  { word: "ஆதார புள்ளிகள்", unit: "basis_point" },
  { word: "सीटें", unit: "seat" },
  { word: "सीट", unit: "seat" },
  { word: "जागा", unit: "seat" },
  { word: "जागां", unit: "seat" },
  { word: "இடங்கள்", unit: "seat" },
  { word: "இடம்", unit: "seat" },
  { word: "वोट", unit: "vote" },
  { word: "मते", unit: "vote" },
  { word: "वாக்கு", unit: "vote" },
  { word: "வாக்குகள்", unit: "vote" },
  { word: "हेक्टेयर", unit: "hectare" },
  { word: "हेक्टर", unit: "hectare" },
  { word: "ஹெக்டேர்", unit: "hectare" },
  { word: "மிமீ", unit: "mm" },
  { word: "मिमी", unit: "mm" },
  { word: "सेंटीमीटर", unit: "cm" },
  { word: "सेमी", unit: "cm" },
  { word: "செமீ", unit: "cm" },
  { word: "கிலோமீட்டர்", unit: "km" },
  { word: "किमी", unit: "km" },
  { word: "கிமீ", unit: "km" },
  { word: "किलो", unit: "kg" },
  { word: "கிலோ", unit: "kg" },
  { word: "टन", unit: "tonne" },
  { word: "டன்", unit: "tonne" },
] as const;

/** First-match-wins rendering table: canonical unit -> target-language word. */
export const TARGET_UNIT_WORDS: Record<
  TargetLanguage,
  Record<string, string>
> = {
  hi: {
    day: "दिन",
    week: "सप्ताह",
    month: "महीने",
    year: "वर्ष",
    hour: "घंटे",
    minute: "मिनट",
    second: "सेकंड",
    basis_point: "आधार अंक",
    percentage_point: "प्रतिशत अंक",
    seat: "सीटें",
    vote: "वोट",
    hectare: "हेक्टेयर",
    mm: "मिमी",
    cm: "सेमी",
    km: "किमी",
    kg: "किलो",
    tonne: "टन",
    degree_celsius: "डिग्री सेल्सियस",
    station: "स्टेशन",
    passenger: "यात्री",
    vehicle: "वाहन",
  },
  mr: {
    day: "दिवस",
    week: "आठवडे",
    month: "महिने",
    year: "वर्ष",
    hour: "तास",
    minute: "मिनिटे",
    second: "सेकंद",
    basis_point: "आधार अंक",
    percentage_point: "टक्के गुण",
    seat: "जागा",
    vote: "मते",
    hectare: "हेक्टर",
    mm: "मिमी",
    cm: "सेमी",
    km: "किमी",
    kg: "किलो",
    tonne: "टन",
    degree_celsius: "डिग्री सेल्सियस",
    station: "स्थानके",
    passenger: "प्रवासी",
    vehicle: "वाहने",
  },
  ta: {
    day: "நாட்கள்",
    week: "வாரங்கள்",
    month: "மாதங்கள்",
    year: "ஆண்டுகள்",
    hour: "மணிநேரம்",
    minute: "நிமிடங்கள்",
    second: "வினாடிகள்",
    basis_point: "அடிப்படை புள்ளிகள்",
    percentage_point: "சதவீத புள்ளிகள்",
    seat: "இடங்கள்",
    vote: "வாக்குகள்",
    hectare: "ஹெக்டேர்",
    mm: "மிமீ",
    cm: "செமீ",
    km: "கிமீ",
    kg: "கிலோ",
    tonne: "டன்",
    degree_celsius: "டிகிரி செல்சியஸ்",
    station: "நிலையங்கள்",
    passenger: "பயணிகள்",
    vehicle: "வாகனங்கள்",
  },
};

/** Canonical magnitude -> target-language word. */
export const TARGET_MAGNITUDE_WORDS: Record<
  TargetLanguage,
  Record<string, string>
> = {
  hi: {
    hundred: "सौ",
    thousand: "हजार",
    lakh: "लाख",
    crore: "करोड़",
    million: "मिलियन",
    billion: "बिलियन",
  },
  mr: {
    hundred: "शे",
    thousand: "हजार",
    lakh: "लाख",
    crore: "कोटी",
    million: "मिलियन",
    billion: "बिलियन",
  },
  ta: {
    hundred: "நூறு",
    thousand: "ஆயிரம்",
    lakh: "லட்சம்",
    crore: "கோடி",
    million: "மில்லியன்",
    billion: "பில்லியன்",
  },
};

/**
 * Every unit word the renderer can emit, as extractor entries.
 *
 * The renderer and the extractor must speak the same vocabulary: after a
 * placeholder is restored the text contains the renderer's word (for example
 * Tamil "நிலையங்கள்" for stations), so the extractor has to be able to parse
 * exactly that word back into the canonical unit. Deriving these entries from
 * TARGET_UNIT_WORDS keeps the two sides mechanically in sync instead of
 * relying on two hand-maintained lists.
 */
export const TARGET_UNIT_ENTRIES: readonly UnitEntry[] = (
  Object.keys(TARGET_UNIT_WORDS) as TargetLanguage[]
).flatMap((language) =>
  Object.entries(TARGET_UNIT_WORDS[language]).map(([unit, word]) => ({
    word,
    unit,
  }))
);

/** The same guarantee for magnitude words (lakh / crore / ...). */
export const TARGET_MAGNITUDE_ENTRIES: readonly MagnitudeEntry[] = (
  Object.keys(TARGET_MAGNITUDE_WORDS) as TargetLanguage[]
).flatMap((language) =>
  Object.entries(TARGET_MAGNITUDE_WORDS[language]).map(([canonical, word]) => {
    const source = MAGNITUDE_ENTRIES.find(
      (entry) => entry.canonical === canonical
    );
    return {
      word,
      multiplier: source?.multiplier ?? 1,
      canonical: (source?.canonical ??
        "hundred") as MagnitudeEntry["canonical"],
    };
  })
);

export interface RelationEntry {
  word: string;
  relation: DeadlineRelation;
}

/** Deadline relation words. Longest entries are matched first. */
export const RELATION_ENTRIES: readonly RelationEntry[] = [
  // English
  { word: "no later than", relation: "by" },
  { word: "not later than", relation: "by" },
  { word: "on or before", relation: "by" },
  { word: "on or after", relation: "after" },
  { word: "not after", relation: "by" },
  { word: "not before", relation: "after" },
  { word: "at the latest", relation: "by" },
  { word: "prior to", relation: "before" },
  { word: "ahead of", relation: "before" },
  { word: "earlier than", relation: "before" },
  { word: "in advance of", relation: "before" },
  { word: "later than", relation: "after" },
  { word: "subsequent to", relation: "after" },
  { word: "before", relation: "before" },
  { word: "until", relation: "by" },
  { word: "till", relation: "by" },
  { word: "upto", relation: "by" },
  { word: "up to", relation: "by" },
  { word: "by", relation: "by" },
  { word: "after", relation: "after" },
  { word: "beyond", relation: "after" },
  { word: "following", relation: "after" },
  { word: "within", relation: "within" },
  { word: "as of", relation: "on" },
  { word: "on", relation: "on" },
  // Hindi
  { word: "से पहले", relation: "before" },
  { word: "से पूर्व", relation: "before" },
  { word: "पहले", relation: "before" },
  { word: "पूर्व", relation: "before" },
  { word: "तक ही", relation: "by" },
  { word: "तक", relation: "by" },
  { word: "के बाद", relation: "after" },
  { word: "बाद", relation: "after" },
  { word: "पश्चात", relation: "after" },
  { word: "उपरांत", relation: "after" },
  { word: "उपरान्त", relation: "after" },
  { word: "भीतर", relation: "within" },
  { word: "अंदर", relation: "within" },
  { word: "को", relation: "on" },
  // Marathi
  { word: "आधी", relation: "before" },
  { word: "पूर्वी", relation: "before" },
  { word: "अगोदर", relation: "before" },
  { word: "तोपर्यंत", relation: "by" },
  { word: "पर्यंत", relation: "by" },
  { word: "नंतर", relation: "after" },
  { word: "नंतरच्या", relation: "after" },
  { word: "पश्चात", relation: "after" },
  { word: "उपरांत", relation: "after" },
  { word: "आतमध्ये", relation: "within" },
  { word: "आत", relation: "within" },
  { word: "रोजी", relation: "on" },
  { word: "दिवशी", relation: "on" },
  // Tamil
  { word: "முன்னதாக", relation: "before" },
  { word: "முன்னர்", relation: "before" },
  { word: "முன்பு", relation: "before" },
  { word: "முன்", relation: "before" },
  { word: "வரைக்கும்", relation: "by" },
  { word: "வரையில்", relation: "by" },
  { word: "வரை", relation: "by" },
  { word: "பின்னர்", relation: "after" },
  { word: "பின்பு", relation: "after" },
  { word: "பிறகு", relation: "after" },
  { word: "பின்", relation: "after" },
  { word: "உள்ளாக", relation: "within" },
  { word: "உள்ளே", relation: "within" },
  { word: "அன்றைய", relation: "on" },
  { word: "அன்று", relation: "on" },
] as const;

/** Currency markers mapped to ISO codes. */
export const CURRENCY_ENTRIES: readonly { token: string; code: string }[] = [
  { token: "₹", code: "INR" },
  { token: "रु.", code: "INR" },
  { token: "रु", code: "INR" },
  { token: "रुपये", code: "INR" },
  { token: "INR", code: "INR" },
  { token: "Rs.", code: "INR" },
  { token: "Rs", code: "INR" },
  { token: "USD", code: "USD" },
  { token: "$", code: "USD" },
  { token: "€", code: "EUR" },
] as const;

/** Percentage marker words. */
export const PERCENT_WORDS = [
  "per cent",
  "per cent.",
  "percent",
  "pct",
  "प्रतिशत",
  "टक्के",
  "சதவீதம்",
  "%",
] as const;

/**
 * ASCII word lists used to build regular expressions with true word
 * boundaries. Non-ASCII terms are matched by substring because JS word
 * boundaries do not treat Indic combining marks reliably.
 */
export const KINDS_WITH_UNITS: readonly InvariantKind[] = [
  "quantity",
  "money",
  "range",
] as const;
