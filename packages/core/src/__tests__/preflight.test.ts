import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VapiIntegration,
  ElevenLabsIntegration,
  BlandIntegration,
  RetellIntegration,
  withTimeout,
  type ProviderAccount,
} from "../index.js";

function fakeStatus(status: number, body = ""): typeof fetch {
  return (async () => new Response(body, { status })) as unknown as typeof fetch;
}

const account: ProviderAccount = {
  id: "a",
  provider: "x",
  label: "L",
  credentials: { apiKey: "k", from: "+1", phoneNumberId: "pn" },
  createdAt: 0,
};

test("verifyCredentials returns ok on 200 for every provider", async () => {
  for (const i of [
    new VapiIntegration(fakeStatus(200)),
    new ElevenLabsIntegration(fakeStatus(200)),
    new BlandIntegration(fakeStatus(200)),
    new RetellIntegration(fakeStatus(200)),
  ]) {
    const check = await i.verifyCredentials(account);
    assert.equal(check.ok, true, `${i.id} should be ok on 200`);
  }
});

test("verifyCredentials reports failure with detail on 401", async () => {
  const vapi = new VapiIntegration(fakeStatus(401, "invalid key"));
  const check = await vapi.verifyCredentials(account);
  assert.equal(check.ok, false);
  assert.ok(check.detail?.includes("401"));
});

test("withTimeout aborts a hung fetch", async () => {
  const hung = ((_url: unknown, init?: { signal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    })) as unknown as typeof fetch;
  const wrapped = withTimeout(hung, 20);
  await assert.rejects(() => wrapped("https://example.com") as Promise<unknown>, /aborted/);
});
