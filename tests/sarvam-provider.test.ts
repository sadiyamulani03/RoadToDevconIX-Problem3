import { describe, expect, it } from "vitest";
import {
  SarvamTranslationProvider,
  splitIntoChunks,
} from "@/lib/translation/sarvam-provider";
import { TranslationProviderError } from "@/lib/translation/types";
import type { TranslationRequest } from "@/lib/translation/types";

function request(text: string): TranslationRequest {
  return {
    marketId: "rbi-rate-cut-2027",
    sourceLanguageCode: "en-IN",
    targetLanguage: "hi",
    targetLanguageCode: "hi-IN",
    targetLanguageLabel: "Hindi",
    fields: [
      { field: "title", text, placeholderIds: ["INV_001"] },
      { field: "question", text: "Second field", placeholderIds: [] },
    ],
    context: { title: "RBI Repo Rate Cut", closingAtDisplay: "15 June 2027" },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Sarvam provider request shape", () => {
  it("sends the documented body and headers and returns translated fields", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchStub = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      return jsonResponse({
        translated_text: "⟦INV_001⟧ से पहले रेपो दर में कटौती",
        request_id: "req-1",
      });
    }) as unknown as typeof fetch;

    const provider = new SarvamTranslationProvider({
      apiKey: "secret-key",
      baseUrl: "https://api.sarvam.ai/",
      model: "sarvam-translate:v1",
      fetchImpl: fetchStub,
      sleepImpl: async () => {},
    });

    const response = await provider.translate(request("Rate cut before ⟦INV_001⟧"));

    expect(calls).toHaveLength(2); // one per field
    expect(calls[0].url).toBe("https://api.sarvam.ai/translate");
    expect(calls[0].init.method).toBe("POST");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["api-subscription-key"]).toBe("secret-key");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toEqual({
      input: "Rate cut before ⟦INV_001⟧",
      source_language_code: "en-IN",
      target_language_code: "hi-IN",
      model: "sarvam-translate:v1",
    });

    expect(response.providerId).toBe("sarvam-live");
    expect(response.isLive).toBe(true);
    expect(response.fields[0].text).toContain("⟦INV_001⟧");
    expect(response.providerRequestIds).toEqual(["req-1", "req-1"]);
  });

  it("never leaks the API key in error messages", async () => {
    const fetchStub = (async () =>
      jsonResponse({ error: "forbidden" }, 403)) as unknown as typeof fetch;
    const provider = new SarvamTranslationProvider({
      apiKey: "super-secret-key",
      baseUrl: "https://api.sarvam.ai",
      model: "sarvam-translate:v1",
      fetchImpl: fetchStub,
      sleepImpl: async () => {},
    });

    await expect(provider.translate(request("hello"))).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof TranslationProviderError &&
        error.code === "missing_credentials" &&
        !error.message.includes("super-secret-key")
    );
  });
});

describe("Sarvam provider retry policy", () => {
  it("fails fast on HTTP 403 without retrying", async () => {
    let calls = 0;
    const fetchStub = (async () => {
      calls += 1;
      return jsonResponse({}, 403);
    }) as unknown as typeof fetch;
    const provider = new SarvamTranslationProvider({
      apiKey: "key",
      baseUrl: "https://api.sarvam.ai",
      model: "sarvam-translate:v1",
      maxAttempts: 3,
      fetchImpl: fetchStub,
      sleepImpl: async () => {},
    });

    await expect(provider.translate(request("x"))).rejects.toMatchObject({
      code: "missing_credentials",
    });
    expect(calls).toBe(1);
  });

  it("retries rate limits and succeeds on the second attempt", async () => {
    let calls = 0;
    const fetchStub = (async () => {
      calls += 1;
      if (calls === 1) return jsonResponse({}, 429);
      return jsonResponse({ translated_text: "ok", request_id: "req-2" });
    }) as unknown as typeof fetch;
    const provider = new SarvamTranslationProvider({
      apiKey: "key",
      baseUrl: "https://api.sarvam.ai",
      model: "sarvam-translate:v1",
      maxAttempts: 3,
      fetchImpl: fetchStub,
      sleepImpl: async () => {},
    });

    const response = await provider.translate({
      ...request("x"),
      fields: [{ field: "title", text: "x", placeholderIds: [] }],
    });
    expect(calls).toBe(2);
    expect(response.fields[0].text).toBe("ok");
  });

  it("gives up after maxAttempts with a rate_limited error", async () => {
    let calls = 0;
    const fetchStub = (async () => {
      calls += 1;
      return jsonResponse({}, 429);
    }) as unknown as typeof fetch;
    const provider = new SarvamTranslationProvider({
      apiKey: "key",
      baseUrl: "https://api.sarvam.ai",
      model: "sarvam-translate:v1",
      maxAttempts: 2,
      fetchImpl: fetchStub,
      sleepImpl: async () => {},
    });

    await expect(provider.translate(request("x"))).rejects.toMatchObject({
      code: "rate_limited",
    });
    expect(calls).toBe(2);
  });

  it("rejects malformed responses instead of guessing", async () => {
    const fetchStub = (async () =>
      jsonResponse({ request_id: "req-3" })) as unknown as typeof fetch;
    const provider = new SarvamTranslationProvider({
      apiKey: "key",
      baseUrl: "https://api.sarvam.ai",
      model: "sarvam-translate:v1",
      fetchImpl: fetchStub,
      sleepImpl: async () => {},
    });

    await expect(provider.translate(request("x"))).rejects.toMatchObject({
      code: "malformed_response",
    });
  });

  it("fails before any network call when the key is missing", async () => {
    let calls = 0;
    const fetchStub = (async () => {
      calls += 1;
      return jsonResponse({});
    }) as unknown as typeof fetch;
    const provider = new SarvamTranslationProvider({
      apiKey: undefined,
      baseUrl: "https://api.sarvam.ai",
      model: "sarvam-translate:v1",
      fetchImpl: fetchStub,
    });

    await expect(provider.translate(request("x"))).rejects.toMatchObject({
      code: "missing_credentials",
    });
    expect(calls).toBe(0);
  });
});

describe("placeholder-safe chunking", () => {
  it("returns short text unchanged", () => {
    expect(splitIntoChunks("short text", 100)).toEqual(["short text"]);
  });

  it("splits on sentence boundaries below the limit", () => {
    const sentence = "This sentence is about thirty characters.";
    const text = [sentence, sentence, sentence, sentence].join(" ");
    const chunks = splitIntoChunks(text, 90);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(90);
    expect(chunks.join(" ")).toBe(text);
  });

  it("never cuts a placeholder in half when hard-splitting", () => {
    const text = `${"a".repeat(30)}⟦INV_001⟧${"b".repeat(30)}`;
    const chunks = splitIntoChunks(text, 45);
    for (const chunk of chunks) {
      if (chunk.includes("⟦")) {
        expect(chunk).toContain("⟧");
      }
    }
    expect(chunks.join("").replace(/\s+/g, "")).toContain("⟦INV_001⟧");
  });
});
