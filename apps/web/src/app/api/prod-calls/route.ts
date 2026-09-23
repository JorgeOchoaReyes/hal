import { NextRequest, NextResponse } from "next/server";
import { id, type ProdCall, type Transcript } from "@hal/core";
import { listProdCalls, upsertProdCall } from "@/lib/store";
import { transcribeAudio, parseTranscript } from "@/lib/transcribe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  return NextResponse.json({ prodCalls: listProdCalls() });
}

/**
 * Create a production call. Two content types:
 *  - multipart/form-data with an audio `file` → transcribed via the configured
 *    provider (Deepgram).
 *  - application/json { name, transcriptText, targetAgentId } → transcript
 *    parsed directly, no transcription needed.
 */
export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      const name = String(form.get("name") ?? "").trim();
      const targetAgentId = (form.get("targetAgentId") as string) || undefined;
      if (!(file instanceof Blob)) {
        return NextResponse.json({ error: "file is required" }, { status: 400 });
      }
      const buf = await file.arrayBuffer();
      const { transcript, durationSec, provider, model } = await transcribeAudio(
        buf,
        file.type || "audio/wav",
      );
      const call: ProdCall = {
        id: id("call"),
        name: name || (file instanceof File ? file.name : "Uploaded call"),
        source: "upload",
        status: "new",
        transcript,
        targetAgentId,
        transcription: { provider, model, durationSec },
        createdAt: Date.now(),
      };
      upsertProdCall(call);
      return NextResponse.json({ prodCall: call }, { status: 201 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      name?: string;
      transcriptText?: string;
      transcript?: Transcript;
      targetAgentId?: string;
    };
    const transcript = body.transcript ?? parseTranscript(body.transcriptText ?? "");
    if (transcript.length === 0) {
      return NextResponse.json({ error: "Provide audio or a non-empty transcript." }, { status: 400 });
    }
    const call: ProdCall = {
      id: id("call"),
      name: body.name?.trim() || "Pasted call",
      source: "transcript",
      status: "new",
      transcript,
      targetAgentId: body.targetAgentId || undefined,
      createdAt: Date.now(),
    };
    upsertProdCall(call);
    return NextResponse.json({ prodCall: call }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
