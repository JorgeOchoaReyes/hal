import { LLMClient } from "./llm/client.js";
import { createLLM, LLMProvider } from "./llm/factory.js";
import { CallTransport } from "./transport/transport.js";
import { MockTransport } from "./transport/mock.js";
import { TelephonyTransport, TwilioConfig, BridgeFactory } from "./transport/telephony.js";
import { WebRTCTransport, WebRTCBridgeFactory } from "./transport/webrtc.js";
import { SipTransport, SipBridgeFactory } from "./transport/sip.js";
import { TestRunner, RunHandle } from "./runner/runner.js";
import { TestCase, TransportKind } from "./types.js";

export interface HalEngineOptions {
  /** LLM for the testing-agent persona. Defaults to auto-detect. */
  llm?: LLMClient;
  /** Provider used when `llm` is not supplied. */
  provider?: LLMProvider;
  /** Separate LLM for the judge (defaults to the persona LLM). */
  judgeLlm?: LLMClient;
  /** LLM that drives the simulated target in mock mode. */
  mockTargetLlm?: LLMClient;

  telephony?: { config?: TwilioConfig; bridgeFactory?: BridgeFactory };
  webrtc?: { bridgeFactory?: WebRTCBridgeFactory };
  sip?: { bridgeFactory?: SipBridgeFactory };
}

/**
 * HalEngine is the one object a host (web app, desktop app, CLI) needs. It wires
 * the LLMs, transports, and runner together and exposes `run(testCase)`.
 *
 * Mock transport always works out of the box. Real transports activate as soon
 * as their config / media bridge is provided.
 */
export class HalEngine {
  private readonly runner: TestRunner;
  private readonly transports: Partial<Record<TransportKind, CallTransport>>;

  constructor(opts: HalEngineOptions = {}) {
    const llm = opts.llm ?? createLLM(opts.provider ?? "auto");
    const mockTargetLlm = opts.mockTargetLlm ?? createLLM(opts.provider ?? "auto");

    this.transports = {
      mock: new MockTransport(mockTargetLlm),
      telephony: new TelephonyTransport(opts.telephony?.config, opts.telephony?.bridgeFactory),
      webrtc: new WebRTCTransport(opts.webrtc?.bridgeFactory),
      sip: new SipTransport(opts.sip?.bridgeFactory),
    };

    this.runner = new TestRunner({
      llm,
      judgeLlm: opts.judgeLlm,
      resolveTransport: (kind) => {
        const t = this.transports[kind];
        if (!t) throw new Error(`No transport registered for "${kind}"`);
        return t;
      },
    });
  }

  /** Run a test case, returning a streaming handle. */
  run(testCase: TestCase): RunHandle {
    return this.runner.run(testCase);
  }

  /** Convenience: run and await the final result. */
  async runToCompletion(testCase: TestCase) {
    return this.run(testCase).result;
  }
}
