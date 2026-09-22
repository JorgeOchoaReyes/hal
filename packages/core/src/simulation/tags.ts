/**
 * Structured-test action tags (Cekura "Supported Tags").
 *
 * A fixed-message `action` can embed control tags that shape delivery and flow.
 * This module parses an action into typed segments, validates the supported tag
 * set and their placement rules, and renders an action to spoken text plus the
 * control effects HAL's text/mock engine can honor (delays, endcall, DTMF, …).
 *
 * Deliberately NOT ported (per scope): custom `functions` / `<function>`,
 * attached `<audio>`, `<client_message>` (RTVI), and `<network_simulation>`.
 * Those are platform/runtime features; using them is flagged as unsupported so
 * authors get a clear error rather than a silently ignored tag.
 */

export interface TagSegment {
  kind: "tag";
  name: string;
  attrs: Record<string, string>;
  /** Inner segments for wrapping tags (spell, voice block, background_noise, …). */
  inner: ActionSegment[];
  selfClosing: boolean;
}
export interface TextSegment {
  kind: "text";
  text: string;
}
export type ActionSegment = TextSegment | TagSegment;

interface TagSpec {
  /** Has an opening/closing form with inner content. */
  wrapping?: boolean;
  /** Must be the entire action (no other text or sibling tags). */
  wholeAction?: boolean;
  /** Must appear at the very start of the action. */
  startOnly?: boolean;
  /** Only valid on action_followup conditions. */
  followupOnly?: boolean;
  required?: string[];
  /** Extra attribute validation; return an error string or null. */
  validate?: (attrs: Record<string, string>) => string | null;
}

export const SUPPORTED_TAGS: Record<string, TagSpec> = {
  // Communication
  ivr: { wholeAction: true, required: ["text"] },
  ignore_interruptions: { wrapping: true },
  voicemail: { wholeAction: true },
  endcall: {},
  // Speech control
  silence: { required: ["time"], validate: timeAttr("time") },
  hold: { required: ["time"], validate: timeAttr("time") },
  spell: { wrapping: true },
  speed: { startOnly: true, required: ["ratio"], validate: ratioAttr("ratio", 0.8, 1.2) },
  volume: { startOnly: true, required: ["ratio"], validate: ratioAttr("ratio", 0, 2) },
  voice: { wrapping: true, required: ["provider", "id"], validate: voiceAttrs },
  // Interaction
  dtmf: { required: ["digits"] },
  send_sms: { required: ["text"] },
  interruption: { startOnly: true, followupOnly: true, required: ["time"], validate: timeAttr("time") },
  // Environmental
  background_noise: { wrapping: true, required: ["sound"] },
  noise: { required: ["sound"] },
};

/** Tags we intentionally do not support in HAL. */
const UNSUPPORTED_TAGS = new Set(["function", "audio", "client_message", "network_simulation"]);

function timeAttr(key: string) {
  return (a: Record<string, string>) =>
    /^\d+(\.\d+)?s$/.test(a[key] ?? "") ? null : `${key} must look like "2s" or "1.5s"`;
}
function ratioAttr(key: string, min: number, max: number) {
  return (a: Record<string, string>) => {
    const n = Number(a[key]);
    if (Number.isNaN(n)) return `${key} must be a number`;
    return n >= min && n <= max ? null : `${key} must be between ${min} and ${max}`;
  };
}
function voiceAttrs(a: Record<string, string>): string | null {
  if (a.provider !== "cartesia" && a.provider !== "11labs")
    return 'voice provider must be "cartesia" or "11labs"';
  return null;
}

// --- Tokenizer / parser ------------------------------------------------------

type Token =
  | { t: "text"; value: string }
  | { t: "open"; name: string; attrs: Record<string, string> }
  | { t: "close"; name: string }
  | { t: "self"; name: string; attrs: Record<string, string> };

const TAG_RE = /<\s*(\/?)\s*([a-z_]+)((?:\s+[a-z_]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)\s*>/gi;
const ATTR_RE = /([a-z_]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  let m: RegExpExecArray | null;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(raw))) attrs[m[1]!.toLowerCase()] = m[2] ?? m[3] ?? "";
  return attrs;
}

function tokenize(action: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(action))) {
    if (m.index > last) tokens.push({ t: "text", value: action.slice(last, m.index) });
    const closing = m[1] === "/";
    const name = m[2]!.toLowerCase();
    const selfClose = m[4] === "/";
    if (closing) tokens.push({ t: "close", name });
    else if (selfClose) tokens.push({ t: "self", name, attrs: parseAttrs(m[3] ?? "") });
    else tokens.push({ t: "open", name, attrs: parseAttrs(m[3] ?? "") });
    last = TAG_RE.lastIndex;
  }
  if (last < action.length) tokens.push({ t: "text", value: action.slice(last) });
  return tokens;
}

export interface ParseResult {
  segments: ActionSegment[];
  errors: string[];
}

