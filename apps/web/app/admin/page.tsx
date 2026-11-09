"use client";
import { useCallback, useEffect, useState } from "react";
import { API } from "@/lib/config";
import { get } from "@/lib/api";
import { useWallet, errText } from "@/lib/wallet";

export default function AdminPage() {
  const { address, token, signIn } = useWallet();
  const [rows, setRows] = useState<any[] | null>(null);
  const [denied, setDenied] = useState(false);
  const [f, setF] = useState({ equipment_id: "", level: "2", days: "365", note: "" });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });

  const load = useCallback(() => {
    if (!token) return;
    get("/admin/verifications", token).then((r) => { setRows(r); setDenied(false); }).catch(() => setDenied(true));
  }, [token]);
  useEffect(load, [load]);

  async function call(path: string, method: string, body?: any) {
    const r = await fetch(`${API}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? `Request failed (${r.status})`);
  }

  async function grant() {
    setBusy(true); setMsg("");
    try {
      await call("/admin/verifications", "POST", { equipment_id: Number(f.equipment_id), level: Number(f.level), days: Number(f.days), note: f.note });
      setMsg("Saved."); load();
    } catch (e) { setMsg(errText(e)); }
    setBusy(false);
  }
  async function revoke(id: number) {
    setBusy(true); setMsg("");
    try { await call(`/admin/verifications/${id}`, "DELETE"); setMsg("Revoked."); load(); } catch (e) { setMsg(errText(e)); }
    setBusy(false);
  }

  if (!address) return <p className="meta">Connect an admin wallet to continue.</p>;
  if (!token) return (
    <div className="panel">
      <p>Sign in to manage verification levels.</p>
      <button onClick={() => signIn().catch((e) => setMsg(errText(e)))}>Sign in</button>
      <p className="msg err">{msg}</p>
    </div>
  );
  if (denied) return <p className="msg err">This wallet isn’t in ADMIN_ADDRESSES on the API.</p>;

  const now = Math.floor(Date.now() / 1000);
  return (
    <>
      <div className="page-title">Verification levels</div>
      <div className="panel">
        <label htmlFor="i">Equipment id</label><input id="i" inputMode="numeric" value={f.equipment_id} onChange={set("equipment_id")} />
        <label htmlFor="v">Level</label>
        <select id="v" value={f.level} onChange={set("level")}><option value="2">Verified, owner identity checked</option><option value="3">Inspected, machine checked in person</option></select>
        <label htmlFor="d">Valid for (days)</label><input id="d" inputMode="numeric" value={f.days} onChange={set("days")} />
        <label htmlFor="n">Internal note</label><input id="n" value={f.note} onChange={set("note")} />
        <button disabled={!f.equipment_id || busy} onClick={grant}>Grant level</button>
        <p className="msg" role="status">{msg}</p>
      </div>
      <h2>Granted</h2>
      {rows && !rows.length && <p className="meta">Nothing granted yet.</p>}
      {rows?.map((r) => (
        <div className="panel" key={r.equipment_id}>
          <div className="top-row">
            <strong>#{r.equipment_id} {r.title ?? ""}, level {r.level}</strong>
            <span className={`pill ${r.revoked || r.stale || r.expires_at <= now ? "warn" : "done"}`}>{r.revoked ? "Revoked" : r.stale ? "Listing changed" : r.expires_at <= now ? "Expired" : "Active"}</span>
          </div>
          <div className="meta">Expires {new Date(r.expires_at * 1000).toLocaleDateString()}{r.note ? ` · ${r.note}` : ""}</div>
          {r.stale && !r.revoked && <p className="note">The owner changed the listing after you approved it, so the badge is off. Review the listing, then grant the level again above.</p>}
          {!r.revoked && <div className="actions"><button className="small ghost" disabled={busy} onClick={() => revoke(r.equipment_id)}>Revoke</button></div>}
        </div>
      ))}
    </>
  );
}
