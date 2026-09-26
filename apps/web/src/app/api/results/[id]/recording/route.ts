import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { getResult, getAccountRaw, saveResult } from "@/lib/store";
import { downloadRunRecording } from "@/lib/runRecordings";
import { recordingPath, audioRange } from "@/lib/recordingFiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getResult(id);
  if (!run?.externalCallId) return NextResponse.json({ error: "No provider call ID was saved for this run." }, { status: 400 });
  if (!run.context?.account && run.recording?.status !== "available") {
    const body = await req.json().catch(() => ({}));
    const account = typeof body.accountId === "string" ? getAccountRaw(body.accountId) : undefined;
    if (!account || account.provider !== "bland") return NextResponse.json({ error: "Select the Bland account that placed this older call." }, { status: 400 });
    saveResult({ ...run, recordingSource: { provider: "bland", accountId: account.id } });
  }
  await downloadRunRecording(id);
  const recording = getResult(id)?.recording;
  return NextResponse.json({ recording, error: recording?.error }, { status: recording?.status === "available" ? 200 : 422 });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getResult(id);
  if (run?.recording?.status !== "available") return new Response("Recording not downloaded", { status: 404 });
  const path = recordingPath(id);
  const file = await stat(path).catch(() => null);
  if (!file) return new Response("Local recording is missing. Download it again from the run page.", { status: 404 });
  const rangeHeader = req.headers.get("range");
  const range = audioRange(rangeHeader, file.size);
  if (!range) return new Response(null, { status: 416, headers: { "content-range": `bytes */${file.size}` } });
  const headers: Record<string, string> = {
    "content-type": run.recording.contentType ?? "audio/mpeg",
    "content-length": String(range.end - range.start + 1),
    "accept-ranges": "bytes", "cache-control": "private, no-store", "x-content-type-options": "nosniff",
  };
  if (rangeHeader) headers["content-range"] = `bytes ${range.start}-${range.end}/${file.size}`;
  if (req.nextUrl.searchParams.has("download")) headers["content-disposition"] = `attachment; filename="recording.${run.recording.contentType?.includes("wav") ? "wav" : "mp3"}"`;
  return new Response(Readable.toWeb(createReadStream(path, range)) as ReadableStream, { status: rangeHeader ? 206 : 200, headers });
}
