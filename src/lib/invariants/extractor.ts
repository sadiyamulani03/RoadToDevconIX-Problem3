/**
 * Deterministic invariant extraction.
 *
 * This module finds the protected facts in market text using regular
 * expressions and lexicons only. There is no model call, no network access and
 * no randomness: extraction is synchronous, pure and fully testable.
 *
 * Supported and explicitly handled:
 *   - integers and decimals, including Indian/Western digit grouping
 *   - percentages ("4.5%", "50 per cent")
 *   - currency amounts with magnitudes ("₹1 lakh", "Rs 5 crore")
 *   - dates ("15 June 2027", "June 15, 2027", native-month forms)
 *   - years ("2027")
 *   - times and deadlines ("5:30 PM IST", "before 15 June 2027")
 *   - numeric ranges ("4-6%", "15 to 20 mm")
 *   - quantities ("15 days", "20 mm")
 *   - word quantities ("one lakh", "एक लाख", "ஒரு லட்சம்")
 *   - links (resolution source URLs)
 *
 * Fail-safe behaviour: ambiguous numeric dates (03/04/2027) are extracted with
 * LOW confidence and flagged for human review instead of being trusted.
 * Anything that cannot be parsed is simply not protected; the validator then
 * reports a missing invariant rather than silently accepting a change.
 */

import type { MarketField } from "@/lib/market-schema";
import { MARKET_FIELDS } from "@/lib/market-schema";
import type { MarketSource } from "@/lib/market-schema";
import { formatClosingAtDisplay } from "@/lib/closing-time";
import {
  canonicalNumberString,
  normalizeDigitsToAscii,
} from "@/lib/invariants/digit-normalizer";
import {
  canCarryRelation,
  distanceToSpan,
  findRelationMatches,
  RELATION_ADJACENCY_GAP,
  type RelationMatch,
} from "@/lib/invariants/deadline-validator";
import {
  CURRENCY_ENTRIES,
  MAGNITUDE_ENTRIES,
  MONTH_ENTRIES,
  NUMBER_WORD_ENTRIES,
  PERCENT_WORDS,
  TARGET_MAGNITUDE_ENTRIES,
  TARGET_UNIT_ENTRIES,
  UNIT_ENTRIES,
  UNIT_LABELS,
} from "@/lib/invariants/lexicon";
import type {
  ExtractedInvariant,
  InvariantKind,
} from "@/lib/invariants/types";

interface Span {
  start: number;
  end: number;
}

