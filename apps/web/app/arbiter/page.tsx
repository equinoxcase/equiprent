"use client";
import { useCallback, useEffect, useState } from "react";
import { parseEther } from "viem";
import { get, bot } from "@/lib/api";
import { useWallet, errText } from "@/lib/wallet";
import Evidence from "@/components/Evidence";

export default function ArbiterPage() {
  const { address, token, signIn, send } = useWallet();
  const [rows, setRows] = useState<any[] | null>(null);
  const [denied, setDenied] = useState(false);
  const [amt, setAmt] = useState<Record<number, string>>({});
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!token) return;
    get("/disputes", token).then((r) => { setRows(r); setDenied(false); }).catch(() => setDenied(true));
  }, [token]);
  useEffect(load, [load]);

  async function resolve(r: any) {
    setBusy(true); setMsg("Confirm in your wallet.");
    try {
      await send("resolveDispute", [BigInt(r.id), parseEther(amt[r.id] || "0")]);
      setMsg("Resolved. The list updates in a few seconds.");
      setTimeout(load, 8000);
    } catch (e) { setMsg(errText(e)); }
    setBusy(false);
  }

  if (!address) return <p className="meta">Connect the arbiter wallet to continue.</p>;
  if (!token) return (
    <div className="panel">
      <p>Sign in to see disputes.</p>
      <button onClick={() => signIn().catch((e) => setMsg(errText(e)))}>Sign in</button>
      <p className="msg err">{msg}</p>
    </div>
  );
  if (denied) return <p className="msg err">This wallet isn’t the arbiter.</p>;
  return (
    <>
      <div className="page-title">Disputes</div>
      {rows && !rows.length && <p className="meta">No open disputes.</p>}
      {rows?.map((r) => (
        <div className="panel" key={r.id}>
          <div className="top-row"><strong>Rental #{r.id}, equipment #{r.equipment_id}</strong><span className="pill warn">Disputed</span></div>
          <div className="row"><span>Rental fee</span><span>{bot(r.fee)} BOT</span></div>
          <div className="row"><span>Deposit</span><span>{bot(r.deposit)} BOT</span></div>
          <div className="meta">{r.evidence_count} evidence file(s)</div>
          <label htmlFor={`a${r.id}`}>Amount to the owner (BOT). The rest goes to the renter.</label>
          <input id={`a${r.id}`} inputMode="decimal" value={amt[r.id] ?? ""} onChange={(e) => setAmt({ ...amt, [r.id]: e.target.value })} />
          <div className="actions">
            <button className="small" disabled={busy} onClick={() => resolve(r)}>Resolve</button>
            <button className="small ghost" onClick={() => setOpen({ ...open, [r.id]: !open[r.id] })}>{open[r.id] ? "Hide evidence" : "Evidence"}</button>
          </div>
          {open[r.id] && <Evidence rentalId={r.id} canAdd={false} />}
        </div>
      ))}
      <p className="msg" role="status">{msg}</p>
    </>
  );
}
