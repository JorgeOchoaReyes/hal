"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { RunStatus } from "@hal/core";
import { useNewSimulation } from "./NewSimulationContext";
import RunModal from "./RunModal";

export interface SimRow {
  id: string;
  name: string;
  persona: string;
  transport: string;
  target: string;
  steps: number;
  metrics: number;
  tags: string[];
  folderId?: string;
}

interface SimFolder { id: string; name: string; createdAt: number }

type RunState = "idle" | RunStatus;

/**
 * A clean, tabular list of simulations — one row per scenario with its persona,
 * channel, target, step/metric counts, tags, and inline run. Modeled on a
 * conventional evaluators table so scanning many scenarios is fast.
 */
export default function SimulationsTable({ rows, folders: initialFolders }: { rows: SimRow[]; folders: SimFolder[] }) {
  const [q, setQ] = useState("");
  const [folders, setFolders] = useState(initialFolders);
  const [selectedFolder, setSelectedFolder] = useState("all");
  const [folderName, setFolderName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmFolderDelete, setConfirmFolderDelete] = useState<string | null>(null);
  const [folderBusy, setFolderBusy] = useState(false);
  const [folderError, setFolderError] = useState("");
  const [moved, setMoved] = useState<Record<string, string>>({});
  const [runState, setRunState] = useState<Record<string, RunState>>({});
  const [runModalFor, setRunModalFor] = useState<string | null>(null);
  const [deleteFor, setDeleteFor] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState<string[]>([]);
  const [deleteError, setDeleteError] = useState("");
  const router = useRouter();
  const { openNewSimulation } = useNewSimulation();

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const visible = rows.filter((r) => !deleted.includes(r.id) && (selectedFolder === "all" ||
      (selectedFolder === "unfiled" ? !(moved[r.id] ?? r.folderId) : (moved[r.id] ?? r.folderId) === selectedFolder)));
    if (!needle) return visible;
    return visible.filter(
      (r) =>
        r.name.toLowerCase().includes(needle) ||
        r.id.toLowerCase().includes(needle) ||
        r.persona.toLowerCase().includes(needle) ||
        r.tags.some((t) => t.toLowerCase().includes(needle)),
    );
  }, [rows, q, deleted, selectedFolder, moved]);

  const liveRows = rows.filter((row) => !deleted.includes(row.id));
  const countIn = (folderId: string) => liveRows.filter((row) => (moved[row.id] ?? row.folderId ?? "") === folderId).length;

  async function createFolder() {
    setFolderBusy(true); setFolderError("");
    try {
      const response = await fetch("/api/simulation-folders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: folderName }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not create folder");
      setFolders((items) => [...items, data.folder].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedFolder(data.folder.id); setFolderName(""); router.refresh();
    } catch (error) { setFolderError((error as Error).message); }
    finally { setFolderBusy(false); }
  }

  async function renameFolder(id: string) {
    setFolderBusy(true); setFolderError("");
    try {
      const response = await fetch(`/api/simulation-folders/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: folderName }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not rename folder");
      setFolders((items) => items.map((item) => item.id === id ? data.folder : item).sort((a, b) => a.name.localeCompare(b.name)));
      setRenaming(null); setFolderName(""); router.refresh();
    } catch (error) { setFolderError((error as Error).message); }
    finally { setFolderBusy(false); }
  }

  async function removeFolder(id: string) {
    setFolderBusy(true); setFolderError("");
    try {
      const response = await fetch(`/api/simulation-folders/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not delete folder");
      setFolders((items) => items.filter((item) => item.id !== id));
      setMoved((items) => ({ ...items, ...Object.fromEntries(liveRows.filter((row) => (items[row.id] ?? row.folderId) === id).map((row) => [row.id, ""])) }));
      setSelectedFolder("unfiled"); setConfirmFolderDelete(null); router.refresh();
    } catch (error) { setFolderError((error as Error).message); }
    finally { setFolderBusy(false); }
  }

  async function moveSimulation(id: string, folderId: string) {
    setFolderError("");
    try {
      const response = await fetch(`/api/testcases/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ folderId }) });
      if (!response.ok) throw new Error((await response.json()).error ?? "Could not move simulation");
      setMoved((items) => ({ ...items, [id]: folderId })); router.refresh();
    } catch (error) { setFolderError((error as Error).message); }
  }

  async function remove(id: string) {
    setDeleting(true); setDeleteError("");
    try {
      const response = await fetch(`/api/testcases/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not delete the simulation. Try again.");
      setDeleted((ids) => [...ids, id]); setDeleteFor(null); router.refresh();
    } catch (error) { setDeleteError((error as Error).message); }
    finally { setDeleting(false); }
  }

  function onRunComplete(id: string, status: RunStatus) {
    setRunState((s) => ({ ...s, [id]: status }));
  }

  return (
    <>
      <div className="simulation-library">
      <aside className="card simulation-folders" aria-label="Simulation folders">
        <div className="section-heading"><h3>Folders</h3></div>
        <button className={selectedFolder === "all" ? "folder-choice active" : "folder-choice"} onClick={() => setSelectedFolder("all")}>All simulations <span>{liveRows.length}</span></button>
        <button className={selectedFolder === "unfiled" ? "folder-choice active" : "folder-choice"} onClick={() => setSelectedFolder("unfiled")}>Unfiled <span>{countIn("")}</span></button>
        {folders.map((folder) => <div className="folder-item" key={folder.id}>
          {renaming === folder.id ? <form className="folder-edit" onSubmit={(event) => { event.preventDefault(); void renameFolder(folder.id); }}>
            <input autoFocus aria-label="Folder name" maxLength={80} value={folderName} onChange={(event) => setFolderName(event.target.value)} />
            <button type="submit" className="icon-btn" disabled={folderBusy || !folderName.trim()}>Save</button>
            <button type="button" className="icon-btn" onClick={() => { setRenaming(null); setFolderName(""); }}>Cancel</button>
          </form> : <>
            <button className={selectedFolder === folder.id ? "folder-choice active" : "folder-choice"} onClick={() => setSelectedFolder(folder.id)} title={folder.name}>▸ {folder.name} <span>{countIn(folder.id)}</span></button>
            {selectedFolder === folder.id && <div className="folder-actions">
              <button className="icon-btn" onClick={() => { setRenaming(folder.id); setFolderName(folder.name); }}>Rename</button>
              {confirmFolderDelete === folder.id ? <><button className="icon-btn" disabled={folderBusy} onClick={() => void removeFolder(folder.id)}>Confirm</button><button className="icon-btn" onClick={() => setConfirmFolderDelete(null)}>Cancel</button></> : <button className="icon-btn" onClick={() => setConfirmFolderDelete(folder.id)}>Delete</button>}
            </div>}
          </>}
        </div>)}
        {confirmFolderDelete && <p className="field-help">Deleting a folder moves its simulations to Unfiled.</p>}
        {!renaming && <form className="folder-create" onSubmit={(event) => { event.preventDefault(); void createFolder(); }}>
          <input aria-label="New folder name" placeholder="New folder" maxLength={80} value={folderName} onChange={(event) => setFolderName(event.target.value)} />
          <button type="submit" className="secondary" disabled={folderBusy || !folderName.trim()}>Create folder</button>
        </form>}
        {folderError && <p role="alert" className="error-text">{folderError}</p>}
      </aside>
      <div className="simulation-list">
      <div className="toolbar">
        <input
          className="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search scenarios by name, id, persona, or tag…"
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="muted" style={{ fontSize: 13 }}>
            {filtered.length} of {rows.length}
          </span>
          <button type="button" className="btn" onClick={() => openNewSimulation({ folderId: selectedFolder !== "all" && selectedFolder !== "unfiled" ? selectedFolder : undefined })}>
            + New simulation
          </button>
        </div>
      </div>

      <div className="table-wrap">
        {deleteError && <p role="alert" className="error-text">{deleteError}</p>}
        <table className="data">
          <thead>
            <tr>
              <th style={{ width: 92 }}>ID</th>
              <th>Name</th>
              <th>Folder</th>
              <th>Persona</th>
              <th>Channel</th>
              <th>Target</th>
              <th style={{ width: 70, textAlign: "center" }}>Steps</th>
              <th style={{ width: 80, textAlign: "center" }}>Metrics</th>
              <th>Tags</th>
              <th style={{ width: 150, textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr className="empty-row">
                <td colSpan={10}>
                  {rows.length === 0 ? "No simulations yet." : "No scenarios match your search."}
                </td>
              </tr>
            )}
            {filtered.map((r) => {
              const state = runState[r.id] ?? "idle";
              return (
                <tr key={r.id}>
                  <td className="id-cell">{r.id.slice(0, 8)}</td>
                  <td>
                    <Link href={`/simulations/${r.id}`} style={{ fontWeight: 600 }}>
                      {r.name}
                    </Link>
                  </td>
                  <td><select aria-label={`Folder for ${r.name}`} className="folder-select" value={moved[r.id] ?? r.folderId ?? ""} onChange={(event) => void moveSimulation(r.id, event.target.value)}>
                    <option value="">Unfiled</option>
                    {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                  </select></td>
                  <td className="muted">{r.persona}</td>
                  <td>
                    <span className={`pill ${r.transport}`}>{r.transport}</span>
                  </td>
                  <td className="muted mono" style={{ fontSize: 12 }}>
                    {r.target || "—"}
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <span className="count-badge">{r.steps}</span>
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <span className="count-badge">{r.metrics}</span>
                  </td>
                  <td>
                    {r.tags.length === 0 ? (
                      <span className="muted">—</span>
                    ) : (
                      r.tags.map((t) => (
                        <span className="tag" key={t}>
                          {t}
                        </span>
                      ))
                    )}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="icon-btn"
                        onClick={() => setRunModalFor(r.id)}
                        title="Configure and run this simulation"
                      >
                        ▶ Run
                      </button>
                      {state !== "idle" && <span className={`pill ${state}`}>{state}</span>}
                      <Link href={`/simulations/${r.id}`} className="icon-btn" title="Open">
                        Open
                      </Link>
                      {deleteFor === r.id ? <>
                        <button className="icon-btn" disabled={deleting} onClick={() => remove(r.id)}>Confirm delete</button>
                        <button className="icon-btn" disabled={deleting} onClick={() => setDeleteFor(null)}>Cancel</button>
                      </> : <button className="icon-btn" onClick={() => setDeleteFor(r.id)} title={`Delete ${r.name}`}>Delete</button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </div>
      </div>

      {runModalFor && (
        <RunModal
          testCaseId={runModalFor}
          onClose={() => setRunModalFor(null)}
          onRunComplete={(status) => onRunComplete(runModalFor, status)}
        />
      )}
    </>
  );
}
