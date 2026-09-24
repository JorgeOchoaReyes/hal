import { LLMClient } from "./client.js";
import { OpenAIClient } from "./openai.js";
import { AnthropicClient } from "./anthropic.js";
import { GeminiClient } from "./gemini.js";
import { MockLLMClient } from "./mock.js";

export type LLMProvider = "openai" | "anthropic" | "gemini" | "mock" | "auto";

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
    case "gemini":
      return new GeminiClient({ defaultModel: model });
    case "mock":
      return new MockLLMClient();
    case "auto":
    default:
      if (process.env.OPENAI_API_KEY) return new OpenAIClient({ defaultModel: model });
      if (process.env.ANTHROPIC_API_KEY) return new AnthropicClient({ defaultModel: model });
      if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)
        return new GeminiClient({ defaultModel: model });
      return new MockLLMClient();
  }
}
