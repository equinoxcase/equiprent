"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { get, bot } from "@/lib/api";
import { CATEGORIES, LEVELS } from "@/lib/config";

const STEPS = [
  { t: "Request dates", d: "Pick a machine and your dates. The rental fee and deposit are locked in the escrow contract." },
  { t: "Owner accepts", d: "The owner approves the request. Nothing is paid out yet." },
  { t: "Hand over", d: "Both of you confirm the handover on-chain. The rental clock starts." },
  { t: "Return and settle", d: "The renter reports the return and the owner confirms it. The fee goes to the owner, the deposit comes back to you." },
];

const PROTECTIONS = [
  { t: "Deposit held in escrow", d: "Funds sit in a smart contract, not with the platform or the other party. Rejected or cancelled requests refund in full." },
  { t: "Clear late-return rules", d: "Return more than 6 hours late and one day’s rent per late day is taken from the deposit, never more than the deposit itself." },
  { t: "Disputes with timestamped evidence", d: "Upload photos or a PDF. Its SHA-256 hash is recorded on-chain, so nobody can swap the file later. An independent arbiter decides." },
  { t: "Verified listings", d: "Listings are Registered, Verified or Inspected. The badge switches off automatically if the owner changes the listing details." },
  { t: "Extensions you can undo", d: "Need it longer? Escrow the extra fee. If the owner says no, or you return early, you get it back in full." },
];

const CAT_NOTE: Record<string, string> = {
  Generators: "Site power and backup",
  Excavators: "Digging and grading",
  Tractors: "Farm and haulage",
  Industrial: "Compressors, lifts, saws",
  Event: "Staging, lighting, tents",
  Vehicles: "Vans, trucks, trailers",
};

export default function Landing() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    get("/equipment").then((r) => setRows(Array.isArray(r) ? r.slice(0, 3) : [])).catch(() => {});
  }, []);

  return (
    <>
      <section className="hero">
        <div className="wrap hero-grid">
          <div className="hero-copy">
            <h1>Rent heavy equipment. Your deposit stays locked until it’s back.</h1>
            <p className="lede">
              EquipRent connects people who need a machine with owners who have one sitting idle. Rental fees and deposits are held in an on-chain escrow
              contract and released by the rules both sides agreed to.
            </p>
            <div className="cta-row">
              <Link className="btn big" href="/browse">Browse equipment</Link>
              <Link className="btn big ghost" href="/owner/new">List your machine</Link>
            </div>
          </div>

          <div className="ticket" role="img" aria-label="Example rental: a mini excavator for 3 days with a deposit held in escrow until return">
            <div className="ticket-stripe" />
            <div className="ticket-body">
              <div className="top-row">
                <strong className="ticket-title">Mini excavator, 1.8 t</strong>
                <span className="pill done">Inspected</span>
              </div>
              <div className="meta">Example rental</div>
              <div className="row"><span>3 days at 40 BOT</span><span>120 BOT</span></div>
              <div className="row"><span>Deposit, held in escrow</span><span>200 BOT</span></div>
              <div className="row total"><span>Locked now</span><span>320 BOT</span></div>
              <ol className="track">
                <li className="on">Requested</li>
                <li className="on">Accepted</li>
                <li className="now">Handed over</li>
                <li>Returned</li>
                <li>Deposit released</li>
              </ol>
            </div>
          </div>
        </div>
      </section>

      {rows.length > 0 && (
        <section className="sect">
          <div className="wrap">
            <div className="sect-head">
              <h2>Available now</h2>
              <Link href="/browse" className="textlink">See all listings</Link>
            </div>
            <div className="grid">
              {rows.map((e) => (
                <Link className="panel listing" key={e.id} href={`/equipment/${e.id}`}>
                  <div className="top-row">
                    <strong>{e.metadata?.title ?? `Equipment #${e.id}`}</strong>
                    <span className="pill">{LEVELS[e.metadata?.verification_level ?? 1]}</span>
                  </div>
                  <div className="meta">{e.metadata?.category} · {e.metadata?.location}</div>
                  <div className="row"><span>Per day</span><span>{bot(e.daily_rate_wei)} BOT</span></div>
                  <div className="row"><span>Deposit</span><span>{bot(e.deposit_wei)} BOT</span></div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="sect" id="how">
        <div className="wrap">
          <h2 className="sect-title">How a rental works</h2>
          <p className="sect-sub">Four steps from request to refund. Each one is a transaction you can check on the block explorer.</p>
          <ol className="steps">
            {STEPS.map((s, i) => (
              <li key={s.t}>
                <span className="step-n">{i + 1}</span>
                <h3>{s.t}</h3>
                <p>{s.d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="sect band" id="protection">
        <div className="wrap split">
          <div>
            <h2 className="sect-title">What happens when things go wrong</h2>
            <p className="sect-sub">Late returns, damage and disagreements are covered by rules written into the contract before anyone rents.</p>
          </div>
          <dl className="prot">
            {PROTECTIONS.map((p) => (
              <div key={p.t}>
                <dt>{p.t}</dt>
                <dd>{p.d}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="sect">
        <div className="wrap">
          <h2 className="sect-title">Find the right machine</h2>
          <div className="cats">
            {CATEGORIES.map((c) => (
              <Link key={c} href={`/browse?category=${encodeURIComponent(c)}`} className="cat">
                <strong>{c}</strong>
                <span>{CAT_NOTE[c]}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="sect">
        <div className="wrap cta-band">
          <div>
            <h2>Got a machine sitting idle?</h2>
            <p>List it in a few minutes. Set your daily rate and deposit, and get paid straight from escrow when the rental ends.</p>
          </div>
          <div className="cta-row">
            <Link className="btn big" href="/owner/new">List equipment</Link>
            <Link className="btn big ghost" href="/browse">Browse first</Link>
          </div>
        </div>
      </section>
    </>
  );
}
