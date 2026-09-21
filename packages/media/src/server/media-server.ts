import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { SpeechToText, TextToSpeech, type BridgeFactory } from "@hal/core";
import { TwilioMediaBridge, RawSocket } from "../bridge/twilio-bridge.js";
import { BridgeRegistry } from "./registry.js";
import { DeepgramSTT } from "../stt/deepgram.js";
import { DeepgramTTS } from "../tts/deepgram.js";

export interface MediaServerOptions {
  /** Public base URL of this media server, used to build the μ-law stream URL. */
  publicUrl?: string;
  stt?: SpeechToText;
  tts?: TextToSpeech;
  /** Path Twilio connects its Media Stream to. */
  streamPath?: string;
  /** Path serving the TwiML that starts the stream. */
  twimlPath?: string;
}

/**
 * The HAL media server: a small HTTP + WebSocket server that terminates Twilio
 * Media Streams and bridges them to STT/TTS. It exposes a `BridgeFactory` you
 * hand to the core `HalEngine`'s telephony transport — after that, real phone
 * calls run through the exact same conductor + judge pipeline as mock calls.
 */
export class MediaServer {
  readonly registry = new BridgeRegistry();
  private readonly stt: SpeechToText;
  private readonly tts: TextToSpeech;
  private readonly streamPath: string;
  private readonly twimlPath: string;
  private readonly publicUrl: string;
  private httpServer?: http.Server;
  private wss?: WebSocketServer;

  constructor(opts: MediaServerOptions = {}) {
    this.stt = opts.stt ?? new DeepgramSTT();
    this.tts = opts.tts ?? new DeepgramTTS();
    this.streamPath = opts.streamPath ?? "/api/media/twilio";
    this.twimlPath = opts.twimlPath ?? "/api/media/twiml";
    this.publicUrl = (opts.publicUrl ?? process.env.HAL_PUBLIC_URL ?? "http://localhost:8787").replace(
      /\/$/,
      "",
    );
  }

  /** The factory to pass to `HalEngine({ telephony: { bridgeFactory } })`. */
  get bridgeFactory(): BridgeFactory {
    return ({ externalId }) => this.registry.claim(externalId);
  }

  /** TwiML that connects an answered call to this server's stream endpoint. */
  twiml(): string {
    const wsUrl = this.publicUrl.replace(/^http/, "ws") + this.streamPath;
    return (
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Response><Connect><Stream url="${wsUrl}"/></Connect></Response>`
    );
  }

  listen(port = Number(process.env.HAL_MEDIA_PORT ?? 8787)): Promise<void> {
    this.httpServer = http.createServer((req, res) => {
      if (req.url?.split("?")[0] === this.twimlPath) {
        res.writeHead(200, { "content-type": "text/xml" });
        res.end(this.twiml());
        return;
      }
      if (req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(404);
      res.end("Not found");
    });

    this.wss = new WebSocketServer({ server: this.httpServer, path: this.streamPath });
    this.wss.on("connection", (ws) => this.onConnection(ws));

    return new Promise((resolve) => this.httpServer!.listen(port, resolve));
  }

  private onConnection(ws: WebSocket): void {
    const socket: RawSocket = {
      send: (data) => ws.send(data),
      on: (event, cb) => {
        if (event === "message") ws.on("message", (d) => (cb as (x: unknown) => void)(d.toString()));
        else ws.on("close", cb as () => void);
      },
      close: () => ws.close(),
    };

    const bridge = new TwilioMediaBridge(socket, { stt: this.stt, tts: this.tts });
    bridge.onReady(() => {
      if (bridge.callSid) this.registry.fulfill(bridge.callSid, bridge);
    });
  }

  async close(): Promise<void> {
    this.registry.clear();
    await new Promise<void>((resolve) => this.wss?.close(() => resolve()));
    await new Promise<void>((resolve) => this.httpServer?.close(() => resolve()));
  }
}
