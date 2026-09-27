import { NextRequest, NextResponse } from "next/server";
import { id } from "@hal/core";
import { listSimulationFolders, saveSimulationFolder } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ folders: listSimulationFolders() });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 80) return NextResponse.json({ error: "Folder name must be 1–80 characters" }, { status: 400 });
  if (listSimulationFolders().some((folder) => folder.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    return NextResponse.json({ error: "A folder with this name already exists" }, { status: 409 });
  }
  const folder = { id: id("folder"), name, createdAt: Date.now() };
  saveSimulationFolder(folder);
  return NextResponse.json({ folder }, { status: 201 });
}
