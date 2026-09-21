import { Target, TransportKind } from "../types.js";

/**
 * Provider templates: one reusable recipe per way of placing a call. A template
 * declares which transport it drives, what configuration the target needs (as a
 * field schema the UI renders), which environment variables must be present to
 * actually run it, and how to turn filled-in config into a concrete `Target`.
 *
 * This is what "a template per provider" means — pick a template, fill its
 * fields, and you have a runnable target without knowing the transport internals.
 */

export type FieldKind = "text" | "tel" | "url" | "textarea";

export interface ProviderField {
  key: string;
  label: string;
  kind?: FieldKind;
  placeholder?: string;
  required?: boolean;
  help?: string;
  /** Default value pre-filled in the UI. */
  default?: string;
}

export interface ProviderTemplate {
  id: string;
  label: string;
  transport: TransportKind;
  description: string;
  /** Fields the user fills to configure the target. */
  fields: ProviderField[];
  /** Env vars that must be set for a real run (empty for mock). */
  requiresEnv: string[];
  /** Build a concrete Target from the collected field values. */
  buildTarget: (name: string, config: Record<string, string>) => Target;
}

export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  {
    id: "mock",
    label: "Mock (in-process)",
    transport: "mock",
    description:
      "Simulated target agent driven by an LLM. No calls, no credentials — ideal for authoring scenarios and CI.",
    requiresEnv: [],
    fields: [
      {
        key: "systemPrompt",
        label: "Target system prompt",
        kind: "textarea",
        required: true,
        placeholder: "You are the receptionist AI for Acme Dental…",
        help: "Describes the voice AI HAL will pretend to be calling.",
      },
      {
        key: "greeting",
        label: "Greeting (spoken first)",
        placeholder: "Thanks for calling Acme, how can I help?",
      },
    ],
    buildTarget: (name, c) => ({
      transport: "mock",
      name,
      mock: { systemPrompt: c.systemPrompt ?? "", greeting: c.greeting || undefined },
    }),
  },
  {
    id: "twilio",
    label: "Twilio (PSTN phone call)",
    transport: "telephony",
    description:
      "Places a real phone call to any number via Twilio. Requires Twilio credentials and a running HAL media server.",
    requiresEnv: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"],
    fields: [
      {
        key: "phoneNumber",
        label: "Target phone number (E.164)",
        kind: "tel",
        required: true,
        placeholder: "+14155550123",
        help: "The number of the voice AI under test. Only test numbers you're authorized to call.",
      },
    ],
    buildTarget: (name, c) => ({
      transport: "telephony",
      name,
      phoneNumber: c.phoneNumber ?? "",
    }),
  },
  {
    id: "webrtc",
    label: "WebRTC (room / signaling)",
    transport: "webrtc",
    description:
      "Joins a WebRTC room or signaling endpoint the target agent is on (LiveKit, Daily, a WHIP/WHEP endpoint, …).",
    requiresEnv: [],
    fields: [
      {
        key: "signalingUrl",
        label: "Signaling URL",
        kind: "url",
        required: true,
        placeholder: "wss://sfu.example.com",
      },
      { key: "room", label: "Room", placeholder: "support-test" },
    ],
    buildTarget: (name, c) => ({
      transport: "webrtc",
      name,
      signalingUrl: c.signalingUrl ?? "",
      room: c.room || undefined,
    }),
  },
  {
    id: "sip",
    label: "SIP (PBX / trunk)",
    transport: "sip",
    description: "Dials a SIP URI directly against your own PBX or SIP trunk.",
    requiresEnv: [],
    fields: [
      {
        key: "uri",
        label: "SIP URI",
        required: true,
        placeholder: "sip:agent@pbx.example.com",
      },
    ],
    buildTarget: (name, c) => ({ transport: "sip", name, uri: c.uri ?? "" }),
  },
];

export function getProviderTemplate(id: string): ProviderTemplate | undefined {
  return PROVIDER_TEMPLATES.find((t) => t.id === id);
}

export interface ProviderAvailability {
  id: string;
  available: boolean;
  missingEnv: string[];
}

/** Report whether each template can actually run given the current environment. */
export function providerAvailability(
  env: Record<string, string | undefined> = process.env,
): ProviderAvailability[] {
  return PROVIDER_TEMPLATES.map((t) => {
    const missingEnv = t.requiresEnv.filter((k) => !env[k]);
    return { id: t.id, available: missingEnv.length === 0, missingEnv };
  });
}
