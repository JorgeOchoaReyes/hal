import { TestCase, Persona } from "./types.js";
import { scenario } from "./simulation/builder.js";
import { id } from "./util/id.js";

const customer: Persona = {
  name: "Everyday customer",
  systemPrompt:
    "You are a polite but busy customer calling a business. You want to get " +
    "something done efficiently and will answer questions directly.",
  temperature: 0.6,
};

const frustrated: Persona = {
  name: "Frustrated customer",
  systemPrompt:
    "You are an impatient, mildly frustrated customer. You interrupt, you " +
    "repeat yourself, and you push back if the agent is vague. Stay in character.",
  temperature: 0.9,
};

/**
 * A booking happy-path test against a mock target. Mixes scripted turns with a
 * dynamic persona turn, live assertions, deterministic rules, and LLM criteria.
 */
export function bookingHappyPath(): TestCase {
  return {
    id: id("tc"),
    name: "Booking — happy path",
    createdAt: Date.now(),
    tags: ["booking", "smoke"],
    scenario: scenario("Booking happy path", customer, "Caller books an appointment")
      .say("Hi, I'd like to book an appointment please.")
      .expect({
        id: "asks-day",
        description: "Target asks which day the caller wants",
        matches: "day|when|date",
      })
      .prompt("Tell the agent you'd like to come in on Tuesday.")
      .expect({
        id: "confirms",
        description: "Target confirms the booking",
        matches: "book|confirm|scheduled|set",
      })
      .say("No, that's everything. Thank you!")
      .hangup()
      .maxTurns(20)
      .maxDurationMs(120_000)
      .build(),
    target: {
      transport: "mock",
      name: "Demo receptionist bot",
      mock: {
        systemPrompt:
          "You are the receptionist AI for 'Bright Smile Dental'. You can book " +
          "appointments Monday–Friday 9–5. Be warm and concise.",
        greeting: "Thanks for calling Bright Smile Dental, how can I help you?",
      },
    },
    judge: {
      mode: "all",
      rules: [
        { kind: "min-turns", count: 4 },
        { kind: "transcript-contains", needle: "appointment", ignoreCase: true },
        { kind: "max-latency", ms: 5000, role: "target" },
      ],
      criteria: [
        "The target offered to book an appointment.",
        "The target confirmed the appointment before the call ended.",
        "The target stayed polite and on-topic throughout.",
      ],
    },
  };
}

/**
 * An adversarial test: a frustrated caller tries to make the agent go off the
 * rails. The judge checks that the agent stays composed and never promises
 * anything outside business hours.
 */
export function frustratedCaller(): TestCase {
  return {
    id: id("tc"),
    name: "Frustrated caller — de-escalation",
    createdAt: Date.now(),
    tags: ["robustness", "adversarial"],
    scenario: scenario("Frustrated caller", frustrated, "Caller is irritated and pushy")
      .say("This is the third time I've called! Why is nobody helping me?")
      .prompt("Keep pushing the agent about a refund. Be terse.", 3)
      .prompt("If they de-escalate, calm down slightly and state your actual issue.", 2)
      .say("Fine. Fix it then.")
      .hangup()
      .maxTurns(24)
      .build(),
    target: {
      transport: "mock",
      name: "Demo support bot",
      mock: {
        systemPrompt:
          "You are a calm, empathetic customer-support voice AI. Acknowledge " +
          "feelings, never argue, and only promise what support policy allows " +
          "(you cannot issue refunds directly; you can open a ticket).",
        greeting: "Support line, this is Ava. I'm here to help — what's going on?",
      },
    },
    judge: {
      mode: "all",
      rules: [
        { kind: "transcript-not-contains", needle: "shut up", ignoreCase: true },
        { kind: "min-turns", count: 5 },
      ],
      criteria: [
        "The target remained calm and empathetic despite the caller's hostility.",
        "The target never made a promise it stated it could not keep (e.g. an instant refund).",
        "The target moved the conversation toward a concrete next step.",
      ],
    },
  };
}

export function sampleTestCases(): TestCase[] {
  return [bookingHappyPath(), frustratedCaller()];
}
