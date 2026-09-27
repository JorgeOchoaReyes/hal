import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function getRoute(path: string, store: Record<string, unknown>) {
  const source = readFileSync(new URL(`../../app/api/${path}/route.ts`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = { exports: {} as { GET: (req: unknown) => Promise<Response> }, require: (name: string) => {
    if (name === "next/server") return { NextResponse: Response };
    if (name === "@/lib/store") return store;
    if (name === "@hal/core") return {};
    throw new Error(`Unexpected import: ${name}`);
  } };
  runInNewContext(compiled, context);
  return async (reveal: boolean) => context.exports.GET({ nextUrl: { searchParams: new URLSearchParams(reveal ? "reveal=1" : "") } });
}

test("credential APIs reveal saved values only when requested and disable caching", async () => {
  const cases: Array<{ path: string; store: Record<string, unknown>; key: string; secretPath: (body: Record<string, unknown>) => unknown }> = [
    { path: "settings/secrets", store: { getSecretsStatus: () => [], getStoredSecretValues: () => ({ OPENAI_API_KEY: "saved-key" }) }, key: "values", secretPath: (body) => (body.values as Record<string, string>)?.OPENAI_API_KEY },
    { path: "settings/transcription", store: { getTranscriptionSettings: () => ({ provider: "deepgram", hasKey: true }), getTranscriptionSettingsRaw: () => ({ apiKey: "saved-key" }) }, key: "apiKey", secretPath: (body) => body.apiKey },
    { path: "provider-accounts", store: { listAccounts: () => [{ id: "a", credentials: { apiKey: "••••••" } }], getAccountRaw: () => ({ id: "a", credentials: { apiKey: "saved-key" } }) }, key: "accounts", secretPath: (body) => ((body.accounts as Array<{ credentials: { apiKey: string } }>)[0])?.credentials.apiKey },
    { path: "byot-keys", store: { getAccountRaw: () => ({ provider: "bland" }), listByotKeys: () => [{ id: "k", name: "BYOT" }], resolveByotKey: () => "saved-key" }, key: "keys", secretPath: (body) => ((body.keys as Array<{ encryptedKey?: string }>)[0])?.encryptedKey },
    { path: "targets", store: { listTargets: () => [{ id: "t" }], getTarget: () => ({ id: "t", encryptedKey: "saved-key" }) }, key: "targets", secretPath: (body) => ((body.targets as Array<{ encryptedKey?: string }>)[0])?.encryptedKey },
    { path: "testing-agents", store: { listAgents: () => [{ id: "a" }], getAgent: () => ({ id: "a", encryptedKey: "saved-key" }) }, key: "agents", secretPath: (body) => ((body.agents as Array<{ encryptedKey?: string }>)[0])?.encryptedKey },
  ];
  for (const item of cases) {
    const route = getRoute(item.path, item.store);
    const hidden = await route(false);
    const shown = await route(true);
    assert.equal(hidden.headers.get("cache-control"), "no-store", item.path);
    assert.equal(shown.headers.get("cache-control"), "no-store", item.path);
    assert.notEqual(item.secretPath(await hidden.json()), "saved-key", `${item.path} hidden`);
    assert.equal(item.secretPath(await shown.json()), "saved-key", `${item.path} shown`);
  }
});
