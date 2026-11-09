"use client";
import { useCallback, useEffect, useState } from "react";
import { get, bot } from "@/lib/api";
import { CONTRACT, abi, HANDOVER_GRACE, RETURN_WINDOW, ARBITER_WINDOW, LATE_GRACE } from "@/lib/config";
import { pub, useWallet, errText } from "@/lib/wallet";
import Evidence from "@/components/Evidence";

type Act = { fn: string; label: string; ghost?: boolean };
const nowSec = () => Math.floor(Date.now() / 1000);
const fmt = (t: number) => new Date(t * 1000).toLocaleString();

function actions(r: any, role: "renter" | "owner"): Act[] {
  const s = r.status, now = nowSec(), out: Act[] = [];
  const stalled = s === "Accepted" && now >= r.start + HANDOVER_GRACE;
  const inReturnWindow = s === "Returned" && now < r.returned_at + RETURN_WINDOW;
  const silenceOver = s === "Returned" && now >= r.returned_at + RETURN_WINDOW;
  const arbiterLate = s === "Disputed" && r.disputed_at > 0 && now >= r.disputed_at + ARBITER_WINDOW;
  const hasExt = r.pending_end > 0;

  if (role === "renter") {
    if (s === "Requested") out.push({ fn: "cancelRequest", label: "Withdraw request" });
    if (s === "Accepted" && !r.renter_handover) out.push({ fn: "confirmHandover", label: "Confirm I received it" });
    if (s === "Accepted" && !r.renter_handover) out.push({ fn: "cancelUnstarted", label: "Cancel, never delivered", ghost: true });
    if (stalled && r.renter_handover) out.push({ fn: "openDispute", label: "Open dispute, owner never confirmed", ghost: true });
    if (s === "HandedOver") out.push({ fn: "reportReturn", label: "Report returned" });
    if (s === "HandedOver" && hasExt) out.push({ fn: "cancelExtension", label: "Withdraw extension request", ghost: true });
    if (s === "HandedOver" || inReturnWindow) out.push({ fn: "openDispute", label: "Open dispute", ghost: true });
    if (silenceOver) out.push({ fn: "settleAfterSilence", label: "Settle, owner is silent", ghost: true });
  } else {
    if (s === "Requested") out.push({ fn: "acceptRental", label: "Accept" }, { fn: "cancelRequest", label: "Reject", ghost: true });
    if (s === "Accepted" && !r.owner_handover) out.push({ fn: "confirmHandover", label: "Confirm handed over" });
    if (stalled) out.push({ fn: "openDispute", label: "Open dispute, handover never confirmed", ghost: true });
    if (s === "HandedOver" && hasExt) out.push({ fn: "approveExtension", label: "Approve extension" }, { fn: "cancelExtension", label: "Reject extension", ghost: true });
    if (s === "Returned") out.push({ fn: "confirmReturn", label: "Confirm return, release payout" });
    if (s === "HandedOver" || inReturnWindow) out.push({ fn: "openDispute", label: "Open dispute", ghost: true });
  }
  if (arbiterLate) out.push({ fn: "resolveStale", label: "Settle, arbiter missed the deadline", ghost: true });
  return out;
}

function Extend({ r, onDone }: { r: any; onDone: () => void }) {
  const { send } = useWallet();
  const [date, setDate] = useState("");
  const [chain, setChain] = useState<{ end: bigint; rate: bigint } | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!CONTRACT) return;
    pub.readContract({ address: CONTRACT, abi, functionName: "getRental", args: [BigInt(r.id)] })
      .then((v: any) => setChain({ end: BigInt(v.end), rate: BigInt(v.rate) })).catch(() => setMsg("Couldn’t read the rental from the chain."));
  }, [r.id]);

  const newEnd = date ? BigInt(Math.floor(new Date(date).getTime() / 1000)) : 0n;
  const days = chain && newEnd > chain.end ? (newEnd - chain.end + 86399n) / 86400n : 0n;
  const cost = chain ? days * chain.rate : 0n;
  const min = chain ? new Date(Number(chain.end) * 1000 + 864e5).toISOString().slice(0, 10) : undefined;

  async function go() {
    setBusy(true); setMsg("Confirm in your wallet.");
    try {
      await send("requestExtension", [BigInt(r.id), newEnd], cost);
      setMsg("Requested. The owner has to approve it. The list updates in a few seconds.");
      setTimeout(onDone, 8000);
    } catch (e) { setMsg(errText(e)); }
    setBusy(false);
  }

  return (
    <div style={{ marginTop: 12 }}>
      <label htmlFor={`x${r.id}`}>New end date</label>
      <input id={`x${r.id}`} type="date" min={min} value={date} onChange={(e) => setDate(e.target.value)} />
      {days > 0n ? (
        <div className="row"><span>Extra rental, {String(days)} day{days > 1n ? "s" : ""}</span><span>{bot(cost)} BOT</span></div>
      ) : <p className="note">Pick a date after the current end date.</p>}
      <p className="note">You pay the extra fee now. It goes back to you if the owner says no or you return the machine first. The owner has to approve before it counts.</p>
      <button disabled={days === 0n || busy} onClick={go}>Request extension</button>
      <p className="msg" role="status">{msg}</p>
    </div>
  );
}

