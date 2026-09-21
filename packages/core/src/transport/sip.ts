import { CallTransport, CallSession, MediaBridge, TransportError } from "./transport.js";
import { BridgedSession } from "./telephony.js";
import { Target } from "../types.js";
import { id } from "../util/id.js";

export type SipBridgeFactory = (ctx: {
  externalId: string;
  uri: string;
}) => Promise<MediaBridge>;

/**
 * Places SIP calls directly against a PBX / SIP trunk (e.g. Asterisk, FreeSWITCH,
 * a carrier trunk) without going through a hosted telephony API. Useful for
 * self-hosted deployments that already own SIP infrastructure. The SIP stack and
 * RTP media are provided by a host MediaBridge.
 */
export class SipTransport implements CallTransport {
  readonly kind = "sip" as const;

  constructor(private readonly bridgeFactory?: SipBridgeFactory) {}

  async connect(target: Target): Promise<CallSession> {
    if (target.transport !== "sip") {
      throw new TransportError("SipTransport requires a sip target", this.kind);
    }
    const externalId = id("sip");

    if (!this.bridgeFactory) {
      throw new TransportError(
        "No SIP bridge configured. Supply a SipBridgeFactory backed by a SIP/RTP " +
          "stack (e.g. drachtio + rtpengine, or FreeSWITCH ESL).",
        this.kind,
      );
    }

    const bridge = await this.bridgeFactory({ externalId, uri: target.uri });
    return new BridgedSession(externalId, "sip", bridge, async () => {
      /* teardown handled by bridge.close() */
    });
  }
}
