/**
 * Credential hygiene scanner.
 *
 * Runs in `npm run verify`. Fails if anything in the repository looks like a
 * live API key, a private key or a committed .env file. The tool itself must
 * never be the reason a secret leaks.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = join(__dirname, "..");

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "coverage",
  "test-results",
  ".data",
]);

const SKIP_FILES = new Set([
  "package-lock.json",
  "tsconfig.tsbuildinfo",
]);

const SKIP_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2", ".pdf"];

interface Finding {
  file: string;
  line: number;
  pattern: string;
  excerpt: string;
}

const PATTERNS: { name: string; regex: RegExp }[] = [
  { name: "sarvam-style key (sk_)", regex: /\bsk_[A-Za-z0-9_-]{16,}/ },
  { name: "openai-style key (sk-)", regex: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { name: "aws access key id", regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "github token", regex: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/ },
  { name: "google api key", regex: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "private key block", regex: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  {
    name: "assigned api key literal",
    regex: /\b(api[_-]?key|secret|token)\b\s*[:=]\s*["'][A-Za-z0-9_\-./+]{20,}["']/i,
  },
  { name: "jwt", regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
];

function walk(dir: string, files: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      walk(full, files);
    } else if (stats.isFile()) {
      if (SKIP_FILES.has(entry)) continue;
      if (SKIP_EXTENSIONS.some((extension) => entry.endsWith(extension))) continue;
      files.push(full);
    }
  }
}

export function scanRepository(): Finding[] {
  const files: string[] = [];
  walk(ROOT, files);
  const findings: Finding[] = [];

  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const relativePath = relative(ROOT, file).split(sep).join("/");
    const lines = content.split("\n");
    lines.forEach((line, index) => {
      for (const pattern of PATTERNS) {
        const match = pattern.regex.exec(line);
        if (match) {
          findings.push({
            file: relativePath,
            line: index + 1,
            pattern: pattern.name,
            excerpt: match[0].slice(0, 12) + "…",
          });
        }
      }
    });
  }

  // A committed .env file is itself a finding, even if it looks empty.
  for (const dangerous of [".env", ".env.local", ".env.production"]) {
    try {
      statSync(join(ROOT, dangerous));
      findings.push({
        file: dangerous,
        line: 0,
        pattern: "committed env file",
        excerpt: "",
      });
    } catch {
      // absent is what we want
    }
  }

  return findings;
}

function main(): void {
  const findings = scanRepository();
  if (findings.length === 0) {
    console.log("scan:secrets — clean. No API keys, tokens or committed .env files found.");
    return;
  }
  console.error("scan:secrets — POTENTIAL SECRETS FOUND:");
  for (const finding of findings) {
    console.error(
      `  ${finding.file}:${finding.line} [${finding.pattern}] ${finding.excerpt}`
    );
  }
  process.exitCode = 1;
}

if (require.main === module) {
  main();
}
