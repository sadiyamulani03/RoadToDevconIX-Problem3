/**
 * Acceptance audit.
 *
 * A machine-checked acceptance run over the whole workbench. Every check maps
 * to a requirement of the task; the script exits non-zero if any check fails.
 * Runs fully offline against the deterministic fixture provider.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SAMPLE_MARKETS } from "@/lib/sample-markets";
import { MarketSourceSchema } from "@/lib/market-schema";
import { store } from "@/lib/store";
import { deriveStatus } from "@/lib/review-workflow";
import {
  acknowledgeVersionIssue,
  editVersion,
  injectDemoCorruption,
  publishVersion,
  revalidateVersionById,
  translateMarketVersion,
} from "@/lib/service";
import { extractMarketInvariants } from "@/lib/invariants/extractor";
import { formatClosingAtDisplay } from "@/lib/closing-time";

interface Check {
  criterion: string;
  name: string;
  ok: boolean;
  detail: string;
}

const checks: Check[] = [];

function check(criterion: string, name: string, ok: boolean, detail = ""): void {
  checks.push({ criterion, name, ok, detail });
}

async function main(): Promise<void> {
  store.reset();

  /* Criterion 1 — all five fields captured, including the complete rules. */
  let schemaOk = true;
  let fieldsOk = true;
  for (const market of SAMPLE_MARKETS) {
    const parsed = MarketSourceSchema.safeParse(market);
    if (!parsed.success) schemaOk = false;
    if (
      !market.title ||
      !market.question ||
      !market.resolutionRules ||
      !market.closingAt ||
      !market.resolutionSource
    ) {
      fieldsOk = false;
    }
  }
  check("1", "every market validates against the schema", schemaOk);
  check("1", "all five fields present on all sample markets", fieldsOk);
  check(
    "1",
    "closing time parsed with timezone (5:30 PM IST)",
    formatClosingAtDisplay(SAMPLE_MARKETS[0]) === "15 June 2027, 5:30 PM IST",
    formatClosingAtDisplay(SAMPLE_MARKETS[0])
  );
  check(
    "1",
    "resolution rules contain dates, quantities and links",
    extractMarketInvariants(SAMPLE_MARKETS[0]).all.some((i) => i.kind === "date") &&
      extractMarketInvariants(SAMPLE_MARKETS[0]).all.some((i) => i.kind === "quantity") &&
      extractMarketInvariants(SAMPLE_MARKETS[0]).all.some((i) => i.kind === "url")
  );

  /* Criterion 2 — deterministic invariant extraction across the corpus. */
  const kinds = new Set(
    SAMPLE_MARKETS.flatMap((market) =>
      extractMarketInvariants(market).all.map((invariant) => invariant.kind)
    )
  );
  const requiredKinds = ["date", "time", "year", "percent", "money", "quantity", "number", "url"];
  for (const kind of requiredKinds) {
    check("2", `corpus exercises ${kind} invariants`, kinds.has(kind as never));
  }
  check(
    "2",
    "deadline relations before / by / after all appear in the corpus",
    (() => {
      const relations = new Set(
        SAMPLE_MARKETS.flatMap((market) =>
          extractMarketInvariants(market).all.map((invariant) => invariant.relation)
        )
      );
      return ["before", "by", "after"].every((relation) =>
        relations.has(relation as never)
      );
    })()
  );

  /* Criterion 3+4 — protection, restoration and full verification. */
  let allVerified = true;
  let allMatched = true;
  let fixtureDetail = "";
  for (const market of SAMPLE_MARKETS) {
    const translation = await translateMarketVersion(
      market.id,
      ["hi", "ta", "mr"],
      { env: {} }
    );
    for (const version of translation.versions) {
      if (version.status !== "verified") {
        allVerified = false;
        fixtureDetail = `${market.id}.${version.language}: ${version.status}`;
      }
      const report = version.validation;
      if (!report || report.invariantsMatched !== report.invariantsChecked) {
        allMatched = false;
      }
    }
  }
  check("3", "all 18 language versions verify end-to-end", allVerified, fixtureDetail);
  check("4", "every protected fact matched in every version", allMatched);

  const rbiHi = store.getVersion("rbi-rate-cut-2027.hi");
  check(
    "4",
    "placeholder audit shows tokens survived byte-for-byte",
    Boolean(rbiHi?.validation?.placeholderAudits.every((audit) => audit.status === "ok")),
    `${rbiHi?.validation?.placeholderAudits.length ?? 0} tokens audited`
  );
  check(
    "4",
    "restored Hindi text uses Devanagari digits",
    /[०-९]/.test(rbiHi?.translated?.title ?? ""),
    rbiHi?.translated?.title ?? ""
  );

  /* Criterion 5 — changed values and relations are caught. */
  await translateMarketVersion("cpi-inflation-april-2027", ["hi"], { env: {} });
  const percentCorruption = injectDemoCorruption({
    marketId: "cpi-inflation-april-2027",
    language: "hi",
    kind: "percent_shift",
  });
  const cpiAfter = revalidateVersionById("cpi-inflation-april-2027.hi");
  check(
    "5",
    "changed percentage is caught as blocking",
    percentCorruption.ok &&
      cpiAfter.status === "blocked" &&
      Boolean(
        cpiAfter.validation?.issues.some(
          (issue) => issue.code === "changed_value" && issue.severity === "blocking"
        )
      ),
    cpiAfter.validation?.issues[0]?.message ?? percentCorruption.error ?? ""
  );
  check(
    "5",
    "publish gate refuses the corrupted version",
    !publishVersion("cpi-inflation-april-2027.hi").ok
  );

  await translateMarketVersion("monsoon-onset-kerala-2027", ["ta"], { env: {} });
  const dateCorruption = injectDemoCorruption({
    marketId: "monsoon-onset-kerala-2027",
    language: "ta",
    kind: "date_shift",
  });
  const monsoonAfter = revalidateVersionById("monsoon-onset-kerala-2027.ta");
  check(
    "5",
    "changed date is caught as blocking",
    dateCorruption.ok &&
      monsoonAfter.status === "blocked" &&
      Boolean(
        monsoonAfter.validation?.issues.some(
          (issue) => issue.code === "changed_value" && issue.severity === "blocking"
        )
      ),
    dateCorruption.from && dateCorruption.to
      ? `${dateCorruption.from} -> ${dateCorruption.to}`
      : dateCorruption.error ?? ""
  );

  /* Criterion 5 (relations) — after -> before swap must be blocking. */
  await translateMarketVersion("karnataka-bypoll-margin-2027", ["hi"], { env: {} });
  const karnatakaRules =
    store.getVersion("karnataka-bypoll-margin-2027.hi")?.translated?.resolutionRules ?? "";
  editVersion({
    versionId: "karnataka-bypoll-margin-2027.hi",
    field: "resolutionRules",
    text: karnatakaRules.replace(" के बाद", " से पहले"),
    editor: "audit",
  });
  const relationSwap = revalidateVersionById("karnataka-bypoll-margin-2027.hi");
  const relationIssue = relationSwap.validation?.issues.find(
    (issue) => issue.code === "deadline_relation_changed"
  );
  check(
    "5",
    "before/after deadline swap is caught as blocking",
    Boolean(relationIssue && relationIssue.severity === "blocking"),
    relationIssue?.message ?? relationSwap.validation?.issues.map((i) => i.code).join(", ") ?? ""
  );

  /* Criterion 6 — review workflow with explicit acknowledgements. */
  await translateMarketVersion("vande-bharat-mumbai-goa-2028", ["ta"], { env: {} });
  const vande = store.getVersion("vande-bharat-mumbai-goa-2028.ta");
  const originalTitle = vande?.translated?.title ?? "";
  editVersion({
    versionId: "vande-bharat-mumbai-goa-2028.ta",
    field: "title",
    text: originalTitle.replace(" முன்", ""),
    editor: "audit",
  });
  const unverified = revalidateVersionById("vande-bharat-mumbai-goa-2028.ta");
  const reviewIssue = unverified.validation?.issues.find(
    (issue) => issue.code === "deadline_relation_unverified"
  );
  check(
    "6",
    "missing deadline word becomes a review issue (not a silent pass)",
    Boolean(reviewIssue && reviewIssue.severity === "review"),
    reviewIssue?.message ?? unverified.validation?.issues.map((i) => i.code).join(", ") ?? ""
  );
  check(
    "6",
    "review issue blocks publish until acknowledged",
    !publishVersion("vande-bharat-mumbai-goa-2028.ta").ok
  );
  const acknowledgement = reviewIssue
    ? acknowledgeVersionIssue({
        versionId: "vande-bharat-mumbai-goa-2028.ta",
        issueId: reviewIssue.issueId,
        reviewer: "Audit Reviewer",
        note: "Tamil sentence still communicates the deadline; accepted after human read.",
      })
    : { ok: false };
  check(
    "6",
    "acknowledgement with a note is recorded",
    acknowledgement.ok,
    acknowledgement.ok ? "recorded" : "failed"
  );
  const afterAck = store.getVersion("vande-bharat-mumbai-goa-2028.ta");
  check(
    "6",
    "after acknowledgement the version is verified and publishable",
    Boolean(afterAck && deriveStatus(afterAck) === "verified") &&
      publishVersion("vande-bharat-mumbai-goa-2028.ta").ok
  );

  /* Criterion 6b — blocking issues can never be acknowledged. */
  const blockingIssue = relationSwap.validation?.issues.find(
    (issue) => issue.severity === "blocking"
  );
  const forbiddenAck = blockingIssue
    ? acknowledgeVersionIssue({
        versionId: "karnataka-bypoll-margin-2027.hi",
        issueId: blockingIssue.issueId,
        reviewer: "Audit Reviewer",
        note: "Trying to wave it through.",
      })
    : { ok: true };
  check(
    "6",
    "blocking issues cannot be acknowledged away",
    forbiddenAck.ok === false,
    forbiddenAck.ok ? "WRONGLY ALLOWED" : "refused"
  );

  /* Criterion 7 — the publish gate recomputes from data. */
  await translateMarketVersion("pmay-gramin-subsidy-2028", ["mr"], { env: {} });
  const pmayBefore = store.getVersion("pmay-gramin-subsidy-2028.mr");
  editVersion({
    versionId: "pmay-gramin-subsidy-2028.mr",
    field: "title",
    text: `${pmayBefore?.translated?.title ?? ""} `,
    editor: "audit",
  });
  const editGate = publishVersion("pmay-gramin-subsidy-2028.mr");
  check(
    "7",
    "edited-since-validation cannot publish even though status was verified",
    !editGate.ok &&
      editGate.gate.reasons.some((reason) => reason.code === "edited_since_validation"),
    editGate.gate.summary
  );
  const magnitude = injectDemoCorruption({
    marketId: "pmay-gramin-subsidy-2028",
    language: "mr",
    kind: "magnitude_shift",
  });
  const pmayAfter = revalidateVersionById("pmay-gramin-subsidy-2028.mr");
  check(
    "7",
    "lakh -> crore style magnitude change is blocking",
    magnitude.ok &&
      pmayAfter.status === "blocked" &&
      Boolean(
        pmayAfter.validation?.issues.some(
          (issue) =>
            issue.code === "changed_value" ||
            issue.code === "magnitude_mismatch"
        )
      ),
    magnitude.ok ? `${magnitude.from} -> ${magnitude.to}` : magnitude.error ?? ""
  );

  /* Criterion 8 — the audit trail records every action. */
  const auditEvents = [
    ...store.auditFor("rbi-rate-cut-2027"),
    ...store.auditFor("pmay-gramin-subsidy-2028"),
    ...store.auditFor("vande-bharat-mumbai-goa-2028"),
  ];
  const actions = new Set(auditEvents.map((event) => event.action));
  for (const required of [
    "translation_requested",
    "translation_received",
    "validation_completed",
    "reviewer_edit",
    "issue_acknowledged",
    "publish_blocked",
    "published",
    "demo_corruption_injected",
  ]) {
    check("8", `audit trail contains ${required}`, actions.has(required as never));
  }

  /* Criterion 9 — repository hygiene and reproducibility. */
  const envExample = readFileSync(join(__dirname, "..", ".env.example"), "utf8");
  check(
    "9",
    ".env.example contains no real key",
    /SARVAM_API_KEY=\s*$/m.test(envExample) || /SARVAM_API_KEY=$/m.test(envExample)
  );
  const gitignore = readFileSync(join(__dirname, "..", ".gitignore"), "utf8");
  check("9", ".gitignore excludes .env.local", gitignore.includes(".env.local"));
  check(
    "9",
    "verify pipeline documented (package.json verify script)",
    readFileSync(join(__dirname, "..", "package.json"), "utf8").includes(
      '"verify"'
    )
  );

  /* Report. */
  console.log("");
  console.log("Acceptance audit (offline, deterministic fixtures)");
  console.log("-".repeat(72));
  let failed = 0;
  for (const item of checks) {
    if (!item.ok) failed += 1;
    console.log(
      `${item.ok ? "PASS" : "FAIL"}  [criterion ${item.criterion}] ${item.name}${
        item.detail ? `\n        ${item.detail}` : ""
      }`
    );
  }
  console.log("-".repeat(72));
  console.log(
    failed === 0
      ? `ALL ${checks.length} ACCEPTANCE CHECKS PASSED`
      : `${failed} of ${checks.length} ACCEPTANCE CHECKS FAILED`
  );
  if (failed > 0) process.exitCode = 1;
}

void main().catch((error) => {
  console.error("Audit crashed:", error);
  process.exitCode = 1;
});
