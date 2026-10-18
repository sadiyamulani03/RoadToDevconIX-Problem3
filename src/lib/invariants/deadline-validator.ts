/**
 * Deadline relation detection.
 *
 * Deadlines are semantic. A market that resolves "before 15 June 2027" is a
 * different contract from one that resolves "by 15 June 2027", even though
 * both contain the identical date token. This module finds relation words
 * (before / by / on / after / within) in English, Hindi, Marathi and Tamil and
 * attaches them to nearby date, time, year, quantity or amount invariants.
 *
 * Limitations are deliberate and documented: this is lexical detection, not
 * natural-language understanding. When a relation cannot be established the
 * validator raises a review issue rather than guessing.
 */

import { RELATION_ENTRIES } from "@/lib/invariants/lexicon";
import type { DeadlineRelation, InvariantKind } from "@/lib/invariants/types";

export interface RelationMatch {
  relation: DeadlineRelation;
  raw: string;
  start: number;
  end: number;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const ASCII_ONLY = /^[a-zA-Z0-9 .]+$/;

/**
 * Finds every relation word in the text. ASCII words are matched with true
 * word boundaries so "by" never fires inside "baby" or "by-poll"; Indic words
 * are matched with plain substring search because word boundaries are
 * unreliable for scripts with combining marks.
 */
export function findRelationMatches(text: string): RelationMatch[] {
  const matches: RelationMatch[] = [];
  const entries = [...RELATION_ENTRIES].sort(
    (a, b) => b.word.length - a.word.length
  );

  for (const entry of entries) {
    if (ASCII_ONLY.test(entry.word)) {
      const pattern = new RegExp(
        `(?<![A-Za-z0-9_-])${escapeRegex(entry.word)}(?![A-Za-z0-9_-])`,
        "gi"
      );
      for (const match of text.matchAll(pattern)) {
        if (match.index === undefined) continue;
        matches.push({
          relation: entry.relation,
          raw: match[0],
          start: match.index,
          end: match.index + match[0].length,
        });
      }
    } else {
      let from = 0;
      for (;;) {
        const at = text.indexOf(entry.word, from);
        if (at === -1) break;
        matches.push({
          relation: entry.relation,
          raw: entry.word,
          start: at,
          end: at + entry.word.length,
        });
        from = at + entry.word.length;
      }
    }
  }

  return dedupeOverlaps(matches);
}

/** Keeps the longest match when two matches overlap (e.g. "से पहले" vs "पहले"). */
function dedupeOverlaps(matches: RelationMatch[]): RelationMatch[] {
  const sorted = [...matches].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return b.end - b.start - (a.end - a.start);
  });
  const kept: RelationMatch[] = [];
  for (const match of sorted) {
    const overlaps = kept.some(
      (existing) => match.start < existing.end && match.end > existing.start
    );
    if (!overlaps) kept.push(match);
  }
  return kept;
}

export function distanceToSpan(
  match: RelationMatch,
  start: number,
  end: number
): number {
  if (match.end < start) return start - match.end;
  if (match.start > end) return match.start - end;
  return 0;
}

/**
 * Maximum character gap between a relation word and its value.
 *
 * This is intentionally tight. "by 15 June" (gap 1), "15 जून 2027 से पहले"
 * (gap 1) and "on or after 31 March 2028" (gap 1) all qualify, while
 * "reported by MoSPI ... April 2027" (gap 16) does not — so a report credit
 * can never be mistaken for a deadline relation. When a real deadline phrase
 * is looser than this (for example "before the end of June 2027"), the
 * relation is reported as unverified and a human reviews it: fail safe,
 * never guess.
 */
export const RELATION_ADJACENCY_GAP = 8;

/**
 * Picks the relation word closest to an invariant span within the adjacency
 * gap. Returns null when nothing is close enough, which the validator treats
 * as "relation could not be verified".
 */
export function detectRelationNear(
  text: string,
  start: number,
  end: number,
  window = RELATION_ADJACENCY_GAP
): RelationMatch | null {
  const candidates = findRelationMatches(text)
    .map((match) => ({ match, distance: distanceToSpan(match, start, end) }))
    .filter((candidate) => candidate.distance <= window)
    .sort((a, b) => {
      if (a.distance !== b.distance) return a.distance - b.distance;
      return b.match.raw.length - a.match.raw.length;
    });
  return candidates.length > 0 ? candidates[0].match : null;
}

/** Invariant kinds that can carry a deadline relation. */
export const RELATION_BEARING_KINDS: readonly InvariantKind[] = [
  "date",
  "time",
  "year",
  "quantity",
  "number",
  "money",
] as const;

export function canCarryRelation(kind: InvariantKind): boolean {
  return RELATION_BEARING_KINDS.includes(kind);
}

/**
 * Newsroom-facing wording for a relation, used in blocked/review messages.
 */
export const RELATION_PLAIN_ENGLISH: Record<DeadlineRelation, string> = {
  before: "strictly before",
  by: "by / no later than",
  on: "exactly on",
  after: "strictly after",
  within: "within",
};
