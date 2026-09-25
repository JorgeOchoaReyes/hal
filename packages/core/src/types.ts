/**
 * HAL core domain types.
 *
 * The mental model:
 *
 *   TestCase  = a Scenario + a Target + a Judge spec + transport choice
 *   Scenario  = how the HAL testing agent behaves, turn by turn
 *   Target    = the voice AI under test (the thing we are calling)
 *   Transport = HOW the call is placed (mock / telephony / webrtc / sip)
 *   Judge     = classifies the resulting transcript as pass / fail
 *   TestResult = transcript + timings + judge verdict
 */

/** Who produced a given utterance in a conversation. */
export type Role = "agent" | "target" | "system";

/** A single spoken turn in a conversation transcript. */
export interface Utterance {
  role: Role;
  /** The text of what was said (transcribed if audio). */
  text: string;
  /** Unix ms when the utterance started. */
  startedAt: number;
  /** Unix ms when the utterance finished, if known. */
  endedAt?: number;
  /**
   * Latency in ms between the previous turn ending and this turn starting.
   * Useful as a judged metric ("target must respond within 2s").
   */
  latencyMs?: number;
  /** Free-form metadata (audio URL, confidence, barge-in flag, etc.). */
  meta?: Record<string, unknown>;
}

export type Transcript = Utterance[];

// ---------------------------------------------------------------------------
// Scenario / simulation
// ---------------------------------------------------------------------------

/**
 * A scenario controls what the HAL testing agent does. It is a list of steps
 * evaluated in order. Each step is either:
 *  - "say":   scripted text spoken verbatim (deterministic turn-by-turn control)
 *  - "prompt": let the persona LLM generate a reply given a directive
 *  - "wait":  stay silent and wait for the target (optionally with a timeout)
 *  - "hangup": end the call
 *  - "expect": an inline assertion checked live during the call
 */
export type ScenarioStep =
  | { kind: "say"; text: string; /** delay before speaking, ms */ delayMs?: number }
  | { kind: "prompt"; directive: string; /** cap on generated turns for this step */ maxTurns?: number }
  | { kind: "wait"; timeoutMs?: number; /** regex the target reply must match to advance */ until?: string }
  | { kind: "hangup" }
  | { kind: "expect"; assertion: LiveAssertion }
  /**
   * A structured "conditional action": branch on what the target just said.
   * The first branch whose `when` regex matches the latest target utterance
   * fires its action; if none match, `fallback` runs (or the step is skipped).
   * `goto` enables decision-tree loops, bounded by `maxVisits`.
   */
  | {
      kind: "branch";
      branches: ConditionalBranch[];
      fallback?: BranchAction;
      /** Max times this branch step may run before it is skipped (default 10). */
      maxVisits?: number;
    };

export interface ConditionalBranch {
  /** Regex (source) matched against the latest target utterance. */
  when: string;
  action: BranchAction;
  /** Optional human-readable label for the branch. */
  label?: string;
}

export type BranchAction =
  | { kind: "say"; text: string }
  | { kind: "prompt"; directive: string }
  | { kind: "goto"; step: number }
  | { kind: "hangup" };

/** An assertion evaluated live (mid-call) against the most recent target turn. */
export interface LiveAssertion {
  id: string;
  description: string;
  /** Match against the latest target utterance text. */
  matches?: string; // regex source
  /** Fail if the target took longer than this to respond. */
  maxLatencyMs?: number;
  /** If true, failing this assertion aborts the call immediately. */
  fatal?: boolean;
}

export interface Persona {
  /** Display name, e.g. "Frustrated customer". */
  name: string;
  /** System prompt describing who the testing agent pretends to be. */
  systemPrompt: string;
  /** Optional voice id for TTS in real audio calls. */
  voice?: string;
  /** Temperature for the persona LLM. */
  temperature?: number;
}

export interface Scenario {
  id: string;
  name: string;
  description?: string;
  persona: Persona;
  /** Linear scenario steps. Ignored when `structured` is set. */
  steps: ScenarioStep[];
  /**
   * A Structured Test (role + conditions). When present, the run is driven by
   * the structured conductor instead of the linear `steps`.
   */
  structured?: import("./simulation/structured.js").StructuredTest;
  /** Hard cap on total turns before HAL force-ends the call. */
  maxTurns?: number;
  /** Hard cap on wall-clock duration before HAL force-ends the call. */
  maxDurationMs?: number;
}

// ---------------------------------------------------------------------------
// Target (system under test)
// ---------------------------------------------------------------------------

export type TransportKind = "mock" | "telephony" | "webrtc" | "sip";

