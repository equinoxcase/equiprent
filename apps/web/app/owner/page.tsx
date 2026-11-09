"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { get, bot } from "@/lib/api";
import { CONTRACT, abi } from "@/lib/config";
import { pub, useWallet, errText } from "@/lib/wallet";
import Rentals from "@/components/Rentals";

export default function OwnerPage() {
  const { address, send } = useWallet();
  const [mine, setMine] = useState<any[]>([]);
  const [bal, setBal] = useState<bigint>(0n);
  const [msg, setMsg] = useState("");

  const refresh = () => {
    if (!address) return;
    get(`/equipment?owner=${address.toLowerCase()}&include_inactive=true&limit=100`).then(setMine).catch(() => {});
    if (CONTRACT) pub.readContract({ address: CONTRACT, abi, functionName: "balances", args: [address] }).then((v: any) => setBal(v)).catch(() => {});
  };
  useEffect(refresh, [address]);

  async function withdraw() {
    setMsg("Confirm in your wallet.");
    try { await send("withdraw", []); setMsg("Withdrawn."); refresh(); } catch (e) { setMsg(errText(e)); }
  }

  return (
    <>
      <div className="top-row">
        <div className="page-title">Owner dashboard</div>
        <Link className="btn" href="/owner/new">List equipment</Link>
      </div>
      <div className="panel">
        <div className="row total"><span>Withdrawable</span><span>{bot(bal)} BOT</span></div>
        <div className="actions"><button disabled={bal === 0n} onClick={withdraw}>Withdraw</button></div>
        <p className="msg" role="status">{msg}</p>
      </div>
      <h2>Your equipment</h2>
      {mine.length ? mine.map((e) => (
        <div className="panel" key={e.id}>
          <div className="top-row">
            <strong>{e.metadata?.title ?? `Equipment #${e.id}`}</strong>
            <span className={`pill ${e.active ? "done" : "warn"}`}>{e.active ? "Listed" : "Hidden"}</span>
          </div>
          <div className="meta">{bot(e.daily_rate_wei)} BOT/day · deposit {bot(e.deposit_wei)} BOT</div>
          <div className="actions"><Link className="btn small ghost" href={`/owner/edit/${e.id}`}>Edit</Link></div>
        </div>
      )) : <p className="meta">Nothing listed yet.</p>}
      <h2>Booking requests and active rentals</h2>
      <Rentals role="owner" />
    </>
  );
}
