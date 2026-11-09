"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { get, bot } from "@/lib/api";
import { CATEGORIES, LEVELS } from "@/lib/config";

export default function Home() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [cat, setCat] = useState("");
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    const p = new URLSearchParams();
    if (cat) p.set("category", cat);
    if (q) p.set("q", q);
    get(`/equipment?${p}`).then(setRows).catch(() => setErr("Couldn’t load listings."));
  }, [cat, q]);

  return (
    <>
      <div className="page-title">Rent equipment</div>
      <div className="two">
        <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {err && <p className="msg err">{err}</p>}
      {rows && !rows.length && <p className="meta">Nothing listed yet.</p>}
      {rows?.map((e) => (
        <div className="panel" key={e.id}>
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
    </>
  );
}
