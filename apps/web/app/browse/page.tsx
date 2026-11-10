"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Cover from "@/components/Cover";
import { get, bot } from "@/lib/api";
import { CATEGORIES, LEVELS } from "@/lib/config";

export default function Home() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [cat, setCat] = useState("");
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("category");
    if (c && CATEGORIES.includes(c)) setCat(c);
  }, []);

  useEffect(() => {
    const p = new URLSearchParams();
    if (cat) p.set("category", cat);
    if (q) p.set("q", q);
    get(`/equipment?${p}`).then(setRows).catch(() => setErr("Couldn’t load listings."));
  }, [cat, q]);

  return (
    <>
      <h1 className="page-title">Rent equipment</h1>
      <p className="meta lead">Every listing is escrowed on-chain. Pick a machine, choose your dates, and your deposit stays locked until it’s returned.</p>
      <div className="filters">
        <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <input placeholder="Search by name or location" aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {err && <p className="msg err">{err}</p>}
      {rows && !rows.length && (
        <div className="empty">
          <strong>Nothing listed yet.</strong>
          <p className="meta">Own a machine that sits idle? List it and start earning from it.</p>
          <Link className="btn small" href="/owner/new">List equipment</Link>
        </div>
      )}
      <div className="grid">
      {rows?.map((e) => (
        <div className="panel listing" key={e.id}>
          <Cover images={e.metadata?.images} title={e.metadata?.title ?? `Equipment #${e.id}`} />
          <div className="top-row">
            <strong>{e.metadata?.title ?? `Equipment #${e.id}`}</strong>
            <span className="pill">{LEVELS[e.metadata?.verification_level ?? 1]}</span>
          </div>
          <div className="meta">{e.metadata?.category} · {e.metadata?.location}</div>
          <div className="row"><span>Per day</span><span>{bot(e.daily_rate_wei)} BOT</span></div>
          <div className="row"><span>Deposit</span><span>{bot(e.deposit_wei)} BOT</span></div>
          <div className="actions"><Link className="btn small" href={`/equipment/${e.id}`}>View and book</Link></div>
        </div>
      ))}
      </div>
    </>
  );
}