/**
 * Describes the voice AI being tested and how to reach it.
 * The `transport` discriminates which fields are meaningful.
 */
export type Target =
  | {
      transport: "mock";
      name: string;
      /**
       * For fully offline testing, the mock target can itself be driven by an
       * LLM persona (so HAL can be validated without any external system).
       */
      mock: { systemPrompt: string; greeting?: string };
    }
  | {
      transport: "telephony";
      name: string;
      /** E.164 phone number to dial, e.g. +14155550123. */
      phoneNumber: string;
      /** Provider-specific options (Twilio region, machine detection, etc). */
      options?: Record<string, unknown>;
    }
  | {
      transport: "webrtc";
      name: string;
      /** Signaling endpoint / room the target agent joins. */
      signalingUrl: string;
      room?: string;
      options?: Record<string, unknown>;
    }
  | {
      transport: "sip";
      name: string;
      /** SIP URI, e.g. sip:agent@pbx.example.com. */
      uri: string;
      options?: Record<string, unknown>;
    };

// ---------------------------------------------------------------------------
// Judge / evaluation
// ---------------------------------------------------------------------------

/** A single rule-based check against the final transcript. */
export type JudgeRule =
  | { kind: "transcript-contains"; needle: string; ignoreCase?: boolean; description?: string }
  | { kind: "transcript-not-contains"; needle: string; ignoreCase?: boolean; description?: string }
  | { kind: "regex"; pattern: string; role?: Role; description?: string }
  | { kind: "max-latency"; ms: number; role?: Role; description?: string }
  | { kind: "min-turns"; count: number; description?: string }
  | { kind: "max-turns"; count: number; description?: string };

export interface JudgeSpec {
  /** Deterministic rule checks (fast, free, no LLM). */
  rules?: JudgeRule[];
  /**
   * Natural-language pass criteria evaluated by an LLM judge.
   * e.g. "The agent correctly booked an appointment and confirmed the date."
   */
  criteria?: string[];
  /**
   * Typed, user-defined metrics (boolean / rating / enum / number) evaluated by
   * the LLM judge. Blocking metrics that fail also fail the overall run.
   */
  metrics?: import("./metrics/definitions.js").MetricDefinition[];
  /**
   * LLM provider for the judge. "auto" (default) picks the first provider with
   * credentials; set it to pin the judge to OpenAI, Anthropic, or Gemini.
   */
  provider?: "auto" | "openai" | "anthropic" | "gemini";
  /** Model to use for the LLM judge. */
  model?: string;
  /**
   * How to combine signals into an overall pass:
   *  - "all": every rule AND the LLM verdict must pass (default)
   *  - "rules-only": ignore the LLM verdict
   *  - "llm-only": ignore rules
   */
  mode?: "all" | "rules-only" | "llm-only";
}

/**
 * A saved, reusable judge. Wraps a {@link JudgeSpec} with identity so the same
 * scoring config can be attached to many simulations and applied to uploaded
 * production calls. `kind` is a UI hint derived from what the spec uses:
 *  - "llm": natural-language criteria / typed metrics scored by an LLM
 *  - "code": deterministic rule checks only (no LLM, free)
 *  - "hybrid": both
 */
export interface SavedJudge {
  id: string;
  name: string;
  description?: string;
  kind: "llm" | "code" | "hybrid";
  spec: JudgeSpec;
  createdAt: number;
}

export interface CheckResult {
  id: string;
  description: string;
  passed: boolean;
  detail?: string;
}

export interface JudgeVerdict {
  passed: boolean;
  /** 0..1 confidence / quality score. */
  score: number;
  summary: string;
  checks: CheckResult[];
  /** Typed metric results, when the judge spec defines metrics. */
  metricResults?: import("./metrics/definitions.js").MetricResult[];
}

// ---------------------------------------------------------------------------
// Test case + result
// ---------------------------------------------------------------------------

export interface TestCase {
  id: string;
  name: string;
  scenario: Scenario;
  target: Target;
  judge: JudgeSpec;
  /**
   * Optional references to saved {@link Judge}s. When set, each judge's spec is
   * merged into the inline `judge` at run time (rules/criteria/metrics
   * concatenated), so one simulation can be scored by several reusable judges.
   */
  judgeIds?: string[];
  createdAt?: number;
  tags?: string[];
  /**
   * Optional reference to a saved {@link TargetAgent} in the "My agents"
   * registry. When set, the run resolves the live target from that agent so a
   * simulation always calls the current address, and many simulations can share
   * one target under test. `target` remains the inline fallback.
   */
  targetAgentId?: string;
  /**
   * Optional reference to a provisioned hosted testing agent (the caller) to run
   * this simulation with. When set, dispatch reconfigures that agent for this
   * simulation instead of creating a throwaway one; otherwise dispatch picks the
   * account and provisions ad-hoc.
   */
  testingAgentId?: string;
}

