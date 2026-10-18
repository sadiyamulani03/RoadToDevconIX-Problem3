/**
 * Closing date/time presentation.
 *
 * Source markets store the closing instant as ISO 8601 with an explicit
 * offset. Translation and validation operate on the human-readable display
 * string, e.g. "15 June 2027, 5:30 PM IST", because that text is what a
 * translator can carry into Hindi/Tamil/Marathi.
 */

import type { MarketSource } from "@/lib/market-schema";

export const ENGLISH_MONTH_NAMES: readonly string[] = [
  "",
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** Fixed UTC offsets (minutes) for the timezones this newsroom works with. */
const ZONE_OFFSETS_MINUTES: Record<string, number> = {
  "Asia/Kolkata": 330,
  "Asia/Calcutta": 330,
  "Asia/Colombo": 330,
  "Asia/Kathmandu": 345,
  "Asia/Dhaka": 360,
  "Asia/Karachi": 300,
  "Asia/Kabul": 270,
  "Asia/Dubai": 240,
  UTC: 0,
};

const ZONE_LABELS: Record<string, string> = {
  "Asia/Kolkata": "IST",
  "Asia/Calcutta": "IST",
  "Asia/Colombo": "IST",
  "Asia/Kathmandu": "NPT",
  "Asia/Dhaka": "BST",
  "Asia/Karachi": "PKT",
  "Asia/Kabul": "AFT",
  "Asia/Dubai": "GST",
  UTC: "UTC",
};

const ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?(Z|[+-]\d{2}:?\d{2})$/;

export interface ClosingParts {
  /** Local calendar date, "YYYY-MM-DD". */
  dateISO: string;
  /** Local 24-hour time, "HH:MM". */
  time24: string;
  /** Display label such as "IST". */
  timezoneLabel: string;
}

function parseOffsetMinutes(offset: string): number {
  if (offset === "Z") return 0;
  const sign = offset.startsWith("-") ? -1 : 1;
  const body = offset.slice(1).replace(":", "");
  const hours = Number(body.slice(0, 2));
  const minutes = Number(body.slice(2, 4));
  return sign * (hours * 60 + minutes);
}

function pad(value: number, size = 2): string {
  return String(value).padStart(size, "0");
}

/**
 * Returns the closing wall-clock date/time in the market's timezone. Falls
 * back to the offset embedded in the ISO string when the timezone is not in
 * the fixed-offset table. Throws on an unparseable value so callers fail
 * loudly instead of guessing.
 */
export function parseClosingAt(
  closingAt: string,
  timezone: string
): ClosingParts {
  const match = ISO_RE.exec(closingAt);
  if (!match) {
    throw new Error(`closingAt is not a supported ISO 8601 instant: ${closingAt}`);
  }
  const [, year, month, day, hour, minute, offset] = match;
  // The ISO string carries its own offset ("+05:30"). Subtract it to obtain
  // the true UTC instant, then apply the market timezone offset for display.
  const embeddedOffset = parseOffsetMinutes(offset);
  const instantMs =
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute)
    ) -
    embeddedOffset * 60_000;
  const zoneMinutes = ZONE_OFFSETS_MINUTES[timezone] ?? embeddedOffset;
  const local = new Date(instantMs + zoneMinutes * 60_000);
  return {
    dateISO: `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(
      local.getUTCDate()
    )}`,
    time24: `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`,
    timezoneLabel: ZONE_LABELS[timezone] ?? timezone,
  };
}

export function formatTime12(time24: string): string {
  const [hourText, minuteText] = time24.split(":");
  const hour = Number(hourText);
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${minuteText} ${suffix}`;
}

export function formatDateEnglish(dateISO: string): string {
  const [year, month, day] = dateISO.split("-");
  return `${Number(day)} ${ENGLISH_MONTH_NAMES[Number(month)]} ${year}`;
}

/**
 * "2027-06-15T17:30:00+05:30" + "Asia/Kolkata"
 *   -> "15 June 2027, 5:30 PM IST"
 */
export function formatClosingAtDisplay(market: MarketSource): string {
  const parts = parseClosingAt(market.closingAt, market.timezone);
  return `${formatDateEnglish(parts.dateISO)}, ${formatTime12(
    parts.time24
  )} ${parts.timezoneLabel}`;
}
