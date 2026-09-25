"use client";

import { useEffect, useState, useCallback } from "react";
import type { SavedJudge } from "@hal/core";
import Modal from "./Modal";

type Transport = "mock" | "telephony" | "webrtc" | "sip";
type Direction = "inbound" | "outbound";

/** Voice platforms an agent under test can be built on. */
const PROVIDERS = ["vapi", "bland", "retell", "elevenlabs", "twilio", "custom"] as const;
const PROVIDER_LABEL: Record<string, string> = {
  vapi: "Vapi",
  bland: "Bland",
  retell: "Retell",
  elevenlabs: "ElevenLabs",
  twilio: "Twilio",
  custom: "Custom / other",
};

interface TargetAgent {
  id: string;
  name: string;
  description?: string;
  provider?: string;
  direction?: Direction;
  judgeIds?: string[];
  encryptedKey?: string;
  target: {
    transport: Transport;
    name: string;
    phoneNumber?: string;
    uri?: string;
    signalingUrl?: string;
    room?: string;
    mock?: { systemPrompt: string; greeting?: string };
  };
}

const ADDRESS_LABEL: Record<Transport, string> = {
  telephony: "Phone number (E.164)",
  sip: "SIP URI",
  webrtc: "Signaling URL",
  mock: "Mock greeting",
};

function addressOf(t: TargetAgent["target"]): string {
  switch (t.transport) {
    case "telephony":
      return t.phoneNumber ?? "—";
    case "sip":
      return t.uri ?? "—";
    case "webrtc":
      return [t.signalingUrl, t.room && `room ${t.room}`].filter(Boolean).join(" · ") || "—";
    case "mock":
      return t.mock?.greeting ? `“${t.mock.greeting}”` : "in-process";
  }
}

/**
 * Build a Target union value from the flat form fields. `existingSystemPrompt`
 * preserves a mock agent's real prompt across an edit — otherwise saving would
 * silently replace it with a generic placeholder derived from the name.
 */
function buildTarget(name: string, transport: Transport, address: string, room: string, existingSystemPrompt?: string) {
  switch (transport) {
    case "telephony":
      return { transport, name, phoneNumber: address };
    case "sip":
      return { transport, name, uri: address };
    case "webrtc":
      return { transport, name, signalingUrl: address, room: room || undefined };
    case "mock":
      return {
        transport,
        name,
        mock: { systemPrompt: existingSystemPrompt ?? `You are ${name}.`, greeting: address || undefined },
      };
  }
}

