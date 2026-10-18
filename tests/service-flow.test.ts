import { beforeEach, describe, expect, it } from "vitest";
import { store } from "@/lib/store";
import {
  acknowledgeVersionIssue,
  createMarket,
  editVersion,
  getMarketDetail,
  getVersionDetail,
  injectDemoCorruption,
  listMarketSummaries,
  providerStatus,
  publishVersion,
  revalidateVersionById,
  translateMarketVersion,
} from "@/lib/service";
import { deriveStatus } from "@/lib/review-workflow";

beforeEach(() => {
  store.reset();
});

describe("market and version orchestration", () => {
  it("creates a market with a slug id and stores the audit event", () => {
    const market = createMarket({
      title: "Test Market About Rain",
      question: "Will it rain in June 2027?",
      resolutionRules: "Resolves YES if IMD reports rainfall by 30 June 2027.",
      closingAt: "2027-06-30T17:30:00+05:30",
      timezone: "Asia/Kolkata",
      resolutionSource: "IMD press releases (mausam.imd.gov.in).",
    });
    expect(market.id).toBe("test-market-about-rain");
    expect(market.isDemo).toBe(true);
    const audit = store.auditFor(market.id);
    expect(audit.some((event) => event.action === "market_created")).toBe(true);
  });

  it("de-duplicates colliding market ids deterministically", () => {
    const draft = {
      title: "Rain Market",
      question: "Will it rain in June 2027?",
      resolutionRules: "Resolves YES if IMD reports rain.",
      closingAt: "2027-06-30T17:30:00+05:30",
      timezone: "Asia/Kolkata",
      resolutionSource: "IMD.",
    };
    const first = createMarket(draft);
    const second = createMarket(draft);
    expect(first.id).toBe("rain-market");
    expect(second.id).toBe("rain-market-2");
  });

  it("translates all languages, verifies them, and publishes", async () => {
    const result = await translateMarketVersion(
      "rbi-rate-cut-2027",
      ["hi", "ta", "mr"],
      { env: {} }
    );
    expect(result.provider.mode).toBe("demo-fixtures");
    expect(result.provider.isLive).toBe(false);
    for (const version of result.versions) {
      expect(version.status).toBe("verified");
      expect(version.isLiveProvider).toBe(false);
      expect(version.providerLabel).toBe("Curated demo fixtures");
    }

    const publish = publishVersion("rbi-rate-cut-2027.hi");
    expect(publish.ok).toBe(true);
    expect(store.getVersion("rbi-rate-cut-2027.hi")?.status).toBe("published");
    const replay = publishVersion("rbi-rate-cut-2027.hi");
    expect(replay.ok).toBe(false);
    expect(replay.gate.reasons.map((reason) => reason.code)).toContain(
      "already_published"
    );
  });

  it("runs the full corruption narrative: verified -> changed -> blocked -> denied", async () => {
    await translateMarketVersion("cpi-inflation-april-2027", ["hi"], { env: {} });
    expect(store.getVersion("cpi-inflation-april-2027.hi")?.status).toBe("verified");

    const corruption = injectDemoCorruption({
      marketId: "cpi-inflation-april-2027",
      language: "hi",
      kind: "percent_shift",
    });
    expect(corruption.ok).toBe(true);
    expect(store.getVersion("cpi-inflation-april-2027.hi")?.status).toBe(
      "needs_review"
    );

    const state = revalidateVersionById("cpi-inflation-april-2027.hi");
    expect(deriveStatus(state)).toBe("blocked");
    expect(state.validation?.blockingIssueCount).toBeGreaterThan(0);

    const publish = publishVersion("cpi-inflation-april-2027.hi");
    expect(publish.ok).toBe(false);
    expect(publish.gate.reasons.map((reason) => reason.code)).toContain(
      "blocking_issues"
    );
  });

  it("records the whole story in the market audit trail", async () => {
    await translateMarketVersion("rbi-rate-cut-2027", ["hi"], { env: {} });
    injectDemoCorruption({
      marketId: "rbi-rate-cut-2027",
      language: "hi",
      kind: "magnitude_shift",
    });
    revalidateVersionById("rbi-rate-cut-2027.hi");
    publishVersion("rbi-rate-cut-2027.hi");

    const actions = store.auditFor("rbi-rate-cut-2027").map((event) => event.action);
    expect(actions).toContain("translation_requested");
    expect(actions).toContain("translation_received");
    expect(actions).toContain("validation_completed");
    expect(actions).toContain("demo_corruption_injected");
    expect(actions).toContain("reviewer_edit");
    expect(actions).toContain("publish_blocked");
  });

  it("exposes version detail with the gate and the audit trail", async () => {
    await translateMarketVersion("rbi-rate-cut-2027", ["hi"], { env: {} });
    const detail = getVersionDetail("rbi-rate-cut-2027.hi");
    expect(detail?.version.marketId).toBe("rbi-rate-cut-2027");
    expect(detail?.derivedStatus).toBe("verified");
    expect(detail?.gate.allowed).toBe(true);
    expect(detail?.version.audit.length).toBeGreaterThan(0);
    expect(detail?.version.validation?.issues).toEqual([]);
  });

  it("summarises markets with per-language counts", async () => {
    await translateMarketVersion("rbi-rate-cut-2027", ["hi", "ta"], { env: {} });
    const summaries = listMarketSummaries();
    const rbi = summaries.find((summary) => summary.id === "rbi-rate-cut-2027");
    expect(rbi?.versionCount).toBe(2);
    expect(rbi?.verifiedCount).toBe(2);
    expect(rbi?.blockedCount).toBe(0);
  });

  it("reports provider status honestly per environment", () => {
    expect(providerStatus({}).mode).toBe("demo-fixtures");
    expect(providerStatus({}).sarvamKeyConfigured).toBe(false);
    const live = providerStatus({ SARVAM_API_KEY: "k" });
    expect(live.mode).toBe("live");
    expect(live.isLive).toBe(true);
    expect(live.sarvamKeyConfigured).toBe(true);
    const forced = providerStatus({
      TRANSLATION_PROVIDER: "sarvam",
      SARVAM_API_KEY: "",
    });
    expect(forced.mode).toBe("live");
    expect(forced.sarvamKeyConfigured).toBe(false);
  });

  it("requires a note when acknowledging a review issue", async () => {
    await translateMarketVersion("rbi-rate-cut-2027", ["hi"], { env: {} });
    const current = store.getVersion("rbi-rate-cut-2027.hi")!;
    editVersion({
      versionId: current.versionId,
      field: "title",
      text: current.translated!.title.replace(" से पहले", ""),
      editor: "test",
    });
    revalidateVersionById(current.versionId);
    const issue = store
      .getVersion(current.versionId)!
      .validation!.issues.find((candidate) => candidate.severity === "review")!;

    const emptyNote = acknowledgeVersionIssue({
      versionId: current.versionId,
      issueId: issue.issueId,
      reviewer: "Reviewer",
      note: "   ",
    });
    expect(emptyNote.ok).toBe(false);

    const withNote = acknowledgeVersionIssue({
      versionId: current.versionId,
      issueId: issue.issueId,
      reviewer: "Reviewer",
      note: "Confirmed manually.",
    });
    expect(withNote.ok).toBe(true);
    expect(withNote.state.status).toBe("verified");
  });

  it("rejects translation of unknown markets", async () => {
    await expect(
      translateMarketVersion("nope", ["hi"], { env: {} })
    ).rejects.toThrow("Unknown market");
  });

  it("exposes market detail with its source and versions", async () => {
    const detail = getMarketDetail("rbi-rate-cut-2027");
    expect(detail?.market.id).toBe("rbi-rate-cut-2027");
    expect(detail?.market.isDemo).toBe(true);
    expect(detail?.market.timezone).toBe("Asia/Kolkata");
    expect(detail?.versions).toEqual([]);
    expect(detail?.provider.mode).toBe("demo-fixtures");
  });
});
