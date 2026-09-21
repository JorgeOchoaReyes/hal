import { LLMClient, CompletionRequest, LLMError } from "./client.js";

export interface OpenAIClientOptions {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
}

/**
 * OpenAI (and OpenAI-compatible) chat completions client over fetch.
 * Works with any server exposing /v1/chat/completions (Together, Groq,
 * local vLLM, LM Studio, …) by overriding `baseUrl`.
 */
export class OpenAIClient implements LLMClient {
  readonly name = "openai";
  readonly defaultModel: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(opts: OpenAIClientOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY ?? "";
    this.baseUrl = (opts.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.defaultModel = opts.defaultModel ?? "gpt-4o-mini";
  }

  async complete(req: CompletionRequest): Promise<string> {
    if (!this.apiKey) {
      throw new LLMError("OPENAI_API_KEY is not set", this.name);
    }
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: req.model ?? this.defaultModel,
        messages: req.messages,
        temperature: req.temperature ?? 0.7,
        max_tokens: req.maxTokens ?? 512,
        ...(req.json ? { response_format: { type: "json_object" } } : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new LLMError(`OpenAI request failed: ${body}`, this.name, res.status);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content?.trim() ?? "";
  }
}
