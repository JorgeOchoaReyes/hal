// Domain types
export * from "./types.js";

// LLM
export * from "./llm/client.js";
export { OpenAIClient } from "./llm/openai.js";
export { AnthropicClient } from "./llm/anthropic.js";
export { MockLLMClient } from "./llm/mock.js";
export { createLLM, type LLMProvider } from "./llm/factory.js";

// Simulation
export { Conductor, type AgentAction } from "./simulation/conductor.js";
export { ScenarioBuilder, scenario } from "./simulation/builder.js";
export type { ConductorLike } from "./simulation/conductor.js";
export { StructuredConductor } from "./simulation/structured-conductor.js";
export {
  validateStructuredTest,
  renderFixedMessage,
  FIRST_MESSAGE,
  type StructuredTest,
  type StructuredCondition,
  type StructuredConditionType,
} from "./simulation/structured.js";
export {
  parseAction,
  validateActionTags,
  renderAction,
  SUPPORTED_TAGS,
  type ActionSegment,
  type TagSegment,
  type TextSegment,
  type RenderedAction,
} from "./simulation/tags.js";

// Transports
export * from "./transport/transport.js";
export { MockTransport } from "./transport/mock.js";
export {
  TelephonyTransport,
  BridgedSession,
  type TwilioConfig,
  type BridgeFactory,
} from "./transport/telephony.js";
export { WebRTCTransport, type WebRTCBridgeFactory } from "./transport/webrtc.js";
export { SipTransport, type SipBridgeFactory } from "./transport/sip.js";

// Speech
export * from "./speech/speech.js";

// Judge
export { Judge } from "./judge/judge.js";
export { evaluateRule } from "./judge/rules.js";

// Runner + engine
export { TestRunner, type RunnerDeps, type RunHandle } from "./runner/runner.js";
export { HalEngine, type HalEngineOptions } from "./engine.js";

// Provider templates
export {
  PROVIDER_TEMPLATES,
  getProviderTemplate,
  providerAvailability,
  type ProviderTemplate,
  type ProviderField,
  type FieldKind,
  type ProviderAvailability,
} from "./providers/templates.js";

// Metrics + labels
export {
  computeMetrics,
  deriveLabels,
  type CallMetrics,
  type LatencyStats,
  type Label,
  type LabelTone,
} from "./metrics/metrics.js";

// Typed metric definitions (output types) + evaluator
export {
  checkPassCondition,
  evaluateMetricPass,
  effectivePassCondition,
  metricAffectsOutcome,
  coerceMetricValue,
  type MetricDefinition,
  type MetricResult,
  type MetricOutputType,
  type MetricPassCondition,
} from "./metrics/definitions.js";
export { evaluateMetrics } from "./metrics/evaluator.js";

// Hosted provider integrations (Vapi, ElevenLabs) — testing agents on the
// user's own platform, created with their credentials.
export {
  registerIntegration,
  getIntegration,
  listIntegrations,
  VapiIntegration,
  ElevenLabsIntegration,
  runHostedCall,
  type VoiceProviderIntegration,
  type ProviderAccount,
  type TestingAgentSpec,
  type HostedTestingAgent,
  type HostedTarget,
  type HostedCallState,
  type HostedCallStatus,
  type HostedRunOptions,
  type FetchLike,
} from "./providers/hosted/index.js";

// Utils
export { id, now } from "./util/id.js";
export { TypedEmitter, sleep, type Listener } from "./util/events.js";

// Sample fixtures
export * from "./fixtures.js";
