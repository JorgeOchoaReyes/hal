"use client";

import { useEffect, useState, useCallback } from "react";
import type { TestingAgentSpec } from "@hal/core";
import AgentOutboundKey, { type OutboundKeyValue } from "./AgentOutboundKey";
import NumberPicker from "./NumberPicker";
import Modal from "./Modal";

interface Account {
  id: string;
  provider: string;
  label: string;
  createdAt: number;
}
interface Agent {
  spec?: TestingAgentSpec;
  hasEncryptedKey?: boolean;
  byotKeyId?: string;
  byotAccountId?: string;
  id: string;
  accountId: string;
  provider: string;
  externalAgentId: string;
  name: string;
  createdAt: number;
}

export default function TestingAgentsManager() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [provisionOpen, setProvisionOpen] = useState(false);

  const refresh = useCallback(async () => {
    const [a, g] = await Promise.all([
      fetch("/api/provider-accounts").then((r) => r.json()),
      fetch("/api/testing-agents").then((r) => r.json()),
    ]);
    setAccounts(a.accounts);
    setAgents(g.agents);
  }, []);

  useEffect(() => {
    refresh().catch(() => setError("Failed to load"));
  }, [refresh]);

  return (
    <div className="grid" style={{ gap: 18 }}>
      {error && (
        <div className="card" style={{ borderColor: "var(--fail)", color: "var(--fail)" }}>
          {error}
        </div>
      )}

      <div className="toolbar" style={{ margin: "4px 0 0" }}>
        <div className="muted" style={{ fontSize: 13 }}>
          {agents.length} testing agent{agents.length === 1 ? "" : "s"}
        </div>
        <button
          onClick={() => setProvisionOpen(true)}
          disabled={accounts.length === 0}
          title={accounts.length === 0 ? "Connect a provider account first" : "Create a testing agent"}
        >
          + New testing agent
        </button>
      </div>

      {accounts.length === 0 && (
        <div className="card muted">
          No provider accounts yet — connect one on <a href="/agents">Providers</a> first.
        </div>
      )}

      {agents.length === 0 ? (
        <div className="card muted">No testing agents yet.</div>
      ) : (
        <div className="grid stagger" style={{ gap: 10 }}>
          {agents.map((a) => (
            <AgentRow key={a.id} agent={a} onEdit={() => setEditingAgent(a)} account={accounts.find((x) => x.id === a.accountId)} />
          ))}
        </div>
      )}

      {editingAgent && <Modal open onClose={() => setEditingAgent(null)} title="Edit testing agent" wide><ProvisionAgent key={editingAgent.id} existing={editingAgent} accounts={accounts} onCancel={() => setEditingAgent(null)} onDone={() => { setEditingAgent(null); refresh(); }} /></Modal>}
      <Modal
        open={provisionOpen}
        onClose={() => setProvisionOpen(false)}
        title="Provision a testing agent"
        wide
      >
        <ProvisionAgent
          accounts={accounts}
          onDone={() => {
            setProvisionOpen(false);
            refresh();
          }}
          onCancel={() => setProvisionOpen(false)}
        />
      </Modal>
    </div>
  );
}

