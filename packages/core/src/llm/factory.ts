import { LLMClient } from "./client.js";
import { OpenAIClient } from "./openai.js";
import { AnthropicClient } from "./anthropic.js";
import { MockLLMClient } from "./mock.js";

export type LLMProvider = "openai" | "anthropic" | "mock" | "auto";

/**
 * Resolve an LLM client. `auto` picks the first provider that has credentials,
 * falling back to the deterministic mock so HAL always runs.
 */
export function createLLM(provider: LLMProvider = "auto", model?: string): LLMClient {
  switch (provider) {
    case "openai":
      return new OpenAIClient({ defaultModel: model });
    case "anthropic":
      return new AnthropicClient({ defaultModel: model });
    case "mock":
      return new MockLLMClient();
    case "auto":
    default:
      if (process.env.OPENAI_API_KEY) return new OpenAIClient({ defaultModel: model });
      if (process.env.ANTHROPIC_API_KEY) return new AnthropicClient({ defaultModel: model });
      return new MockLLMClient();
  }
}
