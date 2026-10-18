# Bhasha Markets

A multilingual market translation workbench for prediction-market listings. Editors write a market once in English; the workbench translates the five listing fields into **Hindi, Tamil and Marathi**, protects every number, date, percentage, amount and rule link from silent alteration, verifies the translation deterministically, and **enforces a publish gate** that refuses to ship a listing whose facts no longer match the English source.

Demo mode is explicit: with no API credentials configured, translation runs on curated offline fixtures labelled "Demo fixtures — not a live translation". The code never fabricates an API call and never labels a demo result as live.

## Why this exists

A wrong translation in a prediction market is not a typo — it changes contract outcomes. "Repo cut **before** 15 June" becoming "**by** 15 June", `₹1 lakh` becoming `₹1 crore`, or `0.25%` becoming `1.25%` silently changes the pay-off. LLM translators are good at prose and bad at guarantees. This workbench separates the two:

- **Prose** goes to a translator (Sarvam AI in live mode, curated fixtures in demo mode).
- **Facts** are extracted deterministically from the English source, replaced with placeholders (`⟦INV_001⟧`) before translation, restored afterwards in the target script, and then verified field-by-field so the shipped text can be proven to contain the same facts.

## How it works

1. **Extract** — a deterministic lexicon-based extractor finds dates, times, years, percentages, money (with lakh/crore magnitude words), quantities (including word quantities like "two crore"), plain numbers and links, together with the deadline relation (`before` / `by` / `on` / `after`) that governs them.
2. **Protect** — values are swapped for numbered placeholders that survive translation byte-for-byte. Relation words stay outside the tokens.
3. **Translate** — the placeholder text is sent to the provider (Sarvam `sarvam-translate:v1` / `mayura:v1`, or the fixture provider). Long fields are chunked on sentence boundaries; placeholders are never split.
4. **Restore** — tokens are replaced with values rendered in the target language (native digits, localized month and magnitude words, units) with an exact-source fallback.
5. **Verify** — placeholders must reappear byte-for-byte; every protected fact is re-extracted from the translated text and compared canonically; deadline relations are compared only where the English declares one. Changed value/unit/relation and placeholder corruption are **blocking**; a deadline word that could not be confirmed mechanically is a **review** item that needs a named human acknowledgement with a note.
6. **Gate** — publishing recomputes everything from the data: no blocking issues, no unacknowledged review items, and the current text hash must equal the hash at last validation. A version edited after verification cannot publish until revalidated. Blocking issues can never be acknowledged away.

Every generation, edit, revalidation, acknowledgement, corruption and gate refusal is appended to a per-market audit trail.

## Stack

- Next.js 15 App Router + React 19 + TypeScript, Zod schemas at every boundary
- In-memory store (`globalThis` singleton) — no database required for the demo
- Vitest test suite, ESLint, `tsx` verification scripts
- Sarvam AI translate API (optional, live) with a fully deterministic offline fixture provider

## Quickstart

```bash
npm install
npm run dev        # http://localhost:3000
```

No credentials are needed: the six sample markets translate and verify offline. To use live translation, copy `.env.example` to `.env.local` and set `SARVAM_API_KEY=...`; the provider chip in the UI turns from "Demo fixtures" to "Sarvam AI (live)".

### Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `SARVAM_API_KEY` | — | Enables live translation; never logged or returned |
| `SARVAM_BASE_URL` | `https://api.sarvam.ai` | API base URL |
| `SARVAM_MODEL` | `sarvam-translate:v1` | Model name (mayura models get a 1000-char limit) |
| `TRANSLATION_PROVIDER` | `auto` | `auto` / `sarvam` / `fixture` |
| `TRANSLATION_TIMEOUT_MS` | `30000` | Per-request timeout |
| `TRANSLATION_MAX_ATTEMPTS` | `3` | Retries for 429/5xx/timeouts (403 fails fast) |

## Verification pipeline

```bash
npm test             # 69 unit/integration tests (offline, deterministic)
npm run typecheck    # tsc --noEmit
npm run lint         # eslint src scripts tests
npm run audit        # 39-check acceptance audit over the whole workbench
npm run scan:secrets # fails if an API key or committed .env is found
npm run smoke        # end-to-end smoke: translate -> verify -> publish -> corrupt -> block
npm run demo:changed-number  # narrative demo of a caught percentage change
npm run verify       # runs all of the above plus a production build
```

The demo corpus (6 markets × 3 languages) verifies 18/18 with every protected fact matched. The audit script exercises the negative paths too: changed percentage, changed date, before→after relation swaps, removed deadline words, corrupt placeholders, empty fields, edited-after-verification text, and attempts to acknowledge a blocking issue — all of which must fail closed.

## Try the failure path

1. Open the app and translate `RBI Repo Rate Cut` into Hindi.
2. Press **Inject demo corruption → percentage shift** (or edit any number by hand).
3. Press **Revalidate**: the version turns `blocked`, the issue names the exact English vs Hindi values, and **Publish** is refused with a machine-checkable reason.
4. Corrupt a relation instead (e.g. remove "से पहले"); revalidation turns `needs_review` and requires an explicit acknowledgement with a reviewer name and note before publishing.

## Honest limitations

- The translation itself is an LLM/API output; this tool proves *fact preservation*, not literary quality. Demo mode uses curated fixtures and is labelled as such everywhere.
- The in-memory store resets when the server restarts (deterministic demo data is re-seeded on boot).
- The live Sarvam path is implemented and unit-tested against stubbed HTTP responses, but was not executed against the real API in this environment because no API key is available.
- WSL note: when the repo lives on a Windows drive (`/mnt/d/...`), `next build` crawls because every `node_modules` read crosses the WSL 9P filesystem (`p9_client_rpc`). The same code builds cleanly on the native Linux filesystem (verified: compiled successfully in ~20s, all 12 routes emitted). On WSL, build from a path under `~` (or run `npm run dev`, which is the demo path), or move the checkout out of `/mnt/`.
