import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import {
  SpeechToText,
  TextToSpeech,
  type MediaBridge,
} from "@hal/core";
import { WsAudioBridge, WsAudioBridgeDeps } from "../bridge/ws-audio-bridge.js";
import { RawSocket } from "../bridge/twilio-bridge.js";
import { BridgeRegistry } from "./registry.js";
import { DeepgramSTT } from "../stt/deepgram.js";
import { DeepgramTTS } from "../tts/deepgram.js";

export interface MediaGatewayOptions {
  stt?: SpeechToText;
  tts?: TextToSpeech;
  /** WebSocket path browsers / WHIP egress connect for WebRTC audio. */
  webrtcPath?: string;
  /** WebSocket path a SIP↔WS shim forks RTP audio onto. */
  sipPath?: string;
  /** Default audio encoding/sample rate for connecting clients. */
  audio?: Pick<WsAudioBridgeDeps, "encoding" | "sampleRate">;
}

/**
 * The HAL media gateway: one HTTP + WebSocket server that terminates the
 * vendor-neutral {@link WsAudioBridge} protocol for both the WebRTC and SIP
 * transports, and hands the core engine matching bridge factories.
 *
 * A call places itself first (the transport mints an `externalId` / room), then
 * the media source (browser WebRTC client or SIP↔WS shim) connects a WebSocket
 * carrying `?id=<externalId>`. The gateway correlates the two through a
 * {@link BridgeRegistry}, exactly like the Twilio media server does with Call
 * SIDs — so real WebRTC / SIP calls run through the same conductor + judge as
 * mock and telephony calls.
 */
export class MediaGateway {
  readonly webrtc = new BridgeRegistry();
  readonly sip = new BridgeRegistry();
  private readonly stt: SpeechToText;
  private readonly tts: TextToSpeech;
  private readonly webrtcPath: string;
  private readonly sipPath: string;
  private readonly audio: Pick<WsAudioBridgeDeps, "encoding" | "sampleRate">;
  private httpServer?: http.Server;
  private wss?: WebSocketServer;

  constructor(opts: MediaGatewayOptions = {}) {
    this.stt = opts.stt ?? new DeepgramSTT();
    this.tts = opts.tts ?? new DeepgramTTS();
    this.webrtcPath = opts.webrtcPath ?? "/api/media/webrtc";
    this.sipPath = opts.sipPath ?? "/api/media/sip";
    this.audio = opts.audio ?? {};
  }

  /** Factory to pass to `HalEngine({ webrtc: { bridgeFactory } })`. */
  get webrtcBridgeFactory() {
    return ({ externalId }: { externalId: string }): Promise<MediaBridge> =>
      this.webrtc.claim(externalId);
  }

  /** Factory to pass to `HalEngine({ sip: { bridgeFactory } })`. */
  get sipBridgeFactory() {
    return ({ externalId }: { externalId: string }): Promise<MediaBridge> =>
      this.sip.claim(externalId);
  }

  listen(port = Number(process.env.HAL_MEDIA_PORT ?? 8788)): Promise<void> {
    this.httpServer = http.createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, transports: ["webrtc", "sip"] }));
        return;
      }
      res.writeHead(404);
      res.end("Not found");
    });

    // A single WSS with manual upgrade routing so both paths share the port.
    this.wss = new WebSocketServer({ noServer: true });
    this.httpServer.on("upgrade", (req, socket, head) => {
      const { pathname, searchParams } = new URL(req.url ?? "", "http://localhost");
      const registry =
        pathname === this.webrtcPath ? this.webrtc : pathname === this.sipPath ? this.sip : null;
      if (!registry) {
        socket.destroy();
        return;
      }
      const id = searchParams.get("id") ?? undefined;
      this.wss!.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws, registry, id));
    });

    return new Promise((resolve) => this.httpServer!.listen(port, resolve));
  }

  private onConnection(ws: WebSocket, registry: BridgeRegistry, idFromUrl?: string): void {
    const socket: RawSocket = {
      send: (data) => ws.send(data),
      on: (event, cb) => {
        if (event === "message") ws.on("message", (d) => (cb as (x: unknown) => void)(d.toString()));
        else ws.on("close", cb as () => void);
      },
      close: () => ws.close(),
    };

    const bridge = new WsAudioBridge(socket, { stt: this.stt, tts: this.tts, ...this.audio });
    bridge.onReady(() => {
      // Prefer the id from the `start` frame; fall back to the URL query.
      const key = bridge.id ?? idFromUrl;
      if (key) registry.fulfill(key, bridge);
    });
  }

  async close(): Promise<void> {
    this.webrtc.clear();
    this.sip.clear();
    await new Promise<void>((resolve) => this.wss?.close(() => resolve()));
    await new Promise<void>((resolve) => this.httpServer?.close(() => resolve()));
  }
}
