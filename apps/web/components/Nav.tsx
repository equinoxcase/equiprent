"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CONTRACT, abi } from "@/lib/config";
import { pub, useWallet, errText } from "@/lib/wallet";

const LINKS = [
  { href: "/browse", label: "Browse" },
  { href: "/renter", label: "My rentals" },
  { href: "/owner", label: "Owner" },
  { href: "/admin", label: "Admin" },
];

export default function Nav() {
  const { address, connect } = useWallet();
  const path = usePathname();
  const [arbiter, setArbiter] = useState("");
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", click);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", click); document.removeEventListener("keydown", key); };
  }, [open]);
  useEffect(() => {
    pub.readContract({ address: CONTRACT, abi, functionName: "arbiter" }).then((a: any) => setArbiter(String(a).toLowerCase())).catch(() => {});
  }, []);
  const isArbiter = address && address.toLowerCase() === arbiter;
  return (
    <header className="nav">
      <div className="nav-in">
        <Link href="/" className="brand" aria-label="EquipRent home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="brand-mark" src="/logo-mark.png" alt="" width="33" height="32" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="brand-word" src="/logo-wordmark.png" alt="EquipRent" width="93" height="20" />
        </Link>
        <button className="small wallet" onClick={() => connect().catch((e) => setErr(errText(e)))} title={err}>
          {address ? `${address.slice(0, 6)}…${address.slice(-4)}` : <>Connect<span className="wide"> wallet</span></>}
        </button>
        <div className="menu" ref={box}>
          <button className="small ghost menu-btn" aria-label="Menu" aria-expanded={open} aria-haspopup="true" aria-controls="main-menu" onClick={() => setOpen((o) => !o)}>
            <span className="menu-label">Menu</span>
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              {open ? <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /> : <path d="M3 5h12M3 9h12M3 13h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
            </svg>
          </button>
          {open && (
            <nav id="main-menu" className="menu-panel" aria-label="Main">
              {LINKS.map((l) => (
                <Link key={l.href} href={l.href} aria-current={path?.startsWith(l.href) ? "page" : undefined}>{l.label}</Link>
              ))}
              {isArbiter && <Link href="/arbiter" aria-current={path?.startsWith("/arbiter") ? "page" : undefined}>Arbiter</Link>}
            </nav>
          )}
        </div>
      </div>
    </header>
  );
}