interface ExtractionContext {
  text: string;
  /** Digit-normalised copy used for matching; offsets stay aligned. */
  probe: string;
  field: MarketField;
  consumed: Span[];
  out: ExtractedInvariant[];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const SCRIPT_TAIL = "A-Za-z\\u0900-\\u097F\\u0B80-\\u0BFF";

function alternation(words: readonly string[], withBoundary: boolean): string {
  const sorted = [...words].sort((a, b) => b.length - a.length);
  const joined = sorted.map(escapeRegex).join("|");
  return withBoundary ? `(?:${joined})(?![${SCRIPT_TAIL}])` : `(?:${joined})`;
}

const MONTH_NAMES = MONTH_ENTRIES.map((entry) => entry.name);
const MONTH_BY_NAME = new Map(
  MONTH_ENTRIES.map((entry) => [entry.name.toLowerCase(), entry.month])
);
const MONTH_ALTERNATION = alternation(MONTH_NAMES, true);

// Extractor vocabulary = hand-written entries + every word the renderer can
// emit, so a restored value always parses back to the same canonical unit.
const ALL_MAGNITUDE_ENTRIES = [
  ...MAGNITUDE_ENTRIES,
  ...TARGET_MAGNITUDE_ENTRIES,
];
const MAGNITUDE_WORDS = ALL_MAGNITUDE_ENTRIES.map((entry) => entry.word);
const MAGNITUDE_BY_WORD = new Map(
  ALL_MAGNITUDE_ENTRIES.map((entry) => [entry.word, entry])
);
const MAGNITUDE_ALTERNATION = alternation(MAGNITUDE_WORDS, true);

const ALL_UNIT_ENTRIES = [...UNIT_ENTRIES, ...TARGET_UNIT_ENTRIES];
const UNIT_WORDS = ALL_UNIT_ENTRIES.map((entry) => entry.word);
const UNIT_BY_WORD = new Map(
  ALL_UNIT_ENTRIES.map((entry) => [entry.word, entry.unit])
);
const UNIT_ALTERNATION = alternation(UNIT_WORDS, true);

const NUMBER_WORDS = NUMBER_WORD_ENTRIES.map((entry) => entry.word);
const NUMBER_BY_WORD = new Map(
  NUMBER_WORD_ENTRIES.map((entry) => [entry.word, entry.value])
);
const NUMBER_WORD_ALTERNATION = alternation(NUMBER_WORDS, true);

const PERCENT_ALTERNATION = alternation(PERCENT_WORDS, true);

const CURRENCY_TOKENS = CURRENCY_ENTRIES.map((entry) => entry.token);
const CURRENCY_BY_TOKEN = new Map(
  CURRENCY_ENTRIES.map((entry) => [entry.token, entry.code])
);
// Letter tokens ("Rs", "INR", ...) get true word boundaries so the "rs" in
// "years" can never be read as a currency marker. Symbols need none.
const CURRENCY_ALTERNATION = [...CURRENCY_TOKENS]
  .sort((a, b) => b.length - a.length)
  .map((token) =>
    /^[A-Za-z.]+$/.test(token)
      ? `(?<![A-Za-z])(?:${escapeRegex(token)})(?![A-Za-z])`
      : escapeRegex(token)
  )
  .join("|");

const NUMBER_TOKEN = String.raw`\d[\d,]*(?:\.\d+)?`;

function isFree(ctx: ExtractionContext, start: number, end: number): boolean {
  return !ctx.consumed.some((span) => start < span.end && end > span.start);
}

function add(
  ctx: ExtractionContext,
  base: Omit<ExtractedInvariant, "id" | "field">
): void {
  ctx.consumed.push({ start: base.start, end: base.end });
  ctx.out.push({ ...base, id: "", field: ctx.field });
}

function buildCanonicalNumber(value: number): string {
  return `n:${canonicalNumberString(value)}`;
}

function validCalendarDate(
  year: number,
  month: number,
  day: number
): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/* ------------------------------------------------------------------------- */
/* Individual extraction passes                                              */
/* ------------------------------------------------------------------------- */

function passUrls(ctx: ExtractionContext): void {
  const pattern =
    /\b(?:https?:\/\/[^\s<>()]+|(?:[a-z0-9-]+\.)+(?:in|com|org|net|gov|nic|co|io|edu|int)(?:\/[^\s<>()]*)?)/gi;
  for (const match of ctx.probe.matchAll(pattern)) {
    if (match.index === undefined) continue;
    let end = match.index + match[0].length;
    while (end > match.index && /[.,;:)\]]/.test(ctx.probe[end - 1])) end -= 1;
    if (end <= match.index) continue;
    if (!isFree(ctx, match.index, end)) continue;
    const raw = ctx.text.slice(match.index, end);
    const normalized = raw
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/+$/, "");
    add(ctx, {
      kind: "url",
      raw,
      canonical: `url:${normalized}`,
      display: raw,
      confidence: "high",
      note: "Link protected so the translator cannot rewrite the resolution source.",
      start: match.index,
      end,
    });
  }
}

