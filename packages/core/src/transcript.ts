import type { Role, Transcript, Utterance } from "./types.js";

// Speaker labels that map to a role. The CALLER (human placing the call) is the
// `agent` in HAL's model — the side a simulation's tester replays; the voice AI
// under test is the `target`.
const CALLER_LABELS = new Set(["agent", "caller", "customer", "user", "tester", "me", "human"]);
const TARGET_LABELS = new Set(["target", "ai", "bot", "assistant", "ivr", "agent under test"]);

/**
 * Parse a pasted transcript into utterances. A line may be prefixed with a
 * speaker label (`agent:`, `target:`, `system:`, `caller -`, …); only a
 * RECOGNIZED label is stripped — an unrecognized `Word:`/`Word -` prefix (e.g.
 * "Okay: let me check", "Note - hung up") is kept as part of the text, not
 * silently dropped. Unlabeled lines alternate speakers, caller (`agent`) first.
 */
export function parseTranscript(text: string): Transcript {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const base = Date.now();
  let alt: "agent" | "target" = "agent";
  const out: Utterance[] = [];
  lines.forEach((line, i) => {
    // Require non-empty content after the delimiter, so a bare "Note -" stays literal.
    const m = line.match(/^([A-Za-z ]{1,20}?)\s*[:-]\s*(.+)$/);
    let role: Role = alt;
    let content = line;
    if (m) {
      const label = (m[1] ?? "").toLowerCase().trim();
      const rest = m[2] ?? line;
      if (CALLER_LABELS.has(label)) {
        role = "agent";
        content = rest;
      } else if (TARGET_LABELS.has(label)) {
        role = "target";
        content = rest;
      } else if (label === "system") {
        role = "system";
        content = rest;
      } else {
        // Unrecognized prefix — not a speaker label; keep the whole line.
        role = alt;
        content = line;
      }
    }
    // System asides don't consume a turn in the caller/target alternation.
    if (role !== "system") alt = role === "agent" ? "target" : "agent";
    const trimmed = content.trim();
    if (trimmed) out.push({ role, text: trimmed, startedAt: base + i * 1000 });
  });
  return out;
}

/**
 * The CALLER's turns from a transcript, as the tester's linear script — used to
 * turn a real call into a simulation. The target/AI turns are dropped since
 * that's what the agent under test must produce.
 */
export function transcriptToSayScript(t: Transcript): Array<{ kind: "say"; text: string }> {
  return t.filter((u) => u.role === "agent" && u.text.trim()).map((u) => ({ kind: "say", text: u.text.trim() }));
}
