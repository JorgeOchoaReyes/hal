"use client";

import { useEffect, useState, useCallback } from "react";

type Transport = "mock" | "telephony" | "webrtc" | "sip";

interface TargetAgent {
  id: string;
  name: string;
  description?: string;
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

/** Build a Target union value from the flat form fields. */
function buildTarget(name: string, transport: Transport, address: string, room: string) {
  switch (transport) {
    case "telephony":
      return { transport, name, phoneNumber: address };
    case "sip":
      return { transport, name, uri: address };
    case "webrtc":
      return { transport, name, signalingUrl: address, room: room || undefined };
    case "mock":
      return { transport, name, mock: { systemPrompt: `You are ${name}.`, greeting: address || undefined } };
  }
}

export default function TargetsManager() {
  const [targets, setTargets] = useState<TargetAgent[]>([]);
  const [error, setError] = useState<string | null>(null);

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
      <AddTarget onDone={refresh} />
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Name</th>
              <th>Channel</th>
              <th>Address</th>
              <th>Description</th>
              <th style={{ width: 90, textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {targets.length === 0 && (
              <tr className="empty-row">
                <td colSpan={5}>No target agents yet. Add the real agent you want to test above.</td>
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

function AddTarget({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<Transport>("telephony");
  const [address, setAddress] = useState("");
  const [room, setRoom] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
          target: buildTarget(name, transport, address, room),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setName("");
      setAddress("");
      setRoom("");
      setDescription("");
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <strong>Add an agent under test</strong>
      <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
        Register the real voice agent you want HAL to call. Simulations point at one of these.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 160px", gap: 10 }}>
        <div className="field">
          <span className="field-label">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Support line" />
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
      <div className="field">
        <span className="field-label">Description (optional)</span>
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Production booking bot" />
      </div>
      {err && <div className="muted" style={{ color: "var(--fail)", marginBottom: 8 }}>{err}</div>}
      <button onClick={submit} disabled={busy || !name.trim()}>
        {busy ? "Saving…" : "Add agent"}
      </button>
    </div>
  );
}

function TargetRow({ target, onChange }: { target: TargetAgent; onChange: () => void }) {
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    await fetch(`/api/targets/${target.id}`, { method: "DELETE" });
    setBusy(false);
    onChange();
  }

  return (
    <tr>
      <td style={{ fontWeight: 600 }}>{target.name}</td>
      <td>
        <span className={`pill ${target.target.transport}`}>{target.target.transport}</span>
      </td>
      <td className="mono muted" style={{ fontSize: 12 }}>{addressOf(target.target)}</td>
      <td className="muted">{target.description ?? "—"}</td>
      <td>
        <div className="row-actions">
          <button className="icon-btn" onClick={remove} disabled={busy} title="Remove">
            {busy ? "…" : "Delete"}
          </button>
        </div>
      </td>
    </tr>
  );
}
