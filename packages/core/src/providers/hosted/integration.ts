import { Persona, Transcript } from "../../types.js";
import { ProviderField } from "../templates.js";
import { StructuredTest, compileStructuredToPrompt, firstMessageOf } from "../../simulation/structured.js";

/**
 * Hosted-provider model.
 *
 * Instead of HAL running the testing agent itself, the user brings credentials
 * for a voice platform (Vapi, ElevenLabs, …). HAL calls that platform's API to
 * **create a testing agent on the user's behalf**, stores the returned agent id,
 * and then asks the platform to place outbound calls from that agent to the
 * target number. After the call ends, HAL pulls the transcript back and runs the
 * same judge + metrics as any other run.
 */

export type FetchLike = typeof fetch;

export interface ProviderAccount {
  id: string;
  provider: string; // integration id, e.g. "vapi"
  label: string;
  /** Platform credentials (apiKey, phoneNumberId, …). Stored by the host. */
  credentials: Record<string, string>;
  createdAt: number;
}

export interface TestingAgentSpec {
  name: string;
  persona: Persona;
  /** First line the agent speaks when the call connects. */
  firstMessage?: string;
  voice?: string;
  model?: string;
  /**
   * A Structured Test to reproduce deterministically. When present, the
   * integration compiles it into the platform's native agent config (a
   * step-by-step reproduction) instead of using the plain persona prompt.
   */
  structured?: StructuredTest;
}

export interface HostedTestingAgent {
  id: string; // HAL id
  accountId: string;
  provider: string;
  /** The agent/assistant id on the provider platform. */
  externalAgentId: string;
  name: string;
  createdAt: number;
  /**
   * The spec used to create the agent. Kept for task-based providers (e.g.
   * Bland) that send the prompt inline at call time rather than referencing a
   * persisted remote agent.
   */
  spec?: TestingAgentSpec;
}

export interface HostedTarget {
  phoneNumber: string;
}

export type HostedCallStatus = "queued" | "in-progress" | "ended" | "failed";

export interface HostedCallState {
  externalCallId: string;
  status: HostedCallStatus;
  transcript?: Transcript;
  endedReason?: string;
}

/**
 * Adapter for one voice platform. Implementations wrap the platform's REST API.
 */
export interface VoiceProviderIntegration {
  readonly id: string;
  readonly label: string;
  /** Credential fields the account needs (rendered by the UI). */
  readonly credentialFields: ProviderField[];
  /**
   * Compile a spec (optionally carrying a Structured Test) into the platform's
   * NATIVE create-agent request body — the exact config HAL will send. Exposed
   * so the UI can preview the deterministic, step-by-step reproduction before
   * provisioning.
   */
  buildAgentConfig(spec: TestingAgentSpec): Record<string, unknown>;
  /** Create (provision) a testing agent on the platform; returns its id. */
  createTestingAgent(
    account: ProviderAccount,
    spec: TestingAgentSpec,
  ): Promise<{ externalAgentId: string }>;
  /** Place an outbound call from the hosted agent to the target. */
  placeCall(
    account: ProviderAccount,
    agent: HostedTestingAgent,
    target: HostedTarget,
  ): Promise<{ externalCallId: string }>;
  /** Fetch the current state (and transcript, once ended) of a call. */
  getCall(account: ProviderAccount, externalCallId: string): Promise<HostedCallState>;
}

const registry = new Map<string, VoiceProviderIntegration>();

export function registerIntegration(integration: VoiceProviderIntegration): void {
  registry.set(integration.id, integration);
}

export function getIntegration(id: string): VoiceProviderIntegration | undefined {
  return registry.get(id);
}

export function listIntegrations(): VoiceProviderIntegration[] {
  return [...registry.values()];
}

/**
 * Resolve the system prompt + first message for an agent. When the spec carries
 * a Structured Test, the prompt is the compiled deterministic script and the
 * first message is its FIRST_MESSAGE; otherwise the plain persona is used.
 */
export function resolveSpecPrompt(spec: TestingAgentSpec): {
  systemPrompt: string;
  firstMessage?: string;
} {
  if (spec.structured) {
    return {
      systemPrompt: compileStructuredToPrompt(spec.structured),
      firstMessage: spec.firstMessage ?? firstMessageOf(spec.structured),
    };
  }
  return { systemPrompt: spec.persona.systemPrompt, firstMessage: spec.firstMessage };
}

export async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
