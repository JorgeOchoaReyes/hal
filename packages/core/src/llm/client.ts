/**
 * Minimal chat-LLM abstraction. HAL is framework-agnostic: the testing agent
 * persona, the mock target, and the judge all talk to an `LLMClient`. Concrete
 * clients wrap OpenAI, Anthropic, or a deterministic mock — all over plain
 * `fetch`, so no vendor SDK is required to build the package.
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionRequest {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Ask the provider for JSON output (used by the judge). */
  json?: boolean;
}

export interface LLMClient {
  readonly name: string;
  readonly defaultModel: string;
  complete(req: CompletionRequest): Promise<string>;
}

export class LLMError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LLMError";
  }
}
