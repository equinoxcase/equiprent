"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { get, bot } from "@/lib/api";
import { LEVELS, CONTRACT, abi } from "@/lib/config";
import { pub, useWallet, errText } from "@/lib/wallet";

export default function Booking() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { send } = useWallet();
  const [e, setE] = useState<any>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [bps, setBps] = useState(1000);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    get(`/equipment/${id}`).then(setE).catch(() => setMsg("Equipment not found."));
    if (CONTRACT) pub.readContract({ address: CONTRACT, abi, functionName: "platformFeeBps" }).then((v: any) => setBps(Number(v))).catch(() => {});
  }, [id]);

  if (!e) return <p className="meta">{msg || "Loading."}</p>;
  const m = e.metadata;
  const s = start ? new Date(start).getTime() / 1000 : 0, en = end ? new Date(end).getTime() / 1000 : 0;
  const days = en > s ? Math.ceil((en - s) / 86400) : 0;
  const fee = BigInt(days) * BigInt(e.daily_rate_wei), dep = BigInt(e.deposit_wei);
  const today = new Date(Date.now() + 864e5).toISOString().slice(0, 10);

  async function book() {
    setBusy(true); setMsg("Confirm in your wallet.");
    try {
      await send("requestRental", [BigInt(id), BigInt(Math.floor(s)), BigInt(Math.floor(en))], fee + dep);
      setMsg("Requested. Redirecting to your rentals.");
      setTimeout(() => router.push("/renter"), 1200);
    } catch (x) { setMsg(errText(x)); }
    setBusy(false);
  }

  return (
    <>
      <div className="page-title">{m?.title ?? `Equipment #${e.id}`}</div>
      <div className="meta">{m?.location} · {LEVELS[m?.verification_level ?? 1]}{e.verification ? ` until ${new Date(e.verification.expires_at * 1000).toLocaleDateString()}` : ""}</div>
      {m?.description && <p>{m.description}</p>}
      <div className="panel">
        <div className="two">
          <div><label htmlFor="s">Start date</label><input id="s" type="date" min={today} value={start} onChange={(x) => setStart(x.target.value)} /></div>
          <div><label htmlFor="e">End date</label><input id="e" type="date" min={start || today} value={end} onChange={(x) => setEnd(x.target.value)} /></div>
        </div>
        {days > 0 ? (
          <>
            <div className="row"><span>Rental, {days} day{days > 1 ? "s" : ""}</span><span>{bot(fee)} BOT</span></div>
            <div className="row"><span>Refundable deposit</span><span>{bot(dep)} BOT</span></div>
            <div className="row"><span>Platform fee, taken from the rental</span><span>{bot((fee * BigInt(bps)) / 10000n)} BOT</span></div>
            <div className="row total"><span>Locked in escrow</span><span>{bot(fee + dep)} BOT</span></div>
          </>
        ) : <p className="note">Pick start and end dates to see the escrow total.</p>}
        <p className="note">The fee is fixed into the agreement when you request. Funds release only through contract rules, never by an admin.</p>
        <button disabled={!days || busy} onClick={book}>Request rental</button>
        <p className={`msg ${msg.toLowerCase().includes("confirm") || msg.startsWith("Requested") ? "" : "err"}`} role="status">{msg}</p>
      </div>
    </>
  );
}
