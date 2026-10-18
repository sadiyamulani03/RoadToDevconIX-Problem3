/**
 * Illustrative demo markets.
 *
 * These are fictional newsroom examples for a play-token editorial tool. They
 * are clearly marked `isDemo: true` and are not connected to any real
 * prediction market, exchange or financial contract.
 *
 * They deliberately exercise every protected fact type: years, calendar dates,
 * before/by/on/after deadlines, percentages, currency amounts, Indian digit
 * grouping, word quantities (lakh/crore) and links.
 */

import type { MarketSource } from "@/lib/market-schema";

export const SAMPLE_MARKETS: MarketSource[] = [
  {
    id: "rbi-rate-cut-2027",
    isDemo: true,
    createdAt: "2026-10-01T10:00:00+05:30",
    title: "RBI Repo Rate Cut Before 15 June 2027",
    question:
      "Will the Reserve Bank of India announce a repo rate cut before 15 June 2027?",
    resolutionRules:
      "Resolve YES only if the RBI officially announces a reduction in the repo rate before 15 June 2027. A cut of at least 25 basis points counts; a cut of 0.25% or more qualifies. Announcements published on rbi.org.in or in an official RBI press release count. If no cut has been announced by 15 June 2027, resolve NO.",
    closingAt: "2027-06-15T17:30:00+05:30",
    timezone: "Asia/Kolkata",
    resolutionSource: "Reserve Bank of India press releases (rbi.org.in)",
  },
  {
    id: "monsoon-onset-kerala-2027",
    isDemo: true,
    createdAt: "2026-10-01T10:05:00+05:30",
    title: "Southwest Monsoon Onset in Kerala Before 5 June 2027",
    question:
      "Will the India Meteorological Department declare the onset of the southwest monsoon over Kerala before 5 June 2027?",
    resolutionRules:
      "Resolve YES only if IMD officially declares monsoon onset over Kerala before 5 June 2027. The declaration must be published on mausam.imd.gov.in. Seasonal rainfall of 50 mm or more is not required for this market. If the onset is declared after 5 June 2027, resolve NO.",
    closingAt: "2027-06-05T23:59:00+05:30",
    timezone: "Asia/Kolkata",
    resolutionSource: "India Meteorological Department (mausam.imd.gov.in)",
  },
  {
    id: "cpi-inflation-april-2027",
    isDemo: true,
    createdAt: "2026-10-01T10:10:00+05:30",
    title: "India CPI Inflation Above 5% in April 2027",
    question:
      "Will India's consumer price index (CPI) inflation print above 5.0% for April 2027?",
    resolutionRules:
      "Resolve YES if the combined CPI inflation rate reported by MoSPI for April 2027 is above 5.0%. A print of exactly 5.0% resolves NO. The April 2027 CPI release is expected in the second week of May 2027. Data must come from mospi.gov.in or the official press release.",
    closingAt: "2027-05-20T17:30:00+05:30",
    timezone: "Asia/Kolkata",
    resolutionSource: "Ministry of Statistics and Programme Implementation (mospi.gov.in)",
  },
  {
    id: "karnataka-bypoll-margin-2027",
    isDemo: true,
    createdAt: "2026-10-01T10:15:00+05:30",
    title: "Karnataka By-poll Victory Margin Above 1,00,000 Votes",
    question:
      "Will the winning candidate's victory margin in the 2027 Karnataka assembly by-poll exceed 1,00,000 votes?",
    resolutionRules:
      "Resolve YES only if the Election Commission of India declares a victory margin greater than 1,00,000 votes. An official margin of exactly 1,00,000 votes resolves NO. The result must be published on results.eci.gov.in. If the by-poll is postponed beyond 31 December 2027, resolve NO.",
    closingAt: "2027-11-30T18:00:00+05:30",
    timezone: "Asia/Kolkata",
    resolutionSource: "Election Commission of India results (results.eci.gov.in)",
  },
  {
    id: "vande-bharat-mumbai-goa-2028",
    isDemo: true,
    createdAt: "2026-10-01T10:20:00+05:30",
    title: "Vande Bharat Mumbai-Goa Service Before 31 March 2028",
    question:
      "Will commercial services of the Vande Bharat Express between Mumbai and Goa begin before 31 March 2028?",
    resolutionRules:
      "Resolve YES only if Indian Railways begins commercial passenger services on the Mumbai-Goa Vande Bharat Express route before 31 March 2028. A trial run of 20 km or more does not count, and at least 14 stations must be served on the route. The first service must be announced on indianrailways.gov.in. If services begin on or after 31 March 2028, resolve NO.",
    closingAt: "2028-03-31T17:30:00+05:30",
    timezone: "Asia/Kolkata",
    resolutionSource: "Indian Railways press releases (indianrailways.gov.in)",
  },
  {
    id: "pmay-gramin-subsidy-2028",
    isDemo: true,
    createdAt: "2026-10-01T10:25:00+05:30",
    title: "Rural Housing Subsidy Raised to ₹1 Lakh Before 31 March 2028",
    question:
      "Will the Union government raise the PMAY-Gramin housing subsidy to at least ₹1 lakh per beneficiary before 31 March 2028?",
    resolutionRules:
      "Resolve YES only if an official notification or Union Budget raises the PMAY-Gramin housing subsidy to at least ₹1 lakh per beneficiary before 31 March 2028. The scheme covers more than two crore households, and a pilot covering fewer than one lakh households does not count. The notification must be published on pmayg.nic.in. If no raise is notified by 31 March 2028, resolve NO.",
    closingAt: "2028-03-31T17:30:00+05:30",
    timezone: "Asia/Kolkata",
    resolutionSource: "Ministry of Rural Development (pmayg.nic.in)",
  },
];

export function getSampleMarket(id: string): MarketSource | undefined {
  return SAMPLE_MARKETS.find((market) => market.id === id);
}
