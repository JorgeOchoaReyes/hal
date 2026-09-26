import { NextRequest, NextResponse } from "next/server";
import { id } from "@hal/core";
import { getAccountRaw, listByotKeys, saveByotKey, deleteByotKey } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get("accountId") ?? "";
  if (getAccountRaw(accountId)?.provider !== "bland") return NextResponse.json({ error: "Select a Bland account" }, { status: 400 });
  return NextResponse.json({ keys: listByotKeys(accountId) });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (typeof body.accountId !== "string" || getAccountRaw(body.accountId)?.provider !== "bland") return NextResponse.json({ error: "Select a Bland account" }, { status: 400 });
  if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 120 || typeof body.encryptedKey !== "string" || !body.encryptedKey.trim() || body.encryptedKey.length > 16384) {
    return NextResponse.json({ error: "Enter a key name (up to 120 characters) and a BYOT encrypted key" }, { status: 400 });
  }
  if (listByotKeys(body.accountId).some((k) => k.name.toLowerCase() === body.name.trim().toLowerCase())) return NextResponse.json({ error: "A key with that name already exists. Choose a different name." }, { status: 409 });
  const key = { id: id("byot"), accountId: body.accountId, name: body.name.trim(), createdAt: Date.now() };
  saveByotKey({ ...key, encryptedKey: body.encryptedKey.trim() });
  return NextResponse.json({ key }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get("accountId") ?? "";
  const keyId = req.nextUrl.searchParams.get("id") ?? "";
  if (!deleteByotKey(accountId, keyId)) return NextResponse.json({ error: "Saved key not found" }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
