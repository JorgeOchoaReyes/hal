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
  | { kind: "expect"; assertion: LiveAssertion };

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
  steps: ScenarioStep[];
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
  createdAt?: number;
  tags?: string[];
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
