import { registerIntegration } from "./integration.js";
import { VapiIntegration } from "./vapi.js";
import { ElevenLabsIntegration } from "./elevenlabs.js";
import { BlandIntegration } from "./bland.js";
import { RetellIntegration } from "./retell.js";

// Register the built-in hosted integrations with default (network) fetch.
registerIntegration(new VapiIntegration());
registerIntegration(new ElevenLabsIntegration());
registerIntegration(new BlandIntegration());
registerIntegration(new RetellIntegration());

export * from "./integration.js";
export { VapiIntegration } from "./vapi.js";
export { ElevenLabsIntegration } from "./elevenlabs.js";
export { BlandIntegration } from "./bland.js";
export { RetellIntegration } from "./retell.js";
export { runHostedCall, type HostedRunOptions } from "./hosted-runner.js";
