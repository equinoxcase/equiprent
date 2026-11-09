"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CONTRACT, abi } from "@/lib/config";
import { pub, useWallet, errText } from "@/lib/wallet";

export default function Nav() {
  const { address, connect } = useWallet();
  const [arbiter, setArbiter] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => {
    pub.readContract({ address: CONTRACT, abi, functionName: "arbiter" }).then((a: any) => setArbiter(String(a).toLowerCase())).catch(() => {});
  }, []);
  return (
    <header className="nav">
      <Link href="/" className="brand">EquipRent</Link>
      <nav>
        <Link href="/">Browse</Link>
        <Link href="/renter">My rentals</Link>
        <Link href="/owner">Owner</Link>
        <Link href="/admin">Admin</Link>
        {address && address.toLowerCase() === arbiter && <Link href="/arbiter">Arbiter</Link>}
      </nav>
      <button className="small" onClick={() => connect().catch((e) => setErr(errText(e)))} title={err}>
        {address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Connect wallet"}
      </button>
    </header>
  );
}
