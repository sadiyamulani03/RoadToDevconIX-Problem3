import { beforeEach, describe, expect, it } from "vitest";
import { store } from "@/lib/store";
import {
  acknowledgeVersionIssue,
  editVersion,
  injectDemoCorruption,
  revalidateVersionById,
  translateMarketVersion,
} from "@/lib/service";
import { evaluatePublishGate } from "@/lib/publish-gate";
import { createVersionState } from "@/lib/review-workflow";
import { getSampleMarket } from "@/lib/sample-markets";

beforeEach(() => {
  store.reset();
});

describe("publish gate", () => {
  it("allows a freshly verified version and says why", async () => {
    await translateMarketVersion("rbi-rate-cut-2027", ["hi"], { env: {} });
    const gate = evaluatePublishGate(store.getVersion("rbi-rate-cut-2027.hi")!);
    expect(gate.allowed).toBe(true);
    expect(gate.reasons).toEqual([]);
    expect(gate.summary).toContain("Ready to publish");
  });

  it("rejects a version that was edited after validation", async () => {
    await translateMarketVersion("rbi-rate-cut-2027", ["hi"], { env: {} });
    const current = store.getVersion("rbi-rate-cut-2027.hi")!;
    editVersion({
      versionId: current.versionId,
      field: "title",
      text: `${current.translated!.title} `,
      editor: "test",
    });
    const gate = evaluatePublishGate(store.getVersion("rbi-rate-cut-2027.hi")!);
    expect(gate.allowed).toBe(false);
    expect(gate.reasons.map((reason) => reason.code)).toContain(
      "edited_since_validation"
    );
  });

  it("rejects corrupted values with the blocking issues attached", async () => {
    await translateMarketVersion("rbi-rate-cut-2027", ["hi"], { env: {} });
    injectDemoCorruption({
      marketId: "rbi-rate-cut-2027",
      language: "hi",
      kind: "percent_shift",
    });
    revalidateVersionById("rbi-rate-cut-2027.hi");
    const gate = evaluatePublishGate(store.getVersion("rbi-rate-cut-2027.hi")!);
    expect(gate.allowed).toBe(false);
    const blocking = gate.reasons.find(
      (reason) => reason.code === "blocking_issues"
    );
    expect(blocking?.issues?.length).toBeGreaterThan(0);
    expect(blocking?.issues?.[0].severity).toBe("blocking");
  });

  it("rejects unacknowledged review issues, then allows them once acknowledged", async () => {
    await translateMarketVersion("rbi-rate-cut-2027", ["hi"], { env: {} });
    const current = store.getVersion("rbi-rate-cut-2027.hi")!;
    editVersion({
      versionId: current.versionId,
      field: "title",
      text: current.translated!.title.replace(" से पहले", ""),
      editor: "test",
    });
    revalidateVersionById(current.versionId);

    const gated = evaluatePublishGate(store.getVersion(current.versionId)!);
    expect(gated.allowed).toBe(false);
    const reason = gated.reasons.find(
      (candidate) => candidate.code === "unacknowledged_review_issues"
    );
    expect(reason).toBeDefined();
    const issueId = reason!.issues![0].issueId;

    const ack = acknowledgeVersionIssue({
      versionId: current.versionId,
      issueId,
      reviewer: "Test Reviewer",
      note: "Meaning confirmed manually.",
    });
    expect(ack.ok).toBe(true);

    const gate = evaluatePublishGate(store.getVersion(current.versionId)!);
    expect(gate.allowed).toBe(true);
    expect(gate.derivedStatus).toBe("verified");
  });

  it("refuses to acknowledge blocking issues", async () => {
    await translateMarketVersion("rbi-rate-cut-2027", ["hi"], { env: {} });
    injectDemoCorruption({
      marketId: "rbi-rate-cut-2027",
      language: "hi",
      kind: "date_shift",
    });
    const state = revalidateVersionById("rbi-rate-cut-2027.hi");
    const blocking = state.validation!.issues.find(
      (issue) => issue.severity === "blocking"
    )!;
    const result = acknowledgeVersionIssue({
      versionId: "rbi-rate-cut-2027.hi",
      issueId: blocking.issueId,
      reviewer: "Test Reviewer",
      note: "Attempting to bypass.",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("cannot be acknowledged");
  });

  it("flags empty fields as blocking reasons", async () => {
    await translateMarketVersion("rbi-rate-cut-2027", ["hi"], { env: {} });
    editVersion({
      versionId: "rbi-rate-cut-2027.hi",
      field: "resolutionSource",
      text: "",
      editor: "test",
    });
    revalidateVersionById("rbi-rate-cut-2027.hi");
    const gate = evaluatePublishGate(store.getVersion("rbi-rate-cut-2027.hi")!);
    expect(gate.allowed).toBe(false);
    expect(gate.reasons.map((reason) => reason.code)).toContain("empty_field");
  });

  it("rejects languages that were never translated", () => {
    const state = createVersionState({
      marketId: getSampleMarket("rbi-rate-cut-2027")!.id,
      language: "hi",
      at: new Date().toISOString(),
    });
    const gate = evaluatePublishGate(state);
    expect(gate.allowed).toBe(false);
    expect(gate.reasons.map((reason) => reason.code)).toContain("no_translation");
  });

  it("never trusts a 'published' status without a matching hash", async () => {
    await translateMarketVersion("rbi-rate-cut-2027", ["hi"], { env: {} });
    const published = store.getVersion("rbi-rate-cut-2027.hi")!;
    const forged = {
      ...published,
      status: "published" as const,
      currentHash: "tampered",
    };
    const gate = evaluatePublishGate(forged);
    expect(gate.allowed).toBe(false);
  });
});
