import { LLMClient, CompletionRequest, ChatMessage, LLMError } from "./client.js";

export interface GeminiClientOptions {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
}

/**
 * Google Gemini chat client over the Generative Language REST API (v1beta),
 * plain `fetch`, no SDK. Reads `GEMINI_API_KEY` (or `GOOGLE_API_KEY`).
 *
 * The API differs from OpenAI's: system messages go in `systemInstruction`,
 * turns are `contents` with roles `user`/`model`, and JSON mode is requested via
 * `generationConfig.responseMimeType`.
 */
export class GeminiClient implements LLMClient {
  readonly name = "gemini";
  readonly defaultModel: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(opts: GeminiClientOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? "";
    this.baseUrl = (opts.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
    this.defaultModel = opts.defaultModel ?? "gemini-1.5-flash";
  }

  async complete(req: CompletionRequest): Promise<string> {
    if (!this.apiKey) {
      throw new LLMError("GEMINI_API_KEY is not set", this.name);
    }

    const system = req.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const contents = req.messages
      .filter((m: ChatMessage) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    const model = req.model ?? this.defaultModel;
    const res = await fetch(`${this.baseUrl}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": this.apiKey,
      },
      body: JSON.stringify({
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents,
        generationConfig: {
          temperature: req.temperature ?? 0.7,
          maxOutputTokens: req.maxTokens ?? 512,
          ...(req.json ? { responseMimeType: "application/json" } : {}),
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new LLMError(`Gemini request failed: ${body}`, this.name, res.status);
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return (
      data.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? "")
        .join("")
        .trim() ?? ""
    );
  }
}
