import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";

export function recordingPath(runId: string): string {
  const key = createHash("sha256").update(runId).digest("hex");
  return join(process.env.HAL_DATA_DIR ?? join(process.cwd(), "data"), "recordings", `${key}.audio`);
}

/** Atomic, bounded download: no partial files can be played after interruption. */
export async function persistRecording(runId: string, response: Response, maxBytes = 100 * 1024 * 1024) {
  const contentType = response.headers.get("content-type")?.split(";")[0]?.toLowerCase() ?? "";
  if (!response.ok || !["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave"].includes(contentType)) {
    await response.body?.cancel();
    throw new Error(response.status === 401 || response.status === 403
      ? "Bland denied recording access. Check the provider account for this run."
      : "Bland has not returned an audio recording. It may still be processing, or recording was disabled. Retry later.");
  }
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    throw new Error("Recording exceeds the 100 MB local download limit.");
  }
  if (!response.body) throw new Error("Bland returned an empty recording.");
  const dest = recordingPath(runId);
  await mkdir(join(dest, ".."), { recursive: true });
  const temp = `${dest}.${randomUUID()}.part`;
  const file = await open(temp, "wx", 0o600);
  const reader = response.body.getReader();
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error("Recording exceeds the 100 MB local download limit.");
      await file.writeFile(value);
    }
    if (!bytes) throw new Error("Bland returned an empty recording.");
    await file.close();
    await rename(temp, dest);
    return { status: "available" as const, contentType, bytes, downloadedAt: Date.now() };
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    await file.close().catch(() => undefined);
    await rm(temp, { force: true });
    throw error;
  } finally { reader.releaseLock(); }
}

/** A single byte range, including suffix/open-ended ranges for audio seeking. */
export function audioRange(header: string | null, size: number): { start: number; end: number } | null {
  if (!header) return { start: 0, end: size - 1 };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start <= end && start < size ? { start, end } : null;
}