function passDates(ctx: ExtractionContext): void {
  const dayFirst = new RegExp(
    String.raw`(?<!\d)(\d{1,2})(?:st|nd|rd|th)?[\s,]+(${MONTH_ALTERNATION})\.?,?\s+(\d{4})(?!\d)`,
    "gi"
  );
  for (const match of ctx.probe.matchAll(dayFirst)) {
    const start = match.index!;
    const end = start + match[0].length;
    if (!isFree(ctx, start, end)) continue;
    const month = MONTH_BY_NAME.get(match[2].toLowerCase());
    const day = Number(match[1]);
    const year = Number(match[3]);
    if (month === undefined || !validCalendarDate(year, month, day)) continue;
    const dateISO = `${year}-${String(month).padStart(2, "0")}-${String(
      day
    ).padStart(2, "0")}`;
    add(ctx, {
      kind: "date",
      raw: ctx.text.slice(start, end),
      canonical: `date:${dateISO}`,
      display: ctx.text.slice(start, end),
      dateISO,
      confidence: "high",
      start,
      end,
    });
  }

  const monthFirst = new RegExp(
    String.raw`(?<![${SCRIPT_TAIL}])(${MONTH_ALTERNATION})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})(?!\d)`,
    "gi"
  );
  for (const match of ctx.probe.matchAll(monthFirst)) {
    const start = match.index!;
    const end = start + match[0].length;
    if (!isFree(ctx, start, end)) continue;
    const month = MONTH_BY_NAME.get(match[1].toLowerCase());
    const day = Number(match[2]);
    const year = Number(match[3]);
    if (month === undefined || !validCalendarDate(year, month, day)) continue;
    const dateISO = `${year}-${String(month).padStart(2, "0")}-${String(
      day
    ).padStart(2, "0")}`;
    add(ctx, {
      kind: "date",
      raw: ctx.text.slice(start, end),
      canonical: `date:${dateISO}`,
      display: ctx.text.slice(start, end),
      dateISO,
      confidence: "high",
      start,
      end,
    });
  }

  const iso = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)?(?!\d)/g;
  for (const match of ctx.probe.matchAll(iso)) {
    const start = match.index!;
    const end = start + match[0].length;
    if (!isFree(ctx, start, end)) continue;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!validCalendarDate(year, month, day)) continue;
    const dateISO = `${match[1]}-${match[2]}-${match[3]}`;
    add(ctx, {
      kind: "date",
      raw: ctx.text.slice(start, end),
      canonical: `date:${dateISO}`,
      display: ctx.text.slice(start, end),
      dateISO,
      confidence: "high",
      start,
      end,
    });
    if (match[4] && match[5]) {
      add(ctx, {
        kind: "time",
        raw: ctx.text.slice(start, end),
        canonical: `time:${match[4]}:${match[5]}`,
        display: ctx.text.slice(start, end),
        time24: `${match[4]}:${match[5]}`,
        confidence: "high",
        note: "Time read from an ISO 8601 instant inside the source text.",
        start,
        end,
      });
    }
  }

  const ambiguous = /(?<!\d)(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?!\d)/g;
  for (const match of ctx.probe.matchAll(ambiguous)) {
    const start = match.index!;
    const end = start + match[0].length;
    if (!isFree(ctx, start, end)) continue;
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    if (!validCalendarDate(year, month, day)) continue;
    const dateISO = `${year}-${String(month).padStart(2, "0")}-${String(
      day
    ).padStart(2, "0")}`;
    add(ctx, {
      kind: "date",
      raw: ctx.text.slice(start, end),
      canonical: `date:${dateISO}`,
      display: ctx.text.slice(start, end),
      dateISO,
      confidence: "low",
      note: "Ambiguous numeric date: assumed DD/MM/YYYY. Human review required.",
      start,
      end,
    });
  }
}

function passTimes(ctx: ExtractionContext): void {
  const colon = new RegExp(
    String.raw`(?<!\d)(\d{1,2}):(\d{2})(?::\d{2})?\s*(?:(am|a\.m\.|pm|p\.m\.)\s*)?(?:(IST|UTC|GMT|ET|PT|CET)\b)?`,
    "gi"
  );
  for (const match of ctx.probe.matchAll(colon)) {
    const start = match.index!;
    const end = start + match[0].length;
    if (!isFree(ctx, start, end)) continue;
    const built = buildTime(match[1], match[2], match[3], match[4]);
    if (!built) continue;
    add(ctx, {
      kind: "time",
      raw: ctx.text.slice(start, end).trimEnd(),
      canonical: built.canonical,
      display: ctx.text.slice(start, end).trimEnd(),
      time24: built.time24,
      timezone: built.timezone,
      confidence: "high",
      start,
      end: start + ctx.text.slice(start, end).trimEnd().length,
    });
  }

  const dotted = new RegExp(
    String.raw`(?<!\d)(\d{1,2})\.(\d{2})\s*(am|a\.m\.|pm|p\.m\.)\s*(?:(IST|UTC|GMT|ET|PT|CET)\b)?`,
    "gi"
  );
  for (const match of ctx.probe.matchAll(dotted)) {
    const start = match.index!;
    const end = start + match[0].length;
    if (!isFree(ctx, start, end)) continue;
    const built = buildTime(match[1], match[2], match[3], match[4]);
    if (!built) continue;
    add(ctx, {
      kind: "time",
      raw: ctx.text.slice(start, end).trimEnd(),
      canonical: built.canonical,
      display: ctx.text.slice(start, end).trimEnd(),
      time24: built.time24,
      timezone: built.timezone,
      confidence: "high",
      start,
      end: start + ctx.text.slice(start, end).trimEnd().length,
    });
  }
}

