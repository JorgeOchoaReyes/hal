import { registerIntegration } from "./integration.js";
import { VapiIntegration } from "./vapi.js";
import { ElevenLabsIntegration } from "./elevenlabs.js";

// Register the built-in hosted integrations with default (network) fetch.
registerIntegration(new VapiIntegration());
registerIntegration(new ElevenLabsIntegration());

export * from "./integration.js";
export { VapiIntegration } from "./vapi.js";
export { ElevenLabsIntegration } from "./elevenlabs.js";
export { runHostedCall, type HostedRunOptions } from "./hosted-runner.js";
