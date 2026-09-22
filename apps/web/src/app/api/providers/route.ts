import { NextResponse } from "next/server";
import { PROVIDER_TEMPLATES } from "@hal/core";
import { providers } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Serializable view of the provider templates (the `buildTarget` function is
 * dropped) merged with runtime availability, so the UI can render one form per
 * provider and warn when credentials are missing.
 */
export async function GET() {
  const availability = providers();
  const templates = PROVIDER_TEMPLATES.map((t) => {
    const a = availability.find((x) => x.id === t.id);
    return {
      id: t.id,
      label: t.label,
      transport: t.transport,
      description: t.description,
      fields: t.fields,
      requiresEnv: t.requiresEnv,
      available: a?.available ?? true,
      missingEnv: a?.missingEnv ?? [],
    };
  });
  return NextResponse.json({ providers: templates });
}
