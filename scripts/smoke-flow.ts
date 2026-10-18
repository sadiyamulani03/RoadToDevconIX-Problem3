/**
 * End-to-end smoke flow, no network required.
 *
 *   translate -> inspect -> publish -> inject error -> revalidate -> blocked
 *
 * Uses the in-process store and the deterministic fixture provider, so it is
 * safe to run in CI and produces the same result every time.
 */

import { store } from "@/lib/store";
import {
  editVersion,
  injectDemoCorruption,
  publishVersion,
  revalidateVersionById,
  translateMarketVersion,
} from "@/lib/service";
import { deriveStatus } from "@/lib/review-workflow";

const checks: { name: string; ok: boolean; detail: string }[] = [];

function check(name: string, ok: boolean, detail = ""): void {
  checks.push({ name, ok, detail });
}

async function main(): Promise<void> {
  store.reset();

  const translation = await translateMarketVersion(
    "rbi-rate-cut-2027",
    ["hi", "mr", "ta"],
    { env: {} }
  );
  check(
    "translation produces 3 language versions",
    translation.versions.length === 3,
    translation.versions.map((version) => version.versionId).join(", ")
  );
  for (const version of translation.versions) {
    check(
      `${version.language} verified with every protected fact matched`,
      deriveStatus(version) === "verified" &&
        version.validation?.invariantsMatched ===
          version.validation?.invariantsChecked,
      `${version.validation?.invariantsMatched}/${version.validation?.invariantsChecked}`
    );
  }

  const publish = publishVersion("rbi-rate-cut-2027.hi");
  check("verified Hindi version publishes", publish.ok, publish.gate.summary);

  const corruption = injectDemoCorruption({
    marketId: "rbi-rate-cut-2027",
    language: "hi",
    kind: "percent_shift",
  });
  check(
    "demo corruption injects a realistic percent error",
    corruption.ok,
    `${corruption.from} -> ${corruption.to} in ${corruption.field}`
  );

  const revalidated = revalidateVersionById("rbi-rate-cut-2027.hi");
  check(
    "revalidation blocks the corrupted version",
    deriveStatus(revalidated) === "blocked",
    deriveStatus(revalidated)
  );
  const changedValue = revalidated.validation?.issues.find(
    (issue) => issue.code === "changed_value"
  );
  check(
    "blocking issue names the changed value",
    Boolean(changedValue && changedValue.severity === "blocking"),
    changedValue?.message ?? "missing issue"
  );

  const republish = publishVersion("rbi-rate-cut-2027.hi");
  check("publish gate refuses after corruption", !republish.ok, republish.gate.summary);

  const second = await translateMarketVersion("pmay-gramin-subsidy-2028", ["ta"], {
    env: {},
  });
  check(
    "PMAY Tamil version verifies (money + word quantity + relation)",
    second.versions[0]?.status === "verified",
    second.versions[0]?.status ?? "no version"
  );

  const edits = editVersion({
    versionId: "pmay-gramin-subsidy-2028.ta",
    field: "title",
    text: "மாற்றியமைக்கப்பட்ட தலைப்பு",
    editor: "smoke-test",
  });
  check(
    "an edit invalidates verification immediately",
    deriveStatus(edits) === "needs_review",
    deriveStatus(edits)
  );
  const gateAfterEdit = publishVersion("pmay-gramin-subsidy-2028.ta");
  check(
    "gate blocks an edited-but-not-revalidated version",
    !gateAfterEdit.ok &&
      gateAfterEdit.gate.reasons.some(
        (reason) => reason.code === "edited_since_validation"
      ),
    gateAfterEdit.gate.summary
  );

  console.log("");
  console.log("Smoke flow results:");
  for (const item of checks) {
    console.log(`  ${item.ok ? "PASS" : "FAIL"}  ${item.name}${item.detail ? ` — ${item.detail}` : ""}`);
  }
  const failed = checks.filter((item) => !item.ok).length;
  console.log("");
  console.log(failed === 0 ? "SMOKE FLOW PASSED" : `SMOKE FLOW FAILED (${failed} check(s))`);
  if (failed > 0) process.exitCode = 1;
}

void main().catch((error) => {
  console.error("Smoke flow crashed:", error);
  process.exitCode = 1;
});