/**
 * A real agent under test — the thing HAL calls. Stored in the "My agents"
 * registry so multiple simulations can point at the same target and its address
 * (phone number / SIP URI / room) lives in one place.
 */
export interface TargetAgent {
  id: string;
  name: string;
  target: Target;
  description?: string;
  /**
   * The voice platform this agent under test is built on (e.g. "vapi",
   * "bland", "retell", "elevenlabs", "twilio", or "custom"). Informational
   * metadata so agents can be grouped/identified by provider.
   */
  provider?: string;
  /**
   * Reusable {@link SavedJudge}s attached to this agent. Production calls
   * assigned to this agent are scored with these judges' merged criteria.
   */
  judgeIds?: string[];
  /**
   * Which way the agent under test runs a call:
   * - `"inbound"` — it answers calls, so HAL dials it (the default).
   * - `"outbound"` — it places calls, so HAL provides a number for it to call
   *   and waits to receive the call.
   * Defaults to `"inbound"` when unset.
   */
  direction?: CallDirection;
  /**
   * Per-agent provider secret used to dispatch an outbound call from this
   * agent's own pathway/assistant (e.g. Bland's encrypted key). Distinct per
   * agent, so it's stored here rather than on the {@link ProviderAccount}.
   * The value is stored as given — providers that issue it already return it
   * encrypted, so HAL doesn't encrypt it again.
   */
  encryptedKey?: string;
  /**
   * The provider's pathway/agent id for THIS agent (e.g. a Bland Pathway id).
   * Required to dispatch an outbound call from this agent's own pathway when
   * {@link direction} is `"outbound"` — HAL needs to know which pathway to
   * trigger, not just where to dial.
   */
  externalAgentId?: string;
  createdAt: number;
}

/** Whether the agent under test receives calls (inbound) or places them (outbound). */
export type CallDirection = "inbound" | "outbound";

/**
 * A production call brought into HAL for offline analysis: uploaded audio that
 * gets transcribed, or a transcript pasted directly. A judge can then be applied
 * to score it, and it can be assigned to a real agent under test.
 */
export interface ProdCall {
  id: string;
  name: string;
  /** How it entered HAL: transcribed from audio, or a transcript pasted in. */
  source: "upload" | "transcript";
  status: "new" | "transcribing" | "scored" | "error";
  transcript: Transcript;
  /** Assigned real agent under test (a {@link TargetAgent} in "My agents"). */
  targetAgentId?: string;
  /** The judge last applied to score this call. */
  judgeId?: string;
  /** All judges applied in the last scoring pass (e.g. the assigned agent's). */
  judgeIds?: string[];
  verdict?: JudgeVerdict;
  error?: string;
  /** Transcription provider/model used, when transcribed from audio. */
  transcription?: { provider: string; model?: string; durationSec?: number };
  createdAt: number;
}

export type RunStatus = "queued" | "running" | "passed" | "failed" | "errored" | "aborted";

export interface TestResult {
  id: string;
  testCaseId: string;
  status: RunStatus;
  startedAt: number;
  endedAt?: number;
  transcript: Transcript;
  verdict?: JudgeVerdict;
  /** Live assertion outcomes gathered during the call. */
  liveChecks: CheckResult[];
  error?: string;
  /** Provider call id (Twilio SID, room id, etc.). */
  externalCallId?: string;
  /** Computed per-call metrics (attached when the run finishes). */
  metrics?: import("./metrics/metrics.js").CallMetrics;
  /** Human-readable labels derived from the metrics. */
  labels?: import("./metrics/metrics.js").Label[];
  /**
   * Optional free-text label the caller gave this run (e.g. "regression-2026-09-24"),
   * so a batch or ad-hoc run can be found again on the Results page. Distinct from
   * {@link labels}, which are derived pass/fail tags computed from the metrics.
   */
  runLabel?: string;
}

// ---------------------------------------------------------------------------
// Streaming events (surfaced to the UI in real time)
// ---------------------------------------------------------------------------

export type RunEvent =
  | { type: "status"; status: RunStatus; at: number }
  | { type: "utterance"; utterance: Utterance }
  | { type: "live-check"; check: CheckResult }
  | { type: "log"; level: "info" | "warn" | "error"; message: string; at: number }
  | { type: "verdict"; verdict: JudgeVerdict }
  | { type: "done"; result: TestResult };
