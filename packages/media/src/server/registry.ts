import { MediaBridge } from "@hal/core";

interface Pending {
  resolve: (bridge: MediaBridge) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Correlates an outbound call (placed by the telephony transport, keyed by Twilio
 * Call SID) with the inbound Media Streams WebSocket that Twilio opens a moment
 * later. `claim` is awaited by the transport's bridge factory; `fulfill` is
 * called by the media server when the matching stream starts.
 *
 * A stream can also arrive slightly before the REST response is processed, so
 * `fulfill` parks an unclaimed bridge briefly for the imminent `claim`.
 */
export class BridgeRegistry {
  private pending = new Map<string, Pending>();
  private parked = new Map<string, MediaBridge>();

  claim(callSid: string, timeoutMs = 30_000): Promise<MediaBridge> {
    const already = this.parked.get(callSid);
    if (already) {
      this.parked.delete(callSid);
      return Promise.resolve(already);
    }
    return new Promise<MediaBridge>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(callSid);
        reject(new Error(`No media stream for call ${callSid} within ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(callSid, { resolve, reject, timer });
    });
  }

  fulfill(callSid: string, bridge: MediaBridge): void {
    const waiter = this.pending.get(callSid);
    if (waiter) {
      clearTimeout(waiter.timer);
      this.pending.delete(callSid);
      waiter.resolve(bridge);
      return;
    }
    // No claimant yet — park it briefly for an imminent claim.
    this.parked.set(callSid, bridge);
    setTimeout(() => this.parked.delete(callSid), 30_000);
  }

  /** Reject any outstanding claim (e.g. on shutdown). */
  clear(): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error("Media server shutting down"));
    }
    this.pending.clear();
    this.parked.clear();
  }
}
