/**
 * Narrative demo: "a translator changed one number — can the market still
 * publish?"
 *
 * The script produces a verified Hindi version, injects a plausible error with
 * the same deterministic renderer the pipeline uses, revalidates, and prints
 * exactly what the gate says. No network access is required.
 */

import { store } from "@/lib/store";
import {
  injectDemoCorruption,
  providerStatus,
  publishVersion,
  revalidateVersionById,
  translateMarketVersion,
} from "@/lib/service";
import { MARKET_FIELD_LABELS } from "@/lib/market-schema";

function header(title: string): void {
  console.log("");
  console.log("=".repeat(72));
  console.log(title);
  console.log("=".repeat(72));
}

async function main(): Promise<void> {
  store.reset();
  const provider = providerStatus({});
  console.log(`Provider: ${provider.label} (live: ${provider.isLive})`);

  header("Step 1 — translate and verify the RBI market");
  await translateMarketVersion("rbi-rate-cut-2027", ["hi"], { env: {} });
  const before = store.getVersion("rbi-rate-cut-2027.hi");
  console.log(`Status: ${before?.status}`);
  console.log(
    `Protected facts matched: ${before?.validation?.invariantsMatched}/${before?.validation?.invariantsChecked}`
  );
  console.log(`Resolution rules (Hindi), current text:`);
  console.log(`  ${before?.translated?.resolutionRules}`);

  header("Step 2 — a translator quietly changes one percentage");
  const corruption = injectDemoCorruption({
    marketId: "rbi-rate-cut-2027",
    language: "hi",
    kind: "percent_shift",
  });
  if (!corruption.ok) {
    console.error(`Corruption failed: ${corruption.error}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Changed "${corruption.from}" to "${corruption.to}" in the ${MARKET_FIELD_LABELS[corruption.field!].toLowerCase()}.`
  );
  console.log("The previous verification is now invalid: the text hash no longer matches.");

  header("Step 3 — revalidate: the deterministic checks re-run");
  const revalidated = revalidateVersionById("rbi-rate-cut-2027.hi");
  console.log(`Status after revalidation: ${revalidated.status}`);
  for (const issue of revalidated.validation?.issues ?? []) {
    console.log(`  [${issue.severity}] ${issue.code}`);
    console.log(`    ${issue.message}`);
    console.log(`    Suggestion: ${issue.suggestion}`);
  }

  header("Step 4 — try to publish anyway");
  const publish = publishVersion("rbi-rate-cut-2027.hi");
  console.log(`Publish allowed: ${publish.ok}`);
  console.log(`Gate says: ${publish.gate.summary}`);
  for (const reason of publish.gate.reasons) {
    console.log(`  reason code: ${reason.code}`);
  }

  header("Result");
  const blocked = !publish.ok && revalidated.status === "blocked";
  console.log(
    blocked
      ? "The changed number was caught, and publication is blocked. This is the whole point of Bhasha Markets."
      : "UNEXPECTED: the changed number was not blocked. Investigate."
  );
  if (!blocked) process.exitCode = 1;
}

void main().catch((error) => {
  console.error("Demo crashed:", error);
  process.exitCode = 1;
});