function ProvisionAgent({
  existing,
  accounts,
  onDone,
  onCancel,
}: {
  existing?: Agent;
  accounts: Account[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [accountId, setAccountId] = useState(existing?.accountId ?? "");
  const [name, setName] = useState(existing?.name ?? "HAL tester");
  const [systemPrompt, setSystemPrompt] = useState(
    existing?.spec?.persona.systemPrompt ?? "You are a QA tester calling a business's voice AI. Try to book an appointment and confirm the details.",
  );
  const [firstMessage, setFirstMessage] = useState(existing?.spec?.firstMessage ?? "Hi, I'd like to book an appointment.");
  const [useStructured, setUseStructured] = useState(Boolean(existing?.spec?.structured || existing?.spec?.pathwayId));
  const [pathwayId, setPathwayId] = useState(existing?.spec?.pathwayId ?? "");
  const [outboundKey, setOutboundKey] = useState<OutboundKeyValue>({});
  const [voice, setVoice] = useState(existing?.spec?.voice ?? "");
  const [model, setModel] = useState(existing?.spec?.model ?? "");
  const [structuredJson, setStructuredJson] = useState(
    JSON.stringify(
      existing?.spec?.structured ?? {
        role: "You are a patient booking an appointment",
        conditions: [
          { id: 0, condition: "FIRST_MESSAGE", action: "Hi, I'd like to book an appointment.", type: "standard", fixed_message: true },
          { id: 1, condition: "The agent asks which day", action: "Ask for the first available Tuesday", type: "standard", fixed_message: false },
          { id: 2, condition: 1, action: "Great, thanks! <endcall />", type: "action_followup", fixed_message: true },
        ],
      },
      null,
      2,
    ),
  );
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [remoteAgents, setRemoteAgents] = useState<{ id: string; name: string; kind: string }[]>([]);
  const selected = accountId || accounts[0]?.id || "";
  const selectedAccount = accounts.find((a) => a.id === selected);
  // Bland calls the structured/deterministic form a "Pathway"; other providers
  // use a "workflow"/"conversation flow". Label the option per provider.
  const structuredLabel = selectedAccount?.provider === "bland" ? "Pathway" : "Structured flow";

  // When importing, list the agents/pathways already on the selected account.
  useEffect(() => {
    if (!selected || !useStructured) {
      setRemoteAgents([]);
      return;
    }
    let live = true;
    fetch(`/api/testing-agents/remote?accountId=${encodeURIComponent(selected)}`)
      .then((r) => r.json())
      .then((d: { agents?: { id: string; name: string; kind: string }[] }) => {
        if (live) setRemoteAgents(d.agents ?? []);
      })
      .catch(() => live && setRemoteAgents([]));
    return () => {
      live = false;
    };
  }, [selected, useStructured]);

  function structuredPayload() {
    if (!useStructured) return undefined;
    try {
      return JSON.parse(structuredJson);
    } catch {
      throw new Error("Structured test is not valid JSON");
    }
  }

  async function doPreview() {
    setErr(null);
    setPreview(null);
    try {
      const res = await fetch("/api/testing-agents/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: selectedAccount?.provider,
          name,
          systemPrompt,
          firstMessage,
          structured: structuredPayload(),
          pathwayId: pathwayId.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setPreview(JSON.stringify(data.flow ?? data.config, null, 2));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/testing-agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountId: selected,
          name,
          systemPrompt,
          firstMessage,
          structured: structuredPayload(),
          pathwayId: pathwayId.trim() || undefined,
          agentId: existing?.id,
          voice: voice.trim() || undefined,
          model: model.trim() || undefined,
          steps: !useStructured ? existing?.spec?.steps : undefined,
          ...outboundKey,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {accounts.length === 0 && <p className="muted">Connect an account first.</p>}
      {err && (
        <div className="muted" style={{ color: "var(--fail)", marginBottom: 8 }}>
          {err}
        </div>
      )}
      <label className="field">
        <span className="field-label">Account</span>
        <select disabled={Boolean(existing)} value={selected} onChange={(e) => { setAccountId(e.target.value); setOutboundKey({}); }}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label} ({a.provider})
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">Agent name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {selectedAccount?.provider === "bland" && <AgentOutboundKey key={selected} accountId={selected} initial={existing} hasKey={existing?.hasEncryptedKey} onChange={setOutboundKey} />}
      <div className="settings-grid"><label className="field"><span className="field-label">Voice (optional)</span><input value={voice} onChange={(e) => setVoice(e.target.value)} /></label><label className="field"><span className="field-label">Model (optional)</span><input value={model} onChange={(e) => setModel(e.target.value)} /></label></div>
      {existing && <p className="field-help">These settings apply to direct test calls. Simulation dispatch uses the simulation’s saved persona and script, while keeping this agent’s voice and outbound credentials.</p>}
      <label className="field">
        <span className="field-label">Agent type</span>
        <select
          value={useStructured ? "structured" : "simple"}
          onChange={(e) => setUseStructured(e.target.value === "structured")}
        >
          <option value="simple">Simple agent — single prompt</option>
          <option value="structured">{structuredLabel} — deterministic flow</option>
        </select>
      </label>
      <p className="muted" style={{ fontSize: 12, marginTop: -4, marginBottom: 10 }}>
        {useStructured
          ? `HAL compiles your role + conditions into ${selectedAccount?.provider ?? "the provider"}'s native ${structuredLabel.toLowerCase()} for a deterministic tester.`
          : "A single system prompt drives the tester's replies — flexible but non-deterministic."}
      </p>
      {useStructured ? (
        <>
          {selectedAccount?.provider === "bland" && (
            <label className="field">
              <span className="field-label">Existing Bland Pathway (optional)</span>
              {remoteAgents.length > 0 && (
                <select
                  value={remoteAgents.some((a) => a.id === pathwayId) ? pathwayId : ""}
                  onChange={(e) => setPathwayId(e.target.value)}
                  style={{ marginBottom: 6 }}
                >
                  <option value="">— import a pathway from this account —</option>
                  {remoteAgents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              )}
              <input
                value={pathwayId}
                onChange={(e) => setPathwayId(e.target.value)}
                placeholder="or paste a pathway_id from Bland's Agent Builder"
                className="mono"
              />
              <span className="muted" style={{ fontSize: 12 }}>
                Pick an existing pathway on this account, or paste its id, to run the call against it
                directly. Leave blank to have HAL build one from the JSON below (create → set graph →
                version → publish).
              </span>
            </label>
          )}
          <label className="field">
            <span className="field-label">
              {selectedAccount?.provider === "bland"
                ? "Structured test — auto-builds a Bland Pathway (role + conditions JSON)"
                : "Structured test (role + conditions JSON)"}
            </span>
            <textarea
              value={structuredJson}
              onChange={(e) => setStructuredJson(e.target.value)}
              rows={10}
              className="mono"
            />
          </label>
        </>
      ) : (
        <>
          <label className="field">
            <span className="field-label">System prompt (the tester&apos;s behavior)</span>
            <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={3} />
          </label>
          <label className="field">
            <span className="field-label">First message</span>
            <input value={firstMessage} onChange={(e) => setFirstMessage(e.target.value)} />
          </label>
        </>
      )}
      {preview && (
        <>
          <div className="field-label" style={{ marginTop: 12 }}>
            Native config HAL will send to {selectedAccount?.provider}
          </div>
          <pre
            className="mono"
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: 12,
              overflow: "auto",
              fontSize: 12,
              maxHeight: 320,
            }}
          >
            {preview}
          </pre>
        </>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="secondary" onClick={doPreview} disabled={accounts.length === 0}>
          Preview {selectedAccount?.provider ?? "platform"} config
        </button>
        <button onClick={submit} disabled={busy || accounts.length === 0}>
          {busy ? "Saving…" : existing ? "Save testing agent" : "Create testing agent"}
        </button>
      </div>
    </>
  );
}

function AgentRow({ agent, account, onEdit }: { agent: Agent; account?: Account; onEdit: () => void }) {
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ status: string; labels?: Array<{ text: string; tone: string }> } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function call() {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const res = await fetch("/api/run-hosted", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId: agent.id, phoneNumber: phone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setResult(data.result);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <div className="card-row">
        <div>
          <strong>{agent.name}</strong> <span className="pill telephony">{agent.provider}</span>
          <div className="muted mono" style={{ fontSize: 12 }}>
            agent {agent.externalAgentId} · {account?.label ?? agent.accountId}
          </div>
        </div>
      </div>
      <button className="secondary" onClick={onEdit} disabled={busy}>Edit agent</button>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <NumberPicker accountId={agent.accountId} value={phone} onChange={setPhone} />
        <button onClick={call} disabled={busy || !phone.trim()}>
          {busy ? "Calling…" : "Place test call"}
        </button>
      </div>
      {err && (
        <div className="muted" style={{ color: "var(--fail)", marginTop: 6 }}>
          {err}
        </div>
      )}
      {result && (
        <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span className={`pill ${result.status}`}>{result.status}</span>
          {(result.labels ?? []).map((l, i) => (
            <span key={i} className={`label label-${l.tone}`}>
              {l.text}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