function buildTime(
  hourText: string,
  minuteText: string,
  meridiem: string | undefined,
  timezone: string | undefined
): { canonical: string; time24: string; timezone?: string } | null {
  let hour = Number(hourText);
  const minute = Number(minuteText);
  if (minute > 59) return null;
  const lower = (meridiem ?? "").toLowerCase().replace(/\./g, "");
  if (lower === "pm" && hour < 12) hour += 12;
  if (lower === "am" && hour === 12) hour = 0;
  if (hour > 23) return null;
  const time24 = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const tz = timezone ? timezone.toUpperCase() : undefined;
  return {
    canonical: tz ? `time:${time24}:${tz}` : `time:${time24}`,
    time24,
    timezone: tz,
  };
}

function passMoney(ctx: ExtractionContext): void {
  const pattern = new RegExp(
    String.raw`(${CURRENCY_ALTERNATION})\s?(${NUMBER_TOKEN})(?:\s?(${MAGNITUDE_ALTERNATION}))?`,
    "gi"
  );
  for (const match of ctx.probe.matchAll(pattern)) {
    const start = match.index!;
    const end = start + match[0].length;
    if (!isFree(ctx, start, end)) continue;
    const value = Number(match[2].replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    const magnitude = match[3]
      ? MAGNITUDE_BY_WORD.get(match[3].toLowerCase())
      : undefined;
    if (match[3] && !magnitude) continue;
    const currency = CURRENCY_BY_TOKEN.get(match[1]);
    if (!currency) continue;
    const effective = value * (magnitude?.multiplier ?? 1);
    const raw = ctx.text.slice(start, end);
    add(ctx, {
      kind: "money",
      raw,
      canonical: `${currency.toLowerCase()}:${canonicalNumberString(effective)}`,
      display:
        magnitude && magnitude.multiplier !== 1
          ? `${raw} (${currency} ${effective.toLocaleString("en-IN")})`
          : raw,
      numericValue: effective,
      currency,
      magnitudeWord: magnitude?.canonical,
      confidence: "high",
      note: `Currency amount protected at ${currency} ${canonicalNumberString(effective)}.`,
      start,
      end,
    });
  }
}

function passRanges(ctx: ExtractionContext): void {
  const pattern = new RegExp(
    String.raw`(?<!\d)(${NUMBER_TOKEN})(?:\s*(?:-|–|—|to(?![a-z])|से)\s*)(${NUMBER_TOKEN})(?:\s*(${PERCENT_ALTERNATION}|${UNIT_ALTERNATION}))?`,
    "gi"
  );
  for (const match of ctx.probe.matchAll(pattern)) {
    const start = match.index!;
    const end = start + match[0].length;
    if (!isFree(ctx, start, end)) continue;
    const left = Number(match[1].replace(/,/g, ""));
    const right = Number(match[2].replace(/,/g, ""));
    if (!Number.isFinite(left) || !Number.isFinite(right)) continue;
    const suffixRaw = match[3];
    let suffix = "";
    if (suffixRaw) {
      const percentEntry = PERCENT_WORDS.find((word) => word === suffixRaw);
      if (percentEntry) {
        suffix = "pct";
      } else {
        const unit = UNIT_BY_WORD.get(suffixRaw.toLowerCase());
        if (unit) suffix = unit;
      }
    }
    add(ctx, {
      kind: "range",
      raw: ctx.text.slice(start, end),
      canonical: `rng:${canonicalNumberString(left)}:${canonicalNumberString(
        right
      )}${suffix ? `:${suffix}` : ""}`,
      display: ctx.text.slice(start, end),
      numericValue: left,
      rangeEnd: right,
      unit: suffix === "pct" ? "percent" : suffix || undefined,
      confidence: "high",
      note: "Range protected: both bounds must survive translation.",
      start,
      end,
    });
  }
}

function passPercents(ctx: ExtractionContext): void {
  const pattern = new RegExp(
    String.raw`(?<!\d)(${NUMBER_TOKEN})\s*(${PERCENT_ALTERNATION})`,
    "gi"
  );
  for (const match of ctx.probe.matchAll(pattern)) {
    const start = match.index!;
    const end = start + match[0].length;
    if (!isFree(ctx, start, end)) continue;
    const value = Number(match[1].replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    add(ctx, {
      kind: "percent",
      raw: ctx.text.slice(start, end).trimEnd(),
      canonical: `pct:${canonicalNumberString(value)}`,
      display: ctx.text.slice(start, end).trimEnd(),
      numericValue: value,
      confidence: "high",
      start,
      end: start + ctx.text.slice(start, end).trimEnd().length,
    });
  }
}

function passNumericMagnitudes(ctx: ExtractionContext): void {
  const pattern = new RegExp(
    String.raw`(?<!\d)(${NUMBER_TOKEN})\s*(${MAGNITUDE_ALTERNATION})(?:\s+(${UNIT_ALTERNATION}))?`,
    "gi"
  );
  for (const match of ctx.probe.matchAll(pattern)) {
    const start = match.index!;
    const end = start + match[0].length;
    if (!isFree(ctx, start, end)) continue;
    const value = Number(match[1].replace(/,/g, ""));
    const magnitude = MAGNITUDE_BY_WORD.get(match[2].toLowerCase());
    if (!Number.isFinite(value) || !magnitude) continue;
    const effective = value * magnitude.multiplier;
    const unit = match[3] ? UNIT_BY_WORD.get(match[3].toLowerCase()) : undefined;
    if (match[3] && !unit) continue;
    const raw = ctx.text.slice(start, end);
    add(ctx, {
      kind: unit ? "quantity" : "number",
      raw,
      canonical: unit
        ? `n:${canonicalNumberString(effective)}:${unit}`
        : buildCanonicalNumber(effective),
      display: `${raw} (= ${effective.toLocaleString("en-IN")})`,
      numericValue: effective,
      unit,
      rawUnit: match[3],
      magnitudeWord: magnitude.canonical,
      confidence: "high",
      note: `Magnitude word "${magnitude.canonical}" folds into value ${canonicalNumberString(
        effective
      )}.`,
      start,
      end,
    });
  }
}

function passQuantities(ctx: ExtractionContext): void {
  const pattern = new RegExp(
    String.raw`(?<!\d)(${NUMBER_TOKEN})\s*(${UNIT_ALTERNATION})`,
    "gi"
  );
  for (const match of ctx.probe.matchAll(pattern)) {
    const start = match.index!;
    const end = start + match[0].length;
    if (!isFree(ctx, start, end)) continue;
    const value = Number(match[1].replace(/,/g, ""));
    const unit = UNIT_BY_WORD.get(match[2].toLowerCase());
    if (!Number.isFinite(value) || !unit) continue;
    const raw = ctx.text.slice(start, end).trimEnd();
    add(ctx, {
      kind: "quantity",
      raw,
      canonical: `n:${canonicalNumberString(value)}:${unit}`,
      display: raw,
      numericValue: value,
      unit,
      rawUnit: match[2],
      confidence: "high",
      note: `Quantity protected: ${value} ${UNIT_LABELS[unit] ?? unit}.`,
      start,
      end: start + raw.length,
    });
  }
}

function passWordQuantities(ctx: ExtractionContext): void {
  const pattern = new RegExp(
    String.raw`(?<![${SCRIPT_TAIL}])(${NUMBER_WORD_ALTERNATION})\s+(?:(${MAGNITUDE_ALTERNATION})(?:\s+(${UNIT_ALTERNATION}))?|(${UNIT_ALTERNATION}))`,
    "gi"
  );
  for (const match of ctx.probe.matchAll(pattern)) {
    const start = match.index!;
    const end = start + match[0].length;
    if (!isFree(ctx, start, end)) continue;
    const wordValue = NUMBER_BY_WORD.get(match[1].toLowerCase());
    if (wordValue === undefined) continue;
    const magnitude = match[2]
      ? MAGNITUDE_BY_WORD.get(match[2].toLowerCase())
      : undefined;
    if (match[2] && !magnitude) continue;
    const unitWord = match[3] ?? match[4];
    const unit = unitWord ? UNIT_BY_WORD.get(unitWord.toLowerCase()) : undefined;
    if (unitWord && !unit) continue;
    const effective = wordValue * (magnitude?.multiplier ?? 1);
    const raw = ctx.text.slice(start, end);
    add(ctx, {
      kind: unit ? "quantity" : "number",
      raw,
      canonical: unit
        ? `n:${canonicalNumberString(effective)}:${unit}`
        : buildCanonicalNumber(effective),
      display: `${raw} (= ${effective.toLocaleString("en-IN")})`,
      numericValue: effective,
      unit,
      rawUnit: unitWord,
      magnitudeWord: magnitude?.canonical,
      confidence: "high",
      note: "Number word protected as a numeric value.",
      start,
      end,
    });
  }
}

function passYears(ctx: ExtractionContext): void {
  const pattern = /(?<!\d)((?:19|20)\d{2})(?!\d)/g;
  for (const match of ctx.probe.matchAll(pattern)) {
    const start = match.index!;
    const end = start + match[0].length;
    if (!isFree(ctx, start, end)) continue;
    add(ctx, {
      kind: "year",
      raw: ctx.text.slice(start, end),
      canonical: buildCanonicalNumber(Number(match[1])),
      display: ctx.text.slice(start, end),
      numericValue: Number(match[1]),
      confidence: "high",
      note: "Year protected as a numeric value.",
      start,
      end,
    });
  }
}

function passBareNumbers(ctx: ExtractionContext): void {
  const pattern = new RegExp(String.raw`(?<!\d)(${NUMBER_TOKEN})(?!\d)`, "g");
  for (const match of ctx.probe.matchAll(pattern)) {
    const start = match.index!;
    const end = start + match[0].length;
    if (!isFree(ctx, start, end)) continue;
    const value = Number(match[1].replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    add(ctx, {
      kind: "number",
      raw: ctx.text.slice(start, end),
      canonical: buildCanonicalNumber(value),
      display: ctx.text.slice(start, end),
      numericValue: value,
      confidence: "high",
      start,
      end,
    });
  }
}

/* ------------------------------------------------------------------------- */
/* Relation attachment and public API                                        */
/* ------------------------------------------------------------------------- */

/**
 * Attaches relation words to the value they actually govern.
 *
 * The assignment is relation-driven: each relation word is matched to the
 * single closest invariant within the adjacency gap, and the invariant's span
 * is deliberately NOT extended — relation words must stay in the text that is
 * sent to the translator, because they are exactly the words that have to be
 * translated ("before" -> "से पहले"). Only the value itself is protected.
 */
const RELATION_KIND_PRIORITY: Record<InvariantKind, number> = {
  date: 0,
  time: 1,
  year: 2,
  quantity: 3,
  number: 4,
  money: 5,
  percent: 6,
  range: 6,
  url: 7,
};

function attachDeadlineRelations(ctx: ExtractionContext): void {
  const matches = findRelationMatches(ctx.text);
  const chosen = new Map<
    ExtractedInvariant,
    { match: RelationMatch; distance: number; centerDistance: number }
  >();

  for (const match of matches) {
    let best:
      | {
          invariant: ExtractedInvariant;
          distance: number;
          centerDistance: number;
        }
      | undefined;
    const matchCenter = (match.start + match.end) / 2;
    for (const invariant of ctx.out) {
      if (!canCarryRelation(invariant.kind)) continue;
      const distance = distanceToSpan(match, invariant.start, invariant.end);
      if (distance > RELATION_ADJACENCY_GAP) continue;
      const centerDistance = Math.abs(
        matchCenter - (invariant.start + invariant.end) / 2
      );
      if (
        !best ||
        distance < best.distance ||
        (distance === best.distance &&
          RELATION_KIND_PRIORITY[invariant.kind] <
            RELATION_KIND_PRIORITY[best.invariant.kind]) ||
        (distance === best.distance &&
          RELATION_KIND_PRIORITY[invariant.kind] ===
            RELATION_KIND_PRIORITY[best.invariant.kind] &&
          centerDistance < best.centerDistance)
      ) {
        best = { invariant, distance, centerDistance };
      }
    }
    if (!best) continue;
    const existing = chosen.get(best.invariant);
    if (
      !existing ||
      best.distance < existing.distance ||
      (best.distance === existing.distance &&
        match.raw.length > existing.match.raw.length)
    ) {
      chosen.set(best.invariant, {
        match,
        distance: best.distance,
        centerDistance: best.centerDistance,
      });
    }
  }

  for (const [invariant, { match }] of chosen) {
    invariant.relation = match.relation;
    invariant.relationRaw = match.raw;
    const relationNote = `Deadline relation "${match.raw}" = ${match.relation}.`;
    invariant.note = invariant.note
      ? `${invariant.note} ${relationNote}`
      : relationNote;
  }
}

function extractRaw(text: string, field: MarketField): ExtractedInvariant[] {
  const ctx: ExtractionContext = {
    text,
    probe: normalizeDigitsToAscii(text),
    field,
    consumed: [],
    out: [],
  };
  passUrls(ctx);
  passDates(ctx);
  passTimes(ctx);
  passMoney(ctx);
  passRanges(ctx);
  passPercents(ctx);
  passNumericMagnitudes(ctx);
  passQuantities(ctx);
  passWordQuantities(ctx);
  passYears(ctx);
  passBareNumbers(ctx);
  attachDeadlineRelations(ctx);
  return ctx.out.sort((a, b) => a.start - b.start);
}

/** Extracts invariants from a single text with deterministic ids. */
export function extractInvariants(
  text: string,
  field: MarketField
): ExtractedInvariant[] {
  return extractRaw(text, field).map((invariant, index) => ({
    ...invariant,
    id: `INV_${String(index + 1).padStart(3, "0")}`,
  }));
}

export interface MarketInvariantBundle {
  /** All invariants in canonical field order, with globally unique ids. */
  all: ExtractedInvariant[];
  byField: Record<MarketField, ExtractedInvariant[]>;
}

/** Extracts invariants for all five fields of an English source market. */
export function extractMarketInvariants(
  market: MarketSource
): MarketInvariantBundle {
  const byField = {} as Record<MarketField, ExtractedInvariant[]>;
  const all: ExtractedInvariant[] = [];
  for (const field of MARKET_FIELDS) {
    const text =
      field === "closingAt" ? formatClosingAtDisplay(market) : market[field];
    const invariants = extractRaw(text, field).map((invariant) => {
      const withId: ExtractedInvariant = {
        ...invariant,
        id: `INV_${String(all.length + 1).padStart(3, "0")}`,
      };
      all.push(withId);
      return withId;
    });
    byField[field] = invariants;
  }
  return { all, byField };
}

/** Extracts invariants from a translated market version for comparison. */
export function extractTranslatedInvariants(
  translated: Record<MarketField, string>
): MarketInvariantBundle {
  const byField = {} as Record<MarketField, ExtractedInvariant[]>;
  const all: ExtractedInvariant[] = [];
  for (const field of MARKET_FIELDS) {
    const invariants = extractRaw(translated[field], field).map((invariant) => {
      const withId: ExtractedInvariant = {
        ...invariant,
        id: `TGT_${String(all.length + 1).padStart(3, "0")}`,
      };
      all.push(withId);
      return withId;
    });
    byField[field] = invariants;
  }
  return { all, byField };
}

export { buildCanonicalNumber };
export type { InvariantKind };
