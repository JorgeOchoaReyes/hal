import { CallTransport, CallSession, MediaBridge, TransportError } from "./transport.js";
import { BridgedSession } from "./telephony.js";
import { Target } from "../types.js";
import { id } from "../util/id.js";

export type WebRTCBridgeFactory = (ctx: {
  externalId: string;
  signalingUrl: string;
  room: string;
}) => Promise<MediaBridge>;

/**
 * Places WebRTC calls. The testing agent joins a room / signaling endpoint that
 * the target voice AI is (or will be) connected to, then exchanges audio over a
 * host-provided MediaBridge. Signaling specifics (LiveKit, Daily, raw SFU, a
 * custom WHIP/WHEP endpoint) live in the bridge implementation so the transport
 * stays vendor-neutral.
 */
export class WebRTCTransport implements CallTransport {
  readonly kind = "webrtc" as const;

  constructor(private readonly bridgeFactory?: WebRTCBridgeFactory) {}

  async connect(target: Target): Promise<CallSession> {
    if (target.transport !== "webrtc") {
      throw new TransportError("WebRTCTransport requires a webrtc target", this.kind);
    }
    const externalId = id("rtc");
    const room = target.room ?? externalId;

    if (!this.bridgeFactory) {
      throw new TransportError(
        "No WebRTC bridge configured. Supply a WebRTCBridgeFactory (the web app " +
          "provides one backed by its signaling server).",
        this.kind,
      );
    }

    const bridge = await this.bridgeFactory({
      externalId,
      signalingUrl: target.signalingUrl,
      room,
    });

    return new BridgedSession(externalId, "webrtc", bridge, async () => {
      /* room teardown handled by bridge.close() */
    });
  }
}