export default function Rentals({ role }: { role: "renter" | "owner" }) {
  const { address, token, signIn, send } = useWallet();
  const [rows, setRows] = useState<any[] | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [ext, setExt] = useState<Record<number, boolean>>({});

  const load = useCallback(async () => {
    if (!token || !address) return;
    try {
      const all = await get("/rentals", token);
      setRows(all.filter((r: any) => r[role] === address.toLowerCase()));
    } catch { setMsg("Couldn’t load rentals. Sign in again."); }
  }, [token, address, role]);
  useEffect(() => { load(); }, [load]);

  async function run(fn: string, id: number) {
    setBusy(true); setMsg("Confirm in your wallet.");
    try {
      await send(fn, [BigInt(id)]);
      setMsg("Confirmed on-chain. The list updates in a few seconds.");
      setTimeout(load, 8000);
    } catch (e) { setMsg(errText(e)); }
    setBusy(false);
  }

  if (!token) return (
    <div className="panel">
      <p>Sign in with your wallet to see your {role === "renter" ? "rentals" : "booking requests"}.</p>
      <button onClick={() => signIn().catch((e) => setMsg(errText(e)))}>Sign in</button>
      <p className="msg err">{msg}</p>
    </div>
  );
  if (!rows) return <p className="meta">Loading.</p>;
  if (!rows.length) return <p className="meta">No rentals yet.</p>;

  const now = nowSec();
  return (
    <>
      {rows.map((r) => {
        const late = r.status === "HandedOver" && now > r.end + LATE_GRACE;
        const silenceAt = r.returned_at + RETURN_WINDOW;
        return (
          <div className="panel" key={r.id}>
            <div className="top-row">
              <strong>Rental #{r.id}, equipment #{r.equipment_id}</strong>
              <span className={`pill ${r.status === "Closed" ? "done" : r.status === "Disputed" ? "warn" : ""}`}>{r.status}</span>
            </div>
            <div className="meta">{new Date(r.start * 1000).toLocaleDateString()} to {new Date(r.end * 1000).toLocaleDateString()}</div>
            <div className="row"><span>Rental fee</span><span>{bot(r.fee)} BOT</span></div>
            <div className="row"><span>Deposit</span><span>{bot(r.deposit)} BOT</span></div>
            {r.status === "Closed" && <div className="row"><span>Paid out</span><span>{role === "owner" ? bot(r.to_owner) : bot(r.to_renter)} BOT (withdraw from the owner page or wallet)</span></div>}
            {r.pending_end > 0 && r.status === "HandedOver" && (
              <p className="note">Extension requested until {new Date(r.pending_end * 1000).toLocaleDateString()}, {bot(r.pending_fee)} BOT held in escrow. {role === "owner" ? "Approve it or reject it for a full refund to the renter." : "Waiting for the owner."}</p>
            )}
            {late && <p className="note">{role === "renter" ? "This rental is past its end date. Each late day costs one day’s rent, taken from your deposit, up to the full deposit. Return it or ask for an extension." : "This rental is past its end date. If it comes back late, one day’s rent per late day is taken from the renter’s deposit and paid to you."}</p>}
            {r.status === "Returned" && <p className="note">{now < silenceAt ? `The owner can confirm or dispute until ${fmt(silenceAt)}. After that the renter can settle.` : "The owner’s window has passed. The renter can settle now."}</p>}
            {r.status === "Disputed" && <p className="note">{r.disputed_at > 0 && now >= r.disputed_at + ARBITER_WINDOW ? "The arbiter missed the 14-day deadline. Anyone can settle this by the default rule." : "The arbiter is reviewing this rental. If no decision arrives within 14 days, funds settle by the default rule."}</p>}
            <div className="actions">
              {actions(r, role).map((a) => (
                <button key={a.fn + a.label} className={`small ${a.ghost ? "ghost" : ""}`} disabled={busy} onClick={() => run(a.fn, r.id)}>{a.label}</button>
              ))}
              {role === "renter" && r.status === "HandedOver" && !r.pending_end && (
                <button className="small ghost" onClick={() => setExt({ ...ext, [r.id]: !ext[r.id] })}>{ext[r.id] ? "Hide extension" : "Ask for more time"}</button>
              )}
              <button className="small ghost" onClick={() => setOpen({ ...open, [r.id]: !open[r.id] })}>{open[r.id] ? "Hide evidence" : "Evidence"}</button>
            </div>
            {ext[r.id] && <Extend r={r} onDone={load} />}
            {open[r.id] && <Evidence rentalId={r.id} canAdd={["Accepted", "HandedOver", "Returned", "Disputed"].includes(r.status)} />}
          </div>
        );
      })}
      <p className="msg" role="status">{msg}</p>
    </>
  );
}