export default function TargetsManager() {
  const [targets, setTargets] = useState<TargetAgent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const refresh = useCallback(async () => {
    const d = await fetch("/api/targets").then((r) => r.json());
    setTargets(d.targets ?? []);
  }, []);

  useEffect(() => {
    refresh().catch(() => setError("Failed to load agents"));
  }, [refresh]);

  return (
    <div className="grid" style={{ gap: 18 }}>
      {error && (
        <div className="card" style={{ borderColor: "var(--fail)", color: "var(--fail)" }}>{error}</div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button onClick={() => setAddOpen(true)}>+ Add agent under test</button>
      </div>
      {addOpen && (
        <AddTarget
          onDone={() => {
            setAddOpen(false);
            refresh();
          }}
          onClose={() => setAddOpen(false)}
        />
      )}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Name</th>
              <th>Provider</th>
              <th>Direction</th>
              <th>Channel</th>
              <th>Address</th>
              <th>Description</th>
              <th style={{ width: 90, textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {targets.length === 0 && (
              <tr className="empty-row">
                <td colSpan={7}>No target agents yet. Add the real agent you want to test above.</td>
              </tr>
            )}
            {targets.map((t) => (
              <TargetRow key={t.id} target={t} onChange={refresh} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


interface ProviderAccount {
  id: string;
  provider: string;
  label: string;
}
interface ProviderNumber {
  phoneNumber: string;
  label?: string;
}
interface RemoteAgent {
  id: string;
  name: string;
  kind: string;
}

function AddTarget({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<Transport>("telephony");
  const [provider, setProvider] = useState<string>("vapi");
  const [direction, setDirection] = useState<Direction>("inbound");
  const [address, setAddress] = useState("");
  const [room, setRoom] = useState("");
  const [description, setDescription] = useState("");
  const [encryptedKey, setEncryptedKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Import from a connected provider: pick an account, then one of its actual
  // agents (imports its config), and optionally a number to dial it on.
  const [accounts, setAccounts] = useState<ProviderAccount[]>([]);
  const [importAccountId, setImportAccountId] = useState("");
  const [remoteAgents, setRemoteAgents] = useState<RemoteAgent[]>([]);
  const [agentsSupported, setAgentsSupported] = useState(true);
  const [numbers, setNumbers] = useState<ProviderNumber[]>([]);
  const [importedAgentId, setImportedAgentId] = useState("");

  useEffect(() => {
    fetch("/api/provider-accounts")
      .then((r) => r.json())
      .then((d: { accounts?: ProviderAccount[] }) => setAccounts(d.accounts ?? []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    setImportedAgentId("");
    if (!importAccountId) {
      setNumbers([]);
      setRemoteAgents([]);
      return;
    }
    let live = true;
    fetch(`/api/hosted-integrations/numbers?accountId=${encodeURIComponent(importAccountId)}`)
      .then((r) => r.json())
      .then((d: { numbers?: ProviderNumber[] }) => live && setNumbers(d.numbers ?? []))
      .catch(() => live && setNumbers([]));
    fetch(`/api/testing-agents/remote?accountId=${encodeURIComponent(importAccountId)}`)
      .then((r) => r.json())
      .then((d: { supported?: boolean; agents?: RemoteAgent[] }) => {
        if (!live) return;
        setAgentsSupported(d.supported !== false);
        setRemoteAgents(d.agents ?? []);
      })
      .catch(() => live && setRemoteAgents([]));
    return () => {
      live = false;
    };
  }, [importAccountId]);

  /** Import an agent's own config: name + provider + a reference to it. */
  function importAgent(agentId: string) {
    if (!agentId) return;
    const acct = accounts.find((a) => a.id === importAccountId);
    const agent = remoteAgents.find((a) => a.id === agentId);
    if (!agent) return;
    setImportedAgentId(agentId);
    setProvider(acct?.provider ?? provider);
    setName(agent.name);
    setDescription(`Imported ${agent.kind} "${agent.name}" (${agent.id}) from ${acct?.label ?? acct?.provider}.`);
  }

  /** Attach a dialable number from the same account — the address to call. */
  function importNumber(phone: string) {
    if (!phone) return;
    const acct = accounts.find((a) => a.id === importAccountId);
    const num = numbers.find((n) => n.phoneNumber === phone);
    setProvider(acct?.provider ?? provider);
    setTransport("telephony");
    setAddress(phone);
    if (!name.trim()) setName(num?.label || `${acct?.label ?? "Agent"} ${phone}`);
  }

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/targets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          provider,
          direction,
          target: buildTarget(name, transport, address, room),
          encryptedKey: encryptedKey.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setName("");
      setAddress("");
      setRoom("");
      setDescription("");
      setEncryptedKey("");
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Add an agent under test"
      wide
      footer={
        <>
          <button className="icon-btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button onClick={submit} disabled={busy || !name.trim()}>
            {busy ? "Saving…" : "Add agent"}
          </button>
        </>
      }
    >
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Register the real voice agent you want HAL to call. Simulations point at one of these.
      </p>

      {accounts.length > 0 && (
        <div
          style={{
            marginBottom: 12,
            padding: 12,
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--panel-2)",
          }}
        >
          <div className="field" style={{ margin: 0, marginBottom: 10 }}>
            <span className="field-label">Import from a connected provider</span>
            <select value={importAccountId} onChange={(e) => setImportAccountId(e.target.value)}>
              <option value="">— select a connected account —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} ({a.provider})
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div className="field" style={{ margin: 0 }}>
              <span className="field-label">Agent</span>
              <select value={importedAgentId} disabled={!importAccountId} onChange={(e) => importAgent(e.target.value)}>
                <option value="">
                  {!importAccountId
                    ? "select an account first"
                    : !agentsSupported
                      ? "this provider doesn't list agents — use Custom below"
                      : remoteAgents.length === 0
                        ? "no agents found on this account"
                        : "— pick an agent to import —"}
                </option>
                {remoteAgents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <span className="muted" style={{ fontSize: 12 }}>
                Imports the agent&apos;s name and config reference.
              </span>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <span className="field-label">Number (optional)</span>
              <select value="" disabled={!importAccountId} onChange={(e) => importNumber(e.target.value)}>
                <option value="">
                  {!importAccountId
                    ? "select an account first"
                    : numbers.length === 0
                      ? "no numbers found"
                      : "— attach a number to dial —"}
                </option>
                {numbers.map((n) => (
                  <option key={n.phoneNumber} value={n.phoneNumber}>
                    {n.label ? `${n.label} · ${n.phoneNumber}` : n.phoneNumber}
                  </option>
                ))}
              </select>
              <span className="muted" style={{ fontSize: 12 }}>
                Sets the phone number HAL dials for this agent.
              </span>
            </div>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
            No provider connected, or want full control? Use <strong>Custom</strong> below and fill in
            the fields by hand.
          </p>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 150px", gap: 10 }}>
        <div className="field">
          <span className="field-label">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Support line" />
        </div>
        <div className="field">
          <span className="field-label">Provider</span>
          <select value={provider} onChange={(e) => setProvider(e.target.value)}>
            {PROVIDERS.map((pv) => (
              <option key={pv} value={pv}>
                {PROVIDER_LABEL[pv]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div className="field">
          <span className="field-label">Direction</span>
          <select value={direction} onChange={(e) => setDirection(e.target.value as Direction)}>
            <option value="inbound">inbound</option>
            <option value="outbound">outbound</option>
          </select>
        </div>
        <div className="field">
          <span className="field-label">Channel</span>
          <select value={transport} onChange={(e) => setTransport(e.target.value as Transport)}>
            <option value="telephony">telephony</option>
            <option value="sip">sip</option>
            <option value="webrtc">webrtc</option>
            <option value="mock">mock</option>
          </select>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: -4 }}>
        {direction === "inbound"
          ? "Inbound — the agent answers calls, so HAL dials it."
          : "Outbound — the agent places calls, so HAL provides a number for it to call."}
      </p>
      <div style={{ display: "grid", gridTemplateColumns: transport === "webrtc" ? "1fr 160px" : "1fr", gap: 10 }}>
        <div className="field">
          <span className="field-label">{ADDRESS_LABEL[transport]}</span>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder={
              transport === "telephony"
                ? "+14155550123"
                : transport === "sip"
                  ? "sip:agent@pbx.example.com"
                  : transport === "webrtc"
                    ? "wss://signal.example.com"
                    : "Hi, thanks for calling…"
            }
          />
        </div>
        {transport === "webrtc" && (
          <div className="field">
            <span className="field-label">Room (optional)</span>
            <input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="room-id" />
          </div>
        )}
      </div>
      {direction === "outbound" && (
        <div className="field">
          <span className="field-label">Encrypted key</span>
          <input
            type="password"
            value={encryptedKey}
            onChange={(e) => setEncryptedKey(e.target.value)}
            placeholder={provider === "bland" ? "Bland encrypted_key for this agent" : "Provider key for this agent"}
            className="mono"
          />
          <span className="muted" style={{ fontSize: 12 }}>
            Per-agent secret used to trigger this agent&apos;s own pathway and place the outbound
            call. Different per agent — stored as given.
          </span>
        </div>
      )}
      <div className="field">
        <span className="field-label">Description (optional)</span>
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Production booking bot" />
      </div>
      {err && <div className="muted" style={{ color: "var(--fail)", marginBottom: 8 }}>{err}</div>}
    </Modal>
  );
}

function TargetRow({ target, onChange }: { target: TargetAgent; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  async function remove() {
    setBusy(true);
    await fetch(`/api/targets/${target.id}`, { method: "DELETE" });
    setBusy(false);
    onChange();
  }

  return (
    <>
      <tr>
        <td style={{ fontWeight: 600 }}>{target.name}</td>
        <td>
          {target.provider ? (
            <span className="pill">{PROVIDER_LABEL[target.provider] ?? target.provider}</span>
          ) : (
            <span className="muted">—</span>
          )}
        </td>
        <td>
          <span className={`pill ${target.direction ?? "inbound"}`}>{target.direction ?? "inbound"}</span>
        </td>
        <td>
          <span className={`pill ${target.target.transport}`}>{target.target.transport}</span>
        </td>
        <td className="mono muted" style={{ fontSize: 12 }}>{addressOf(target.target)}</td>
        <td className="muted">{target.description ?? "—"}</td>
        <td>
          <div className="row-actions">
            <button className="icon-btn" onClick={() => setEditOpen(true)} title="Edit this agent">
              Edit
            </button>
            <button className="icon-btn" onClick={remove} disabled={busy} title="Remove">
              {busy ? "…" : "Delete"}
            </button>
          </div>
        </td>
      </tr>
      {editOpen && (
        <EditTargetModal
          target={target}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false);
            onChange();
          }}
        />
      )}
    </>
  );
}

function EditTargetModal({
  target,
  onClose,
  onSaved,
}: {
  target: TargetAgent;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(target.name);
  const [provider, setProvider] = useState(target.provider ?? "custom");
  const [direction, setDirection] = useState<Direction>(target.direction ?? "inbound");
  const [transport, setTransport] = useState<Transport>(target.target.transport);
  const [address, setAddress] = useState(
    target.target.transport === "telephony"
      ? target.target.phoneNumber ?? ""
      : target.target.transport === "sip"
        ? target.target.uri ?? ""
        : target.target.transport === "webrtc"
          ? target.target.signalingUrl ?? ""
          : target.target.mock?.greeting ?? ""
  );
  const [room, setRoom] = useState(target.target.transport === "webrtc" ? target.target.room ?? "" : "");
  const [description, setDescription] = useState(target.description ?? "");
  const [encryptedKey, setEncryptedKey] = useState(target.encryptedKey ?? "");
  const [judges, setJudges] = useState<SavedJudge[]>([]);
  const [judgeIds, setJudgeIds] = useState<Set<string>>(new Set(target.judgeIds ?? []));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/judges")
      .then((r) => r.json())
      .then((d: { judges?: SavedJudge[] }) => setJudges(d.judges ?? []))
      .catch(() => undefined);
  }, []);

  function toggleJudge(id: string) {
    setJudgeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/targets/${target.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          provider,
          direction,
          target: buildTarget(name, transport, address, room, target.target.mock?.systemPrompt),
          judgeIds: [...judgeIds],
          encryptedKey: encryptedKey.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit agent"
      footer={
        <>
          <button className="icon-btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button onClick={save} disabled={busy || !name.trim()}>
            {busy ? "Saving…" : "Save changes"}
          </button>
        </>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 150px", gap: 10 }}>
          <div className="field">
            <span className="field-label">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Support line" />
          </div>
          <div className="field">
            <span className="field-label">Provider</span>
            <select value={provider} onChange={(e) => setProvider(e.target.value)}>
              {PROVIDERS.map((pv) => (
                <option key={pv} value={pv}>
                  {PROVIDER_LABEL[pv]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div className="field">
            <span className="field-label">Direction</span>
            <select value={direction} onChange={(e) => setDirection(e.target.value as Direction)}>
              <option value="inbound">inbound</option>
              <option value="outbound">outbound</option>
            </select>
          </div>
          <div className="field">
            <span className="field-label">Channel</span>
            <select value={transport} onChange={(e) => setTransport(e.target.value as Transport)}>
              <option value="telephony">telephony</option>
              <option value="sip">sip</option>
              <option value="webrtc">webrtc</option>
              <option value="mock">mock</option>
            </select>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: transport === "webrtc" ? "1fr 160px" : "1fr", gap: 10 }}>
          <div className="field">
            <span className="field-label">{ADDRESS_LABEL[transport]}</span>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={
                transport === "telephony"
                  ? "+14155550123"
                  : transport === "sip"
                    ? "sip:agent@pbx.example.com"
                    : transport === "webrtc"
                      ? "wss://signal.example.com"
                      : "Hi, thanks for calling…"
              }
            />
          </div>
          {transport === "webrtc" && (
            <div className="field">
              <span className="field-label">Room (optional)</span>
              <input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="room-id" />
            </div>
          )}
        </div>
        {direction === "outbound" && (
          <div className="field">
            <span className="field-label">Encrypted key</span>
            <input
              type="password"
              value={encryptedKey}
              onChange={(e) => setEncryptedKey(e.target.value)}
              placeholder={provider === "bland" ? "Bland encrypted_key for this agent" : "Provider key for this agent"}
              className="mono"
            />
            <span className="muted" style={{ fontSize: 12 }}>
              Per-agent secret used to trigger this agent&apos;s own pathway and place the outbound
              call. Different per agent — stored as given.
            </span>
          </div>
        )}
        <div className="field">
          <span className="field-label">Description (optional)</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Production booking bot" />
        </div>
        <div className="field">
          <span className="field-label">Judges (score production calls assigned to this agent)</span>
          {judges.length === 0 ? (
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>No saved judges yet.</p>
          ) : (
            <div className="grid" style={{ gap: 6 }}>
              {judges.map((j) => (
                <label
                  key={j.id}
                  className="card-row"
                  style={{ cursor: "pointer", background: "var(--panel-2)", padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)" }}
                >
                  <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      style={{ width: "auto" }}
                      checked={judgeIds.has(j.id)}
                      onChange={() => toggleJudge(j.id)}
                    />
                    <span>
                      <strong>{j.name}</strong> <span className="tag">{j.kind}</span>
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
        {err && <div className="muted" style={{ color: "var(--fail)", marginBottom: 8 }}>{err}</div>}
    </Modal>
  );
}
