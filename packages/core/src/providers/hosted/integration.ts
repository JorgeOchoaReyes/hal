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

/** Wrap a fetch with an abort-on-timeout, so a hung provider can't stall a run. */
export function withTimeout(f: FetchLike, ms = 20000): FetchLike {
  return ((url: Parameters<FetchLike>[0], init?: Parameters<FetchLike>[1]) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    return f(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
  }) as FetchLike;
}

/** Result of a credential pre-flight check. */
export interface CredentialCheck {
  ok: boolean;
  detail?: string;
}

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
  /**
   * An existing provider pathway/flow id to run the call against directly,
   * instead of provisioning one. For Bland this is a Pathway built in the
   * Agent Builder (Bland has no documented REST endpoint to create a pathway),
   * so supplying the id is the reliable way to use a deterministic pathway.
   */
  pathwayId?: string;
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
  /**
   * Per-agent provider secret used to dispatch an outbound call from this
   * agent's own pathway/assistant (e.g. Bland's encrypted key). Distinct per
   * agent, so it's stored here rather than on the {@link ProviderAccount}.
   * The value is stored as given — providers that issue it already return it
   * encrypted, so HAL doesn't encrypt it again.
   */
  encryptedKey?: string;
}

export interface HostedTarget {
  phoneNumber: string;
  /**
   * Override the caller id the outbound side dials from, when the provider
   * accepts a raw number for it. Falls back to the account's own `from`
   * credential when omitted. Most useful when the outbound side is a saved
   * agent under test placing its own call — its own number, not the shared
   * account credential.
   */
  fromNumber?: string;
}

/**
 * A minimal reference to an agent that places its own outbound call — used
 * for the "agent under test is outbound" direction, where HAL doesn't dial
 * the agent under test (it has no persisted {@link HostedTestingAgent}
 * record) but still needs to trigger its pathway on the provider.
 */
export interface OutboundAgentRef {
  /** The provider's pathway/agent id to trigger (e.g. a Bland Pathway id). */
  externalAgentId: string;
  /** Per-agent provider secret required to dispatch its own pathway. */
  encryptedKey?: string;
}

/** A phone number owned on a provider account, for the UI's number picker. */
export interface HostedNumber {
  phoneNumber: string;
  /** Friendly label (name, region) when the provider supplies one. */
  label?: string;
  /** What the number can do, when known. */
  capabilities?: Array<"inbound" | "outbound">;
}

/** An existing agent/pathway/flow already on the provider, offered for import. */
export interface HostedRemoteAgent {
  /** The provider id used to run a call (a pathway id, agent id, …). */
  id: string;
  /** Friendly name to show in the picker. */
  name: string;
  /** What the id refers to, so the caller can wire it up correctly. */
  kind: "pathway" | "agent";
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
  /**
   * Pre-flight: make a cheap authenticated request to confirm the credentials
   * work, so the user validates a connection before spending a call.
   */
  verifyCredentials(account: ProviderAccount): Promise<CredentialCheck>;
  /**
   * The platform's NATIVE NODE/GRAPH config (Bland pathway, Vapi workflow,
   * Retell conversation flow, ElevenLabs workflow) compiled from the spec's
   * Structured Test — the preferred step-by-step reproduction. Returns null when
   * the spec has no structured test to lower into a graph.
   */
  buildFlowConfig(spec: TestingAgentSpec): Record<string, unknown> | null;
  /** Create (provision) a testing agent on the platform; returns its id. */
  createTestingAgent(
    account: ProviderAccount,
    spec: TestingAgentSpec,
  ): Promise<{ externalAgentId: string }>;
  /** Assign the testing configuration to a dedicated inbound test number. */
  configureInbound?(account: ProviderAccount, agent: HostedTestingAgent, phoneNumber: string): Promise<void>;
  /** Place an outbound call from the hosted agent to the target. */
  placeCall(
    account: ProviderAccount,
    agent: HostedTestingAgent,
    target: HostedTarget,
  ): Promise<{ externalCallId: string }>;
  /** Authenticated recording stream. Hosts persist it locally, not in the browser. */
  getRecording?(account: ProviderAccount, externalCallId: string): Promise<Response>;
  /** Fetch the current state (and transcript, once ended) of a call. */
  getCall(account: ProviderAccount, externalCallId: string): Promise<HostedCallState>;
  /**
   * List phone numbers owned on this account so the UI can offer a picker
   * (target number, or a caller-id) instead of manual entry. Optional —
   * providers that can't enumerate numbers omit it and the UI falls back to a
   * plain text field, so the user can always type a number by hand.
   */
  listNumbers?(account: ProviderAccount): Promise<HostedNumber[]>;
  /**
   * List agents/pathways/flows that already exist on this account, so the UI
   * can offer them for import instead of building a new one. Optional —
   * providers that can't enumerate them omit it and the UI falls back to a
   * manual id field.
   */
  listRemoteAgents?(account: ProviderAccount): Promise<HostedRemoteAgent[]>;
  /**
   * Trigger an outbound call FROM another agent's own pathway (not the
   * testing agent HAL manages) TO a target number — used when the agent
   * under test is the one placing the call. Optional — providers without a
   * documented way to dispatch a call scoped to a single pathway/agent's own
   * credentials omit it, and callers should reject that direction instead of
   * silently falling back to the account-level {@link placeCall}.
   */
  placeOutboundCall?(
    account: ProviderAccount,
    outbound: OutboundAgentRef,
    target: HostedTarget,
  ): Promise<{ externalCallId: string }>;
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