/** Parse an action string into a segment tree, collecting structural errors. */
export function parseAction(action: string): ParseResult {
  const tokens = tokenize(action);
  const errors: string[] = [];
  const root: ActionSegment[] = [];
  const stack: TagSegment[] = [];
  const top = () => (stack.length ? stack[stack.length - 1]!.inner : root);

  for (const tok of tokens) {
    if (tok.t === "text") {
      if (tok.value.trim()) top().push({ kind: "text", text: tok.value });
      continue;
    }
    const name = "name" in tok ? tok.name : "";
    if (UNSUPPORTED_TAGS.has(name)) {
      errors.push(`<${name}> is not supported in HAL`);
      continue;
    }
    if (tok.t === "close") {
      const open = stack.pop();
      if (!open || open.name !== name) errors.push(`mismatched closing tag </${name}>`);
      continue;
    }
    const spec = SUPPORTED_TAGS[name];
    if (!spec) {
      errors.push(`unknown tag <${name}>`);
      continue;
    }
    const seg: TagSegment = { kind: "tag", name, attrs: tok.attrs, inner: [], selfClosing: tok.t === "self" };
    top().push(seg);
    if (tok.t === "open") {
      if (!spec.wrapping) errors.push(`<${name}> must be self-closing`);
      else stack.push(seg);
    }
  }
  if (stack.length) errors.push(`unclosed tag <${stack[stack.length - 1]!.name}>`);
  return { segments: root, errors };
}

/**
 * Validate an action's tags against the supported set and placement rules.
 * `isFollowup` enables action_followup-only tags (interruption).
 */
export function validateActionTags(action: string, opts: { isFollowup: boolean }): string[] {
  const { segments, errors } = parseAction(action);
  const out = [...errors];

  const tagSegs = segments.filter((s): s is TagSegment => s.kind === "tag");
  const hasText = segments.some((s) => s.kind === "text");

  const walk = (segs: ActionSegment[]) => {
    for (const s of segs) {
      if (s.kind !== "tag") continue;
      const spec = SUPPORTED_TAGS[s.name]!;
      for (const req of spec.required ?? []) {
        if (!(req in s.attrs)) out.push(`<${s.name}> requires the "${req}" attribute`);
      }
      const extra = spec.validate?.(s.attrs);
      if (extra) out.push(`<${s.name}>: ${extra}`);
      if (spec.followupOnly && !opts.isFollowup)
        out.push(`<${s.name}> is only allowed on an action_followup condition`);
      walk(s.inner);
    }
  };
  walk(segments);

  // whole-action tags: the only segment and nothing else.
  for (const s of tagSegs) {
    const spec = SUPPORTED_TAGS[s.name]!;
    if (spec.wholeAction && (segments.length > 1 || hasText)) {
      out.push(`<${s.name}> must be the entire action`);
    }
  }
  // start-only tags: must be the first segment.
  segments.forEach((s, i) => {
    if (s.kind === "tag" && SUPPORTED_TAGS[s.name]?.startOnly && i !== 0) {
      out.push(`<${s.name}> must be at the start of the action`);
    }
  });

  return out;
}

export interface RenderedAction {
  /** Spoken text after applying text-mode tag semantics. */
  text: string;
  endCall: boolean;
  /** Sum of <silence>/<hold> durations, in ms (applied as a pre-speak delay). */
  delayMs: number;
  /** Human-readable non-verbal effects, e.g. "dtmf:123", for transcript meta. */
  effects: string[];
}

/**
 * Render an action to spoken text + control effects for the text/mock engine.
 * Audio-only tags (ivr/voicemail spoken text is kept; voice/speed/volume/
 * background_noise/noise/send_sms/interruption become effect notes) do not
 * produce audio here but are represented so the transcript stays faithful and
 * hosted providers can render them later.
 */
export function renderAction(action: string): RenderedAction {
  const { segments } = parseAction(action);
  const out: RenderedAction = { text: "", endCall: false, delayMs: 0, effects: [] };
  const parts: string[] = [];

  const walk = (segs: ActionSegment[]) => {
    for (const s of segs) {
      if (s.kind === "text") {
        parts.push(s.text.trim());
        continue;
      }
      switch (s.name) {
        case "endcall":
          out.endCall = true;
          break;
        case "silence":
        case "hold":
          out.delayMs += parseSeconds(s.attrs.time) * 1000;
          walk(s.inner);
          break;
        case "spell":
          parts.push(spellOut(innerText(s)));
          break;
        case "ivr":
        case "voicemail":
          if (s.attrs.text) parts.push(s.attrs.text.trim());
          else if (s.name === "voicemail") out.effects.push("voicemail-beep");
          break;
        case "dtmf":
          out.effects.push(`dtmf:${s.attrs.digits ?? ""}`);
          parts.push(`[pressed ${s.attrs.digits ?? ""}]`);
          break;
        case "send_sms":
          out.effects.push(`sms:${s.attrs.text ?? ""}`);
          break;
        case "voice":
          out.effects.push(`voice:${s.attrs.provider}/${s.attrs.id}`);
          walk(s.inner); // regional voice: speak inner text
          break;
        case "background_noise":
          out.effects.push(`background:${s.attrs.sound ?? ""}`);
          walk(s.inner);
          break;
        case "noise":
          out.effects.push(`noise:${s.attrs.sound ?? ""}`);
          break;
        case "speed":
          out.effects.push(`speed:${s.attrs.ratio ?? ""}`);
          break;
        case "volume":
          out.effects.push(`volume:${s.attrs.ratio ?? ""}`);
          break;
        case "interruption":
          out.effects.push(`interruption:${s.attrs.time ?? ""}`);
          break;
        case "ignore_interruptions":
          walk(s.inner);
          break;
        default:
          walk(s.inner);
      }
    }
  };
  walk(segments);

  out.text = parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  return out;
}

function innerText(seg: TagSegment): string {
  return seg.inner
    .map((s) => (s.kind === "text" ? s.text : s.kind === "tag" ? innerText(s) : ""))
    .join("");
}
function spellOut(s: string): string {
  return s.trim().split("").filter((c) => c.trim()).join(" ");
}
function parseSeconds(v?: string): number {
  const n = Number((v ?? "").replace(/s$/i, ""));
  return Number.isNaN(n) ? 0 : n;
}
