import { NextResponse } from "next/server";
import { listIntegrations } from "@hal/core";

export const dynamic = "force-dynamic";

/** The available hosted provider integrations and the credentials they need. */
export async function GET() {
  const integrations = listIntegrations().map((i) => ({
    id: i.id,
    label: i.label,
    credentialFields: i.credentialFields,
  }));
  return NextResponse.json({ integrations });
}
