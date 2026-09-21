import { LLMClient, CompletionRequest, LLMError } from "./client.js";

export interface AnthropicClientOptions {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
}

/**
 * Anthropic Messages API client over fetch. Anthropic keeps the system prompt
 * separate from the message list, so we split it out here.
 */
export class AnthropicClient implements LLMClient {
  readonly name = "anthropic";
  readonly defaultModel: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(opts: AnthropicClientOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
    this.baseUrl = (opts.baseUrl ?? "https://api.anthropic.com/v1").replace(/\/$/, "");
    this.defaultModel = opts.defaultModel ?? "claude-sonnet-5";
  }

  async complete(req: CompletionRequest): Promise<string> {
    if (!this.apiKey) {
      throw new LLMError("ANTHROPIC_API_KEY is not set", this.name);
    }

    const system = req.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const messages = req.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));

    const res = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: req.model ?? this.defaultModel,
        system: system || undefined,
        messages,
        temperature: req.temperature ?? 0.7,
        max_tokens: req.maxTokens ?? 512,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new LLMError(`Anthropic request failed: ${body}`, this.name, res.status);
    }

    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    return (
      data.content
        ?.filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("")
        .trim() ?? ""
    );
  }
}
