/**
 * In-memory workbench store.
 *
 * Bhasha Markets is a single-newsroom editorial tool; this store keeps the
 * working set (markets, language versions, audit trail) in process memory.
 * Nothing here is a durable database — the point of the exercise is the
 * verification core, not persistence — but every mutating operation is
 * funnelled through this module so the API routes, the UI and the acceptance
 * scripts all see exactly the same state machine.
 *
 * The store is attached to `globalThis` so Next.js hot reloads and route
 * workers share one instance during development.
 */

import type { MarketSource } from "@/lib/market-schema";
import { SAMPLE_MARKETS } from "@/lib/sample-markets";
import type { AuditEvent } from "@/lib/audit-log";
import type { LanguageVersionState } from "@/lib/review-workflow";
import type { TargetLanguage } from "@/lib/languages";

export class MarketStore {
  private readonly markets = new Map<string, MarketSource>();
  private readonly versions = new Map<string, LanguageVersionState>();
  private readonly marketAudit = new Map<string, AuditEvent[]>();

  constructor(seed: MarketSource[] = SAMPLE_MARKETS) {
    for (const market of seed) {
      this.markets.set(market.id, market);
    }
  }

  /** Restores the store to its seeded state (used by tests and scripts). */
  reset(seed: MarketSource[] = SAMPLE_MARKETS): void {
    this.markets.clear();
    this.versions.clear();
    this.marketAudit.clear();
    for (const market of seed) {
      this.markets.set(market.id, market);
    }
  }

  listMarkets(): MarketSource[] {
    return [...this.markets.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  getMarket(id: string): MarketSource | undefined {
    return this.markets.get(id);
  }

  saveMarket(market: MarketSource): void {
    this.markets.set(market.id, market);
  }

  listVersions(marketId?: string): LanguageVersionState[] {
    return [...this.versions.values()]
      .filter((version) => !marketId || version.marketId === marketId)
      .sort((a, b) => a.versionId.localeCompare(b.versionId));
  }

  getVersion(versionId: string): LanguageVersionState | undefined {
    return this.versions.get(versionId);
  }

  findVersion(
    marketId: string,
    language: TargetLanguage
  ): LanguageVersionState | undefined {
    return this.versions.get(`${marketId}.${language}`);
  }

  saveVersion(state: LanguageVersionState): void {
    this.versions.set(state.versionId, state);
  }

  deleteVersion(versionId: string): void {
    this.versions.delete(versionId);
  }

  appendMarketAudit(marketId: string, event: AuditEvent): void {
    const events = this.marketAudit.get(marketId) ?? [];
    events.push(event);
    this.marketAudit.set(marketId, events);
  }

  /**
   * Merged audit trail: market-level events plus every language version's
   * events, ordered oldest first (id breaks ties so ordering is stable).
   */
  auditFor(marketId: string): AuditEvent[] {
    const events = [
      ...(this.marketAudit.get(marketId) ?? []),
      ...this.listVersions(marketId).flatMap((version) => version.audit),
    ];
    return events.sort((a, b) => {
      if (a.at !== b.at) return a.at < b.at ? -1 : 1;
      return a.id.localeCompare(b.id);
    });
  }
}

const globalKey = "__bhashaMarketsStore__";

interface GlobalWithStore {
  [globalKey]?: MarketStore;
}

const globalObject = globalThis as unknown as GlobalWithStore;

export const store: MarketStore =
  globalObject[globalKey] ?? (globalObject[globalKey] = new MarketStore());
