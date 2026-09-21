import { CallSession, CallTransport, MediaBridge, TransportError } from "./transport.js";
import { Target, Utterance } from "../types.js";

export interface TwilioConfig {
  accountSid?: string;
  authToken?: string;
  fromNumber?: string;
  /** Publicly reachable base URL where Twilio can reach this HAL instance. */
  publicUrl?: string;
}

/**
 * Factory the host supplies to wire a call's media plane (Twilio Media Streams
 * websocket <-> STT/TTS). The transport handles call *control* (placing and
 * ending the PSTN call); the bridge handles *media*.
 */
export type BridgeFactory = (callContext: { externalId: string }) => Promise<MediaBridge>;

/**
 * Places real PSTN calls through Twilio. The audio is bridged by a host-provided
 * MediaBridge, so the same conductor/judge that runs mock calls runs real ones
 * unchanged. Without a bridge factory, HAL can still place the call and observe
 * status but cannot exchange speech — useful for connectivity checks.
 */
export class TelephonyTransport implements CallTransport {
  readonly kind = "telephony" as const;

  constructor(
    private readonly config: TwilioConfig = {},
    private readonly bridgeFactory?: BridgeFactory,
  ) {}

  async connect(target: Target): Promise<CallSession> {
    if (target.transport !== "telephony") {
      throw new TransportError("TelephonyTransport requires a telephony target", this.kind);
    }

    const accountSid = this.config.accountSid ?? process.env.TWILIO_ACCOUNT_SID ?? "";
    const authToken = this.config.authToken ?? process.env.TWILIO_AUTH_TOKEN ?? "";
    const from = this.config.fromNumber ?? process.env.TWILIO_FROM_NUMBER ?? "";
    const publicUrl = this.config.publicUrl ?? process.env.HAL_PUBLIC_URL ?? "";

    if (!accountSid || !authToken || !from) {
      throw new TransportError(
        "Twilio not configured (need TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER)",
        this.kind,
      );
    }

    // TwiML that connects the answered call to HAL's media-stream websocket.
    // The web app hosts /api/media/twilio as the websocket endpoint.
    const streamUrl = publicUrl.replace(/^http/, "ws").replace(/\/$/, "") + "/api/media/twilio";
    const twiml =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Response><Connect><Stream url="${streamUrl}"/></Connect></Response>`;

    const form = new URLSearchParams({
      To: target.phoneNumber,
      From: from,
      Twiml: twiml,
    });

    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`,
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          authorization: "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
        },
        body: form,
      },
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new TransportError(`Twilio call create failed: ${body}`, this.kind);
    }

    const data = (await res.json()) as { sid: string };
    const bridge = this.bridgeFactory
      ? await this.bridgeFactory({ externalId: data.sid })
      : undefined;

    return new BridgedSession(data.sid, "telephony", bridge, async () => {
      // Hang up via Twilio REST.
      await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls/${data.sid}.json`,
        {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            authorization:
              "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
          },
          body: new URLSearchParams({ Status: "completed" }),
        },
      ).catch(() => undefined);
    });
  }
}

/**
 * A CallSession backed by a MediaBridge. Shared by telephony, webrtc, and sip
 * transports — the only difference between them is how the underlying media
 * plane is established, which the bridge encapsulates.
 */
export class BridgedSession implements CallSession {
  private inbound: Utterance[] = [];
  private waiter?: (u: Utterance | null) => void;
  private open = true;

  constructor(
    readonly externalId: string,
    private readonly kind: string,
    private readonly bridge: MediaBridge | undefined,
    private readonly onHangup: () => Promise<void>,
  ) {
    bridge?.onTranscript((utterance) => {
      if (this.waiter) {
        const w = this.waiter;
        this.waiter = undefined;
        w(utterance);
      } else {
        this.inbound.push(utterance);
      }
    });
  }

  async speak(text: string): Promise<void> {
    if (!this.open) return;
    if (!this.bridge) {
      throw new TransportError(
        `No media bridge attached; cannot speak on ${this.kind} call. ` +
          `Provide a BridgeFactory (the web app supplies one).`,
        this.kind as never,
      );
    }
    await this.bridge.sendSpeech(text);
  }

  async listen(opts?: { timeoutMs?: number }): Promise<Utterance | null> {
    if (!this.open) return null;
    const queued = this.inbound.shift();
    if (queued) return queued;
    if (!this.bridge) return null;

    return new Promise<Utterance | null>((resolve) => {
      this.waiter = resolve;
      if (opts?.timeoutMs) {
        setTimeout(() => {
          if (this.waiter === resolve) {
            this.waiter = undefined;
            resolve(null);
          }
        }, opts.timeoutMs);
      }
    });
  }

  async hangup(): Promise<void> {
    if (!this.open) return;
    this.open = false;
    this.waiter?.(null);
    this.waiter = undefined;
    await this.bridge?.close().catch(() => undefined);
    await this.onHangup();
  }
}
