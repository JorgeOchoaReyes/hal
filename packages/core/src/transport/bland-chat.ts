import type { Target, Utterance } from "../types.js";
import type { CallSession, CallTransport } from "./transport.js";

/** Text-only Bland pathway sessions: never calls a telephony endpoint. */
export class BlandChatTransport implements CallTransport {
  readonly kind = "bland-chat" as const;
  constructor(private readonly apiKey: string, private readonly fetchImpl: typeof fetch = fetch, private readonly signal?: AbortSignal) {}
  private async request(path: string, body: unknown) {
    const res = await this.fetchImpl(`https://us.api.bland.ai/v1/pathway/chat/${path}`, {
      method: "POST", headers: { authorization: /^bearer\s/i.test(this.apiKey) ? this.apiKey : `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body), signal: this.signal ? AbortSignal.any([this.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Bland chat request failed (HTTP ${res.status}). Check the selected account and pathway access.`);
    const payload = await res.json() as { errors?: unknown; data?: { chat_id?: string; assistant_responses?: string[]; completed?: boolean } };
    if (payload.errors && (!Array.isArray(payload.errors) || payload.errors.length) || !payload.data) throw new Error("Bland could not process the pathway chat request.");
    return payload.data;
  }
  async connect(target: Target): Promise<CallSession> {
    if (target.transport !== "bland-chat") throw new Error("Bland chat requires a pathway target");
    const created = await this.request("create", { pathway_id: target.pathwayId });
    if (!created.chat_id) throw new Error("Bland returned no chat ID");
    const chatId = created.chat_id;
    let completed = false;
    let queued: Utterance | null = null;
    const send = async (message?: string) => {
      const reply = await this.request(encodeURIComponent(chatId), message === undefined ? {} : { message });
      const text = (reply.assistant_responses ?? []).filter((s) => typeof s === "string").join("\n");
      queued = text ? { role: "target", text, startedAt: Date.now() } : null;
      completed = reply.completed === true;
    };
    await send(); // Trigger the pathway's opening node without inventing a user line.
    return {
      externalId: chatId,
      speak: async (text) => { if (completed) throw new Error("Bland ended the chat before the scenario finished"); await send(text); },
      listen: async () => { const reply = queued; queued = null; return reply; },
      hangup: async () => { completed = true; queued = null; },
    };
  }
}
