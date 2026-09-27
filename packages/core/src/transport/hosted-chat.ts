import type { Target, Utterance } from "../types.js";
import type { CallSession, CallTransport } from "./transport.js";

/** Text sessions against a saved Vapi, Retell, or ElevenLabs agent. */
export class HostedChatTransport implements CallTransport {
  readonly kind = "hosted-chat" as const;
  constructor(private readonly apiKey: string, private readonly fetchImpl: typeof fetch = fetch, private readonly signal?: AbortSignal) {}

  private async request(url: string, body?: unknown): Promise<Record<string, unknown>> {
    const isEleven = url.includes("elevenlabs.io");
    const response = await this.fetchImpl(url, {
      method: body === undefined ? "GET" : "POST",
      headers: { ...(isEleven ? { "xi-api-key": this.apiKey } : { authorization: `Bearer ${this.apiKey}` }), "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: this.signal ? AbortSignal.any([this.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Provider chat request failed (HTTP ${response.status}). Check the account and agent access.`);
    return await response.json() as Record<string, unknown>;
  }

  async connect(target: Target): Promise<CallSession> {
    if (target.transport !== "hosted-chat") throw new Error("A hosted chat target is required");
    if (target.provider === "vapi") return this.vapi(target.externalAgentId, target.resourceKind);
    if (target.provider === "retell") return this.retell(target.externalAgentId);
    return this.elevenlabs(target.externalAgentId);
  }

  private async vapi(agentId: string, resourceKind: "assistant" | "squad" = "assistant"): Promise<CallSession> {
    const created = await this.request("https://api.vapi.ai/session", { [resourceKind === "squad" ? "squadId" : "assistantId"]: agentId });
    const sessionId = typeof created.id === "string" ? created.id : "";
    if (!sessionId) throw new Error("Vapi returned no chat session ID");
    let queued: Utterance | null = null;
    return {
      externalId: sessionId,
      speak: async (text) => {
        const reply = await this.request("https://api.vapi.ai/chat/responses", { sessionId, input: text, stream: false });
        const output = Array.isArray(reply.output) ? reply.output as Array<Record<string, unknown>> : [];
        const lines = output.flatMap((message) => {
          if (message.role !== "assistant" || !Array.isArray(message.content)) return [];
          return (message.content as Array<{ type?: string; text?: string }>).filter((part) => part.type === "output_text" && part.text).map((part) => part.text!);
        });
        queued = lines.length ? { role: "target", text: lines.join("\n"), startedAt: Date.now() } : null;
      },
      listen: async () => { const reply = queued; queued = null; return reply; },
      hangup: async () => { queued = null; },
    };
  }

  private async retell(agentId: string): Promise<CallSession> {
    const created = await this.request("https://api.retellai.com/create-chat", { agent_id: agentId, agent_version: "latest_published" });
    const chatId = typeof created.chat_id === "string" ? created.chat_id : "";
    if (!chatId) throw new Error("Retell returned no chat ID");
    let queued: Utterance | null = null;
    return {
      externalId: chatId,
      speak: async (text) => {
        const reply = await this.request("https://api.retellai.com/create-chat-completion", { chat_id: chatId, content: text });
        const messages = Array.isArray(reply.messages) ? reply.messages as Array<{ role?: string; content?: string }> : [];
        const lines = messages.filter((message) => message.role === "agent" && typeof message.content === "string").map((message) => message.content!);
        queued = lines.length ? { role: "target", text: lines.join("\n"), startedAt: Date.now() } : null;
      },
      listen: async () => { const reply = queued; queued = null; return reply; },
      hangup: async () => { queued = null; },
    };
  }

  private async elevenlabs(agentId: string): Promise<CallSession> {
    const signed = await this.request(`https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`);
    if (typeof signed.signed_url !== "string" || !signed.signed_url.startsWith("wss://")) throw new Error("ElevenLabs returned no signed chat URL");
    const socket = new WebSocket(signed.signed_url);
    const replies: Utterance[] = [];
    let externalId: string | undefined;
    let completed = false;
    let waiter: ((value: Utterance | null) => void) | undefined;
    let failure: Error | undefined;
    const signal = this.signal;
    const abort = () => socket.close();
    signal?.addEventListener("abort", abort, { once: true });
    const opened = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("ElevenLabs chat connection timed out")), 15_000);
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        socket.send(JSON.stringify({ type: "conversation_initiation_client_data", conversation_config_override: { conversation: { text_only: true } } }));
        resolve();
      }, { once: true });
      socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("ElevenLabs chat connection failed")); }, { once: true });
    });
    socket.addEventListener("message", (event) => {
      let data: Record<string, unknown>;
      try { data = JSON.parse(String(event.data)) as Record<string, unknown>; } catch { return; }
      if (data.type === "conversation_initiation_metadata") {
        externalId = (data.conversation_initiation_metadata_event as { conversation_id?: string } | undefined)?.conversation_id;
      }
      if (data.type === "agent_response") {
        const text = (data.agent_response_event as { agent_response?: string } | undefined)?.agent_response;
        if (text) {
          const reply: Utterance = { role: "target", text, startedAt: Date.now() };
          if (waiter) { const done = waiter; waiter = undefined; done(reply); }
          else replies.push(reply);
        }
      }
      if (data.type === "error") failure = new Error("ElevenLabs could not process the text conversation");
    });
    socket.addEventListener("close", () => { completed = true; if (waiter) { const done = waiter; waiter = undefined; done(null); } });
    await opened;
    return {
      get externalId() { return externalId; },
      get completed() { return completed; },
      speak: async (text) => {
        if (failure) throw failure;
        if (socket.readyState !== WebSocket.OPEN) throw new Error("ElevenLabs chat connection closed");
        socket.send(JSON.stringify({ type: "user_message", text }));
      },
      listen: async (opts) => {
        if (replies.length) return replies.shift()!;
        if (failure) throw failure;
        if (completed) return null;
        return new Promise<Utterance | null>((resolve) => {
          const timer = setTimeout(() => { waiter = undefined; resolve(null); }, opts?.timeoutMs ?? 15_000);
          waiter = (reply) => { clearTimeout(timer); resolve(reply); };
        });
      },
      hangup: async () => { signal?.removeEventListener("abort", abort); socket.close(); completed = true; },
    };
  }
}
