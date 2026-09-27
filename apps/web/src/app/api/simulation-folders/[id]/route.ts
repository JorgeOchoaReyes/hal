import { NextRequest, NextResponse } from "next/server";
import { deleteSimulationFolder, getSimulationFolder, listSimulationFolders, saveSimulationFolder } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null) as { name?: unknown } | null;
  const existing = getSimulationFolder(id);
  if (!existing) return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 80) return NextResponse.json({ error: "Folder name must be 1–80 characters" }, { status: 400 });
  if (listSimulationFolders().some((folder) => folder.id !== id && folder.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    return NextResponse.json({ error: "A folder with this name already exists" }, { status: 409 });
  }
  const folder = { ...existing, name };
  saveSimulationFolder(folder);
  return NextResponse.json({ folder });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const deleted = deleteSimulationFolder(id);
  return NextResponse.json({ deleted }, { status: deleted ? 200 : 404 });
}
