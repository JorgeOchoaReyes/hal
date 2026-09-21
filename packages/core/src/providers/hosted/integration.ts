import { Persona, Transcript } from "../../types.js";
import { ProviderField } from "../templates.js";

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
}

export interface HostedTestingAgent {
  id: string; // HAL id
  accountId: string;
  provider: string;
  /** The agent/assistant id on the provider platform. */
  externalAgentId: string;
  name: string;
  createdAt: number;
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

export async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
